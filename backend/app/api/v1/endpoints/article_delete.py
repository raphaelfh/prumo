"""Bulk-delete articles (the article list's delete action).

Auth, gate order and envelope only — the delete lives in
``app.services.article_delete_service``. A non-member and a missing project
both get 404, a member who is not a manager gets 403; the manager rule is the
``articles_delete`` RLS policy that the browser used to hit through PostgREST.
The browser also removed the PDFs from storage first, so a reviewer's delete
wiped files while RLS kept every row. Here the rows are deleted and committed
first, and only then the storage objects.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import get_current_user_sub, is_project_manager, is_project_member
from app.core.deps import DbSession, SupabaseClient
from app.core.factories import create_storage_adapter
from app.schemas.article_delete import ArticleDeleteRead, ArticleDeleteRequest
from app.schemas.common import ApiResponse
from app.services.article_delete_service import delete_project_articles, remove_article_objects
from app.services.article_read_service import ArticleNotFoundError
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.post(
    "/{project_id}/articles/delete",
    response_model=ApiResponse[ArticleDeleteRead],
    responses={
        status.HTTP_403_FORBIDDEN: {"description": "A member who is not a project manager"},
        status.HTTP_404_NOT_FOUND: {
            "description": "Not a member of the project, no such project, or an article "
            "that is not in the project (nothing is deleted)"
        },
    },
)
@limiter.limit("30/minute")
async def delete_articles(
    project_id: UUID,
    body: ArticleDeleteRequest,
    request: Request,
    db: DbSession,
    supabase: SupabaseClient,
    user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ArticleDeleteRead]:
    """Delete the selected articles, then their PDFs; a storage failure is only counted."""
    if not await is_project_member(db, project_id, user_sub):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if not await is_project_manager(db, project_id, user_sub):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager role required")
    try:
        outcome = await delete_project_articles(
            db, project_id=project_id, article_ids=body.selection.ids
        )
    except ArticleNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    storage_failures = await remove_article_objects(
        create_storage_adapter(supabase), outcome.storage_keys
    )
    return ApiResponse.success(
        ArticleDeleteRead(deleted=outcome.deleted, storage_failures=storage_failures),
        trace_id=getattr(request.state, "trace_id", None),
    )
