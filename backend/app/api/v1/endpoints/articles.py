"""Article-scoped run-resolution endpoints.

Provides three endpoints for the frontend to resolve extraction runs by
article, replacing the PostgREST queries in ExtractionValueService:

  GET  /{article_id}/active-run?template_id=    → RunSummaryResponse | None
  GET  /{article_id}/finalized-run?template_id= → RunSummaryResponse | None
  POST /form-runs                               → list[ArticleRunRef]

BOLA enforcement:
  - active-run / finalized-run: derive project_id from the article row via
    get_article_project_id, then call ensure_project_member.
  - form-runs: project_id is supplied in the request body; call
    ensure_project_member directly.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps.security import ensure_project_member, get_current_user_sub
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.extraction_run import ArticleRunRef, FormRunsRequest, RunSummaryResponse
from app.services.citation_read_service import ArticleNotFoundError, get_article_project_id
from app.services.extraction_run_read_service import (
    find_active_run,
    find_finalized_run,
    resolve_form_runs,
)

router = APIRouter()


def _trace(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.get("/{article_id}/active-run")
async def get_active_run(
    article_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
    template_id: UUID | None = None,
) -> ApiResponse[RunSummaryResponse | None]:
    """Return the latest non-terminal extraction run for the article.

    Returns null (data: null) when no active run exists. 404 when the
    article is not found; 403 when the caller is not a project member.
    """
    try:
        project_id = await get_article_project_id(db, article_id)
    except ArticleNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await ensure_project_member(db, project_id, current_user_sub)

    run = await find_active_run(db, article_id, template_id=template_id)
    return ApiResponse.success(run, trace_id=_trace(request))


@router.get("/{article_id}/finalized-run")
async def get_finalized_run(
    article_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
    template_id: UUID | None = None,
) -> ApiResponse[RunSummaryResponse | None]:
    """Return the latest finalized extraction run for the article.

    Returns null (data: null) when no finalized run exists. 404 when the
    article is not found; 403 when the caller is not a project member.
    """
    try:
        project_id = await get_article_project_id(db, article_id)
    except ArticleNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await ensure_project_member(db, project_id, current_user_sub)

    run = await find_finalized_run(db, article_id, template_id=template_id)
    return ApiResponse.success(run, trace_id=_trace(request))


@router.post("/form-runs")
async def post_form_runs(
    body: FormRunsRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[list[ArticleRunRef]]:
    """Resolve the latest relevant run per article for the extraction form.

    Per article: returns the latest non-terminal run; falls back to the
    latest finalized run; returns run_id=null when no run exists.
    Cancelled runs are excluded. BOLA-gated via project_id in the body.
    """
    await ensure_project_member(db, body.project_id, current_user_sub)

    refs = await resolve_form_runs(db, body.article_ids, template_id=body.template_id)
    return ApiResponse.success(refs, trace_id=_trace(request))
