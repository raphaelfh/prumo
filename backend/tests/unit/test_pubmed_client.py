import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.core.config import Settings
from app.services.pubmed_client import (
    EFETCH_BATCH_SIZE,
    EFETCH_URL,
    MIN_REQUEST_INTERVAL_S,
    PubMedClient,
    PubMedFetchError,
    RedisIntervalGate,
)

_FIXTURE_BYTES = (Path(__file__).parents[1] / "fixtures/pubmed/efetch_batch.xml").read_bytes()
_PMIDS = ["42908551", "42875467", "42706533", "49999999"]


def _client(handler, **kwargs) -> PubMedClient:  # type: ignore[no-untyped-def]
    return PubMedClient(email="dev@prumo.test", transport=httpx.MockTransport(handler), **kwargs)


async def test_efetch_sends_etiquette_and_ids() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=_FIXTURE_BYTES)

    result = await _client(handler).efetch(_PMIDS)

    assert len(seen) == 1
    request = seen[0]
    assert request.method == "GET"
    assert str(request.url).startswith(EFETCH_URL)
    params = dict(request.url.params)
    assert params == {
        "db": "pubmed",
        "retmode": "xml",
        "tool": "prumo",
        "email": "dev@prumo.test",
        "id": "42908551,42875467,42706533,49999999",
    }
    assert set(result) == {"42908551", "42875467", "42706533"}
    assert all(isinstance(v, ET.Element) and v.tag == "PubmedArticle" for v in result.values())


async def test_efetch_spaces_requests_at_most_three_per_second() -> None:
    now = [100.0]
    stamps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        now[0] += seconds

    def handler(_request: httpx.Request) -> httpx.Response:
        stamps.append(now[0])
        return httpx.Response(200, content=_FIXTURE_BYTES)

    client = _client(handler, sleep=fake_sleep, clock=lambda: now[0])
    for _ in range(3):
        await client.efetch(["42908551"])

    assert len(stamps) == 3
    for earlier, later in zip(stamps, stamps[1:], strict=False):
        assert later - earlier >= MIN_REQUEST_INTERVAL_S


async def test_efetch_refuses_more_than_one_batch() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, content=_FIXTURE_BYTES)

    ids = [str(i) for i in range(EFETCH_BATCH_SIZE + 1)]
    assert len(ids) == 201
    with pytest.raises(ValueError, match="batch"):
        await _client(handler).efetch(ids)
    assert calls == []


async def test_efetch_empty_sends_nothing() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, content=_FIXTURE_BYTES)

    assert await _client(handler).efetch([]) == {}
    assert calls == []


@pytest.mark.parametrize("failure", ["status_500", "connect_error", "not_xml"])
async def test_efetch_failures_raise_fetch_error(failure: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if failure == "status_500":
            return httpx.Response(500, content=b"boom")
        if failure == "connect_error":
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(200, content=b"<PubmedArticleSet><oops")

    _, sleep = _recording_sleep()
    with pytest.raises(PubMedFetchError):
        await _client(handler, sleep=sleep).efetch(["42908551"])


@pytest.mark.parametrize("email", ["", "  ", None], ids=["empty", "blank", "none"])
def test_client_requires_an_email(email: str | None) -> None:
    with pytest.raises(ValueError, match="email"):
        PubMedClient(email=email)  # type: ignore[arg-type]


def test_ncbi_email_is_optional() -> None:
    assert Settings.model_fields["NCBI_EMAIL"].default is None


# ---------------------------------------------------------------------------
# Retry with backoff
# ---------------------------------------------------------------------------


def _scripted(*answers: object):  # type: ignore[no-untyped-def]
    """A handler answering each request with the next scripted answer.

    An ``int`` is a bare status, an ``httpx.Response`` is returned as is, an
    exception class is raised; the list repeats its last entry when exhausted.
    """
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        answer = answers[min(len(calls), len(answers)) - 1]
        if isinstance(answer, type) and issubclass(answer, Exception):
            raise answer("boom", request=request)  # type: ignore[call-arg]
        if isinstance(answer, httpx.Response):
            return answer
        return httpx.Response(answer, content=_FIXTURE_BYTES)  # type: ignore[arg-type]

    return handler, calls


def _recording_sleep() -> tuple[list[float], Any]:
    sleeps: list[float] = []

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)

    return sleeps, sleep


def _backoffs(sleeps: list[float]) -> list[float]:
    """Sleeps longer than one throttle interval: the retry backoffs."""
    return [s for s in sleeps if s > MIN_REQUEST_INTERVAL_S]


@pytest.mark.parametrize(
    "transient",
    [429, 500, 502, 503, httpx.ReadTimeout, httpx.ConnectError],
    ids=["429", "500", "502", "503", "timeout", "connect"],
)
async def test_efetch_retries_transient_failures_then_succeeds(transient: object) -> None:
    handler, calls = _scripted(transient, transient, 200)
    sleeps, sleep = _recording_sleep()

    result = await _client(handler, sleep=sleep, clock=lambda: 0.0).efetch(_PMIDS)

    assert len(calls) == 3
    assert set(result) == {"42908551", "42875467", "42706533"}
    assert _backoffs(sleeps) == [1.0, 2.0]


async def test_efetch_gives_up_after_four_attempts() -> None:
    handler, calls = _scripted(503)
    sleeps, sleep = _recording_sleep()

    with pytest.raises(PubMedFetchError, match="503"):
        await _client(handler, sleep=sleep, clock=lambda: 0.0).efetch(_PMIDS)

    assert len(calls) == 4
    assert _backoffs(sleeps) == [1.0, 2.0, 4.0]


