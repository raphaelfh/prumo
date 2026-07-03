"""Direct-coroutine unit tests for GET /articles/{id}/content-markdown.

Calls the endpoint function directly (not via ASGITransport) so the handler
lines register for diff-cover (the ASGI blind spot) and the BOLA gate ORDER is
pinned: the membership gate must run BEFORE the file read, or a non-member could
probe whether an article's markdown exists.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.articles import get_article_content_markdown
from app.utils.rate_limiter import limiter

_EP = "app.api.v1.endpoints.articles"


@pytest.fixture(autouse=True)
def _disable_limiter():
    """The @limiter.limit decorator inspects a real Request; disable it so the
    coroutine can be called directly with a MagicMock request."""
    prev = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = prev


@pytest.mark.asyncio
async def test_content_markdown_endpoint_gates_then_reads() -> None:
    aid = uuid4()
    af = MagicMock(original_filename="teste3.pdf", content_markdown="# md")
    with (
        patch(f"{_EP}._gate_article", AsyncMock()) as gate,
        patch(f"{_EP}.ArticleFileService") as svc,
        patch(f"{_EP}._trace", return_value=None),
    ):
        svc.return_value.get_content_markdown = AsyncMock(return_value=af)
        resp = await get_article_content_markdown(
            article_id=aid, request=MagicMock(), db=AsyncMock(), current_user_sub=uuid4()
        )
    gate.assert_awaited_once()
    assert resp.ok is True
    assert resp.data.file_name == "teste3.pdf"
    assert resp.data.content_markdown == "# md"


@pytest.mark.asyncio
async def test_content_markdown_endpoint_denies_before_reading() -> None:
    # A denied membership gate must short-circuit BEFORE the file read — no
    # cross-project existence oracle for parsed markdown.
    with (
        patch(f"{_EP}._gate_article", AsyncMock(side_effect=HTTPException(status_code=403))),
        patch(f"{_EP}.ArticleFileService") as svc,
    ):
        svc.return_value.get_content_markdown = AsyncMock()
        with pytest.raises(HTTPException) as exc:
            await get_article_content_markdown(
                article_id=uuid4(), request=MagicMock(), db=AsyncMock(), current_user_sub=uuid4()
            )
    assert exc.value.status_code == 403
    svc.return_value.get_content_markdown.assert_not_awaited()


@pytest.mark.asyncio
async def test_content_markdown_endpoint_404s_without_file() -> None:
    with (
        patch(f"{_EP}._gate_article", AsyncMock()),
        patch(f"{_EP}.ArticleFileService") as svc,
    ):
        svc.return_value.get_content_markdown = AsyncMock(return_value=None)
        with pytest.raises(HTTPException) as exc:
            await get_article_content_markdown(
                article_id=uuid4(), request=MagicMock(), db=AsyncMock(), current_user_sub=uuid4()
            )
    assert exc.value.status_code == 404
