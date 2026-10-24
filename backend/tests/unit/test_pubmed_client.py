import xml.etree.ElementTree as ET
from pathlib import Path

import httpx
import pytest

from app.core.config import Settings
from app.services.pubmed_client import (
    EFETCH_BATCH_SIZE,
    EFETCH_URL,
    MIN_REQUEST_INTERVAL_S,
    PubMedClient,
    PubMedFetchError,
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

    with pytest.raises(PubMedFetchError):
        await _client(handler).efetch(["42908551"])


@pytest.mark.parametrize("email", ["", "  ", None], ids=["empty", "blank", "none"])
def test_client_requires_an_email(email: str | None) -> None:
    with pytest.raises(ValueError, match="email"):
        PubMedClient(email=email)  # type: ignore[arg-type]


def test_ncbi_email_is_optional() -> None:
    assert Settings.model_fields["NCBI_EMAIL"].default is None