@pytest.mark.parametrize(
    ("retry_after", "expected"),
    [("7", 7.0), ("120", 30.0), ("Wed, 21 Oct 2026 07:28:00 GMT", 1.0)],
    ids=["seconds", "capped", "http-date-ignored"],
)
async def test_efetch_honours_retry_after_seconds(retry_after: str, expected: float) -> None:
    handler, calls = _scripted(httpx.Response(429, headers={"Retry-After": retry_after}), 200)
    sleeps, sleep = _recording_sleep()

    await _client(handler, sleep=sleep, clock=lambda: 0.0).efetch(_PMIDS)

    assert len(calls) == 2
    assert _backoffs(sleeps) == [expected]


@pytest.mark.parametrize("failure", [400, 404, "not_xml"], ids=["400", "404", "not-xml"])
async def test_efetch_does_not_retry_permanent_failures(failure: object) -> None:
    answer = (
        httpx.Response(200, content=b"<PubmedArticleSet><oops") if failure == "not_xml" else failure
    )
    handler, calls = _scripted(answer)
    sleeps, sleep = _recording_sleep()

    with pytest.raises(PubMedFetchError):
        await _client(handler, sleep=sleep, clock=lambda: 0.0).efetch(_PMIDS)

    assert len(calls) == 1
    assert _backoffs(sleeps) == []


# ---------------------------------------------------------------------------
# Shared throttle gate
# ---------------------------------------------------------------------------


class _FakeLock:
    """One shared lock; records acquire/release on a shared timeline."""

    def __init__(self, owner: "_FakeRedis") -> None:
        self._owner = owner

    async def acquire(self) -> bool:
        if not self._owner.grant:
            return False
        self._owner.timeline.append(("acquire", self._owner.now[0]))
        return True

    async def release(self) -> None:
        self._owner.timeline.append(("release", self._owner.now[0]))


class _FakeRedis:
    def __init__(self, now: list[float], *, grant: bool = True) -> None:
        self.now = now
        self.grant = grant
        self.timeline: list[tuple[str, float]] = []
        self.lock_calls: list[dict[str, Any]] = []

    def lock(self, name: str, **kwargs: Any) -> _FakeLock:
        self.lock_calls.append({"name": name, **kwargs})
        return _FakeLock(self)


async def test_redis_gate_holds_the_lock_one_interval_from_request_start() -> None:
    now = [100.0]

    async def fake_sleep(seconds: float) -> None:
        now[0] += seconds

    redis = _FakeRedis(now)
    gate = RedisIntervalGate(
        redis,  # type: ignore[arg-type]
        sleep=fake_sleep,
        clock=lambda: now[0],
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        now[0] += 0.1  # the request itself takes 100 ms
        return httpx.Response(200, content=_FIXTURE_BYTES)

    client = _client(handler, gate=gate, sleep=fake_sleep, clock=lambda: now[0])
    await client.efetch(["42908551"])
    await client.efetch(["42908551"])

    assert [event for event, _ in redis.timeline] == ["acquire", "release"] * 2
    first_acquire, first_release, second_acquire, _ = (t for _, t in redis.timeline)
    assert first_release - first_acquire == pytest.approx(MIN_REQUEST_INTERVAL_S)
    assert second_acquire - first_acquire >= MIN_REQUEST_INTERVAL_S
    [call, _] = redis.lock_calls
    assert call["name"] == "pubmed:efetch"
    assert call["timeout"] > 30.0 + MIN_REQUEST_INTERVAL_S  # outlives one request
    assert call["blocking_timeout"] > 0


async def test_redis_gate_does_not_sleep_after_a_slow_request() -> None:
    now = [0.0]
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        now[0] += seconds

    redis = _FakeRedis(now)
    gate = RedisIntervalGate(
        redis,  # type: ignore[arg-type]
        sleep=fake_sleep,
        clock=lambda: now[0],
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        now[0] += 2.0
        return httpx.Response(200, content=_FIXTURE_BYTES)

    await _client(handler, gate=gate, sleep=fake_sleep, clock=lambda: now[0]).efetch(["1"])

    assert sleeps == []
    assert [event for event, _ in redis.timeline] == ["acquire", "release"]


async def test_redis_gate_releases_the_lock_when_the_request_fails() -> None:
    now = [0.0]
    redis = _FakeRedis(now)
    sleeps, sleep = _recording_sleep()
    gate = RedisIntervalGate(
        redis,  # type: ignore[arg-type]
        sleep=sleep,
        clock=lambda: now[0],
    )
    handler, _ = _scripted(404)

    with pytest.raises(PubMedFetchError):
        await _client(handler, gate=gate, sleep=sleep, clock=lambda: now[0]).efetch(["1"])

    assert [event for event, _ in redis.timeline] == ["acquire", "release"]


async def test_busy_redis_gate_is_retried_then_fails_the_fetch() -> None:
    redis = _FakeRedis([0.0], grant=False)
    sleeps, sleep = _recording_sleep()
    handler, calls = _scripted(200)
    gate = RedisIntervalGate(
        redis,  # type: ignore[arg-type]
        sleep=sleep,
        clock=lambda: 0.0,
    )

    with pytest.raises(PubMedFetchError, match="gate"):
        await _client(handler, gate=gate, sleep=sleep, clock=lambda: 0.0).efetch(["1"])

    assert calls == []
    assert len(redis.lock_calls) == 4
    assert _backoffs(sleeps) == [1.0, 2.0, 4.0]
