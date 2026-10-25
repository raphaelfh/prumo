"""
PubMed E-utilities ``efetch`` client.

Parses with stdlib ``xml.etree.ElementTree``: the bundled expat refuses
entity-expansion bombs and ElementTree never fetches external DTDs.

Every request passes through a :class:`RequestGate` that keeps NCBI's
3 requests/s. The default gate spaces one client's requests; the worker
passes :class:`RedisIntervalGate`, one lock for every task and worker, so
the whole deployment stays under the limit from its one IP.
"""

from __future__ import annotations

import asyncio
import time
import xml.etree.ElementTree as ET
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager, suppress
from typing import Protocol

import httpx
from redis.asyncio import Redis
from redis.exceptions import LockError

EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
EFETCH_BATCH_SIZE = 200
# NCBI allows 3 requests per second without an API key.
MIN_REQUEST_INTERVAL_S = 0.34
# Attempts per batch; the waits between them double from the first.
MAX_ATTEMPTS = 4
FIRST_BACKOFF_S = 1.0
MAX_RETRY_AFTER_S = 30.0
GATE_LOCK_KEY = "pubmed:efetch"

Sleep = Callable[[float], Awaitable[None]]
Clock = Callable[[], float]


class PubMedFetchError(Exception):
    """The efetch call failed (transport, HTTP status, or unparseable XML)."""


class GateBusyError(Exception):
    """The shared throttle gate was not acquired within its blocking wait."""


class RequestGate(Protocol):
    def slot(self) -> AbstractAsyncContextManager[None]:
        """Hold while one request is in flight; enter no sooner than the limit allows."""
        ...


class IntervalGate:
    """In-process spacing: one client's requests start at least one interval apart."""

    def __init__(self, *, sleep: Sleep, clock: Clock) -> None:
        self._sleep = sleep
        self._clock = clock
        self._last_start: float | None = None

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        if self._last_start is not None:
            remaining = MIN_REQUEST_INTERVAL_S - (self._clock() - self._last_start)
            if remaining > 0:
                await self._sleep(remaining)
        self._last_start = self._clock()
        yield


class RedisIntervalGate:
    """One Redis lock for every efetch of the deployment.

    The lock is held from a request's start until one interval has passed
    since then, so two requests anywhere start at least that far apart. Its
    timeout outlives one request (``PubMedClient`` timeout) plus the
    interval, and a crashed holder frees it when it expires.
    """

    def __init__(
        self,
        redis: Redis,
        *,
        sleep: Sleep = asyncio.sleep,
        clock: Clock = time.monotonic,
        lock_timeout_s: float = 60.0,
        blocking_timeout_s: float = 60.0,
    ) -> None:
        self._redis = redis
        self._sleep = sleep
        self._clock = clock
        self._lock_timeout_s = lock_timeout_s
        self._blocking_timeout_s = blocking_timeout_s

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        lock = self._redis.lock(
            GATE_LOCK_KEY,
            timeout=self._lock_timeout_s,
            blocking_timeout=self._blocking_timeout_s,
        )
        if not await lock.acquire():
            raise GateBusyError(GATE_LOCK_KEY)
        started = self._clock()
        try:
            yield
        finally:
            remaining = MIN_REQUEST_INTERVAL_S - (self._clock() - started)
            if remaining > 0:
                await self._sleep(remaining)
            # Expired and maybe taken over: nothing of ours left to release.
            with suppress(LockError):
                await lock.release()


def _retry_after_s(response: httpx.Response) -> float | None:
    """The ``Retry-After`` header in its seconds form, capped; None otherwise."""
    value = (response.headers.get("Retry-After") or "").strip()
    if not value.isdigit():
        return None
    return min(float(value), MAX_RETRY_AFTER_S)


class PubMedClient:
    def __init__(
        self,
        *,
        email: str,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Sleep = asyncio.sleep,
        clock: Clock = time.monotonic,
        gate: RequestGate | None = None,
        timeout_s: float = 30.0,
    ) -> None:
        if not email or not email.strip():
            raise ValueError("PubMed E-utilities require a contact email (NCBI etiquette)")
        self._email = email.strip()
        self._transport = transport
        self._sleep = sleep
        self._gate = gate or IntervalGate(sleep=sleep, clock=clock)
        self._timeout_s = timeout_s

    async def efetch(self, pmids: Sequence[str]) -> dict[str, ET.Element]:
        """Fetch one batch; returns ``{pmid: <PubmedArticle>}`` (absent PMIDs are missing).

        429, 5xx, timeouts, connection errors and a busy gate are retried
        (``MAX_ATTEMPTS`` in total, backoff 1 s, 2 s, 4 s or the server's
        ``Retry-After``); any other status and unparseable XML are not.
        """
        if not pmids:
            return {}
        if len(pmids) > EFETCH_BATCH_SIZE:
            raise ValueError(f"efetch batch is limited to {EFETCH_BATCH_SIZE} ids")
        params = {
            "db": "pubmed",
            "retmode": "xml",
            "tool": "prumo",
            "email": self._email,
            "id": ",".join(pmids),
        }
        backoff = FIRST_BACKOFF_S
        for attempt in range(1, MAX_ATTEMPTS + 1):
            wait = backoff
            try:
                response = await self._get(params)
            except GateBusyError as exc:
                error = PubMedFetchError("efetch throttle gate busy")
                error.__cause__ = exc
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                error = PubMedFetchError(f"efetch request failed: {type(exc).__name__}")
                error.__cause__ = exc
            except httpx.HTTPError as exc:
                raise PubMedFetchError(f"efetch request failed: {type(exc).__name__}") from exc
            else:
                if response.status_code == 200:
                    return _parse(response.content)
                error = PubMedFetchError(f"efetch returned HTTP {response.status_code}")
                if response.status_code != 429 and response.status_code < 500:
                    raise error
                wait = _retry_after_s(response) or backoff
            if attempt == MAX_ATTEMPTS:
                raise error
            await self._sleep(wait)
            backoff *= 2
        raise AssertionError("unreachable")  # pragma: no cover

    async def _get(self, params: dict[str, str]) -> httpx.Response:
        async with (
            self._gate.slot(),
            httpx.AsyncClient(transport=self._transport, timeout=self._timeout_s) as client,
        ):
            return await client.get(EFETCH_URL, params=params)


def _parse(content: bytes) -> dict[str, ET.Element]:
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise PubMedFetchError("efetch returned unparseable XML") from exc
    records: dict[str, ET.Element] = {}
    for article in root.findall("PubmedArticle"):
        pmid = (article.findtext("MedlineCitation/PMID") or "").strip()
        if pmid:
            records[pmid] = article
    return records
