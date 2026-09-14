"""Template catalogue reads.

- ``GET /templates/global?kind=`` — the global templates offered for import.
- ``GET /projects/{project_id}/templates?kind=`` — a project's own templates,
  active and inactive.

They replace the browser's direct reads of ``extraction_templates_global`` and
``project_extraction_templates`` (constitution §VI). Routes carry full paths,
so the router is mounted without a prefix.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.api.deps.security import get_current_user_sub, require_project_scope
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.template_catalogue import (
    GlobalTemplateSummaryRead,
    ProjectTemplateRead,
    TemplateKindLiteral,
)
from app.services.template_catalogue_service import (
    list_global_templates,
    list_project_templates,
)

router = APIRouter()


@router.get("/templates/global")
async def get_global_templates(
    request: Request,
    db: DbSession,
    kind: TemplateKindLiteral = Query(...),
    _user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[list[GlobalTemplateSummaryRead]]:
    """The global catalogue of one kind.

    Any signed-in user may read it — the same rule as the table's
    ``SELECT USING (true)`` policy.
    """
    templates = await list_global_templates(db, kind=kind)
    return ApiResponse.success(templates, trace_id=getattr(request.state, "trace_id", None))


@router.get("/projects/{project_id}/templates")
async def get_project_templates(
    project_id: UUID,
    request: Request,
    db: DbSession,
    kind: TemplateKindLiteral = Query(...),
    _user_sub: UUID = Depends(require_project_scope),
) -> ApiResponse[list[ProjectTemplateRead]]:
    """The project's templates of one kind, for members — the table's read
    policy is ``is_project_member``."""
    templates = await list_project_templates(db, project_id=project_id, kind=kind)
    return ApiResponse.success(templates, trace_id=getattr(request.state, "trace_id", None))
