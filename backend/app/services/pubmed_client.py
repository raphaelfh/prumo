"""
PubMed E-utilities ``efetch`` client.

Parses with stdlib ``xml.etree.ElementTree``: the bundled expat refuses
entity-expansion bombs and ElementTree never fetches external DTDs.
"""

from __future__ import annotations

import asyncio
import time
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable, Sequence

import httpx

EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
EFETCH_BATCH_SIZE = 200
# NCBI allows 3 requests per second without an API key.
MIN_REQUEST_INTERVAL_S = 0.34


class PubMedFetchError(Exception):
    """The efetch call failed (transport, HTTP status, or unparseable XML)."""


class PubMedClient:
    def __init__(
        self,
        *,
        email: str,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
        timeout_s: float = 30.0,
    ) -> None:
        if not email or not email.strip():
            raise ValueError("PubMed E-utilities require a contact email (NCBI etiquette)")
        self._email = email.strip()
        self._transport = transport
        self._sleep = sleep
        self._clock = clock
        self._timeout_s = timeout_s
        self._last_request_at: float | None = None

    async def efetch(self, pmids: Sequence[str]) -> dict[str, ET.Element]:
        """Fetch one batch; returns ``{pmid: <PubmedArticle>}`` (absent PMIDs are missing)."""
        if not pmids:
            return {}
        if len(pmids) > EFETCH_BATCH_SIZE:
            raise ValueError(f"efetch batch is limited to {EFETCH_BATCH_SIZE} ids")
        await self._wait_for_slot()
        params = {
            "db": "pubmed",
            "retmode": "xml",
            "tool": "prumo",
            "email": self._email,
            "id": ",".join(pmids),
        }
        try:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=self._timeout_s
            ) as client:
                response = await client.get(EFETCH_URL, params=params)
        except httpx.HTTPError as exc:
            raise PubMedFetchError(f"efetch request failed: {type(exc).__name__}") from exc
        finally:
            self._last_request_at = self._clock()
        if response.status_code != 200:
            raise PubMedFetchError(f"efetch returned HTTP {response.status_code}")
        try:
            root = ET.fromstring(response.content)
        except ET.ParseError as exc:
            raise PubMedFetchError("efetch returned unparseable XML") from exc
        records: dict[str, ET.Element] = {}
        for article in root.findall("PubmedArticle"):
            pmid = (article.findtext("MedlineCitation/PMID") or "").strip()
            if pmid:
                records[pmid] = article
        return records

    async def _wait_for_slot(self) -> None:
        if self._last_request_at is None:
            return
        remaining = MIN_REQUEST_INTERVAL_S - (self._clock() - self._last_request_at)
        if remaining > 0:
            await self._sleep(remaining)
