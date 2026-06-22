"""Direct endpoint-coroutine unit test for POST /articles/form-runs.

The integration coverage (test_run_resolution_endpoints) exercises this through
the ASGI transport, whose handler lines do not register on coverage (the 80%
diff-cover gate's blind spot). This calls the coroutine directly so the
BOLA-scoped resolve_form_runs call is covered — mirrors test_article_files_unit.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.articles import post_form_runs
from app.schemas.extraction_run import ArticleRunRef, FormRunsRequest

_EP = "app.api.v1.endpoints.articles"


@pytest.mark.asyncio
async def test_form_runs_endpoint_threads_project_id_into_resolver() -> None:
    pid, aid, tid = uuid4(), uuid4(), uuid4()
    refs = [ArticleRunRef(article_id=aid, run_id=None)]
    body = FormRunsRequest(article_ids=[aid], template_id=tid, project_id=pid)

    with (
        patch(f"{_EP}.ensure_project_member", AsyncMock()) as gate,
        patch(f"{_EP}.resolve_form_runs", AsyncMock(return_value=refs)) as resolve,
        patch(f"{_EP}._trace", return_value=None),
    ):
        resp = await post_form_runs(
            body=body, request=MagicMock(), db=AsyncMock(), current_user_sub=uuid4()
        )

    gate.assert_awaited_once()
    # BOLA: the body's project_id must scope the resolver, not just the gate.
    _, kwargs = resolve.call_args
    assert kwargs["project_id"] == pid
    assert kwargs["template_id"] == tid
    assert resp.ok is True
    assert resp.data == refs
