"""Open or resume a HITL session for both extraction and quality-assessment.

A single ``POST /api/v1/hitl/sessions`` endpoint, kind-discriminated, with
one service and one response envelope.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import text

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.models.extraction import TemplateKind
from app.schemas.common import ApiResponse
from app.schemas.hitl_session import OpenHITLSessionRequest, OpenHITLSessionResponse
from app.services.hitl_session_service import (
    HITLSessionInputError,
    HITLSessionService,
    TemplateNotFoundError,
)
from app.services.run_lifecycle_service import InvalidStageTransitionError

router = APIRouter()


@router.post(
    "/sessions",
    # Status code is overridden per-request via `response.status_code`:
    # 201 when a brand-new Run is created, 200 when an existing Run is
    # resumed (issue #32). The decorator value is the "create" default.
    status_code=status.HTTP_201_CREATED,
)
async def open_hitl_session(
    body: OpenHITLSessionRequest,
    request: Request,
    response: Response,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[OpenHITLSessionResponse]:
    """Open or resume a HITL session for an article.

    Body shape depends on ``kind``:

    * ``quality_assessment``: pass ``global_template_id`` (PROBAST / QUADAS-2 / ...)
      for the first call. The service clones the global template into the
      project (idempotent) and ensures one instance per top-level domain.
      Subsequent calls may pass ``project_template_id`` directly to skip the
      clone lookup.
    * ``extraction``: pass ``project_template_id``. Extraction templates are
      authored per-project; there is no global pool to clone from.

    Re-calling reuses the existing in-flight Run instead of forking a new
    one. A finalized Run is returned read-only — the client should call the
    reopen endpoint to start a revision.
    """
    # The DB session runs as service-role (RLS bypassed); enforce project
    # membership manually using the same SQL helper the policies use.
    is_member = (
        await db.execute(
            text("SELECT public.is_project_member(:pid, :uid) AS ok"),
            {"pid": str(body.project_id), "uid": str(current_user_sub)},
        )
    ).scalar_one()
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project access denied",
        )
    service = HITLSessionService(db)
    try:
        session = await service.open_or_resume(
            kind=TemplateKind(body.kind),
            project_id=body.project_id,
            article_id=body.article_id,
            project_template_id=body.project_template_id,
            global_template_id=body.global_template_id,
            user_id=current_user_sub,
        )
    except TemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except HITLSessionInputError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except InvalidStageTransitionError as e:
        # Issue #67: a concurrent request (e.g. an admin cancelling the
        # run) moved the Run out of PENDING between our SELECT and the
        # internal advance to PROPOSAL. The caller should retry — return
        # 409 Conflict instead of bubbling up an unhandled 500.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await db.commit()
    # Issue #32: a resumed Run is not a created resource; emit 200.
    if not session.created:
        response.status_code = status.HTTP_200_OK
    return ApiResponse.success(
        OpenHITLSessionResponse(
            run_id=session.run_id,
            kind=session.kind.value,
            project_template_id=session.project_template_id,
            instances_by_entity_type=session.instances_by_entity_type,
        ),
        trace_id=getattr(request.state, "trace_id", None),
    )
