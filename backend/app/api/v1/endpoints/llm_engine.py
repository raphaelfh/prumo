"""Per-project LLM engine endpoints (§5, C1b).

Auth + error mapping + envelope, nothing else — the whole read model lives
in ``LlmEngineService.get_engine_read``.

GET is member-visible via ``require_project_scope``, the true
member-of-path dependency (never ``Depends(ensure_project_member)``, whose
bare ``user_sub`` param would materialise as a client-supplied query
parameter). PUT stays ``require_project_manager``.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager, require_project_scope
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.llm_engine import (
    LlmEngineRead,
    LlmEngineUpdateRequest,
    UserEngineClearResult,
    UserEngineUpdateRequest,
)
from app.services.llm_engine_service import (
    LlmEngineService,
    ProjectNotFoundError,
    viewer_is_manager,
)
from app.services.user_engine_service import clear_user_engine, set_user_engine
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.get("/{project_id}/llm-engine", response_model=ApiResponse[LlmEngineRead])
@limiter.limit("60/minute")
async def get_llm_engine(
    project_id: UUID,
    request: Request,
    db: DbSession,
    viewer_id: UUID = Depends(require_project_scope),
) -> ApiResponse[LlmEngineRead]:
    """Resolved engine + catalogue + the caller's per-provider availability."""
    trace_id = getattr(request.state, "trace_id", None)
    try:
        data = await LlmEngineService(db).get_engine_read(project_id, viewer_id)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    return ApiResponse.success(data, trace_id=trace_id)


@router.put("/{project_id}/llm-engine", response_model=ApiResponse[LlmEngineRead])
@limiter.limit("30/minute")
async def set_llm_engine(
    project_id: UUID,
    body: LlmEngineUpdateRequest,
    request: Request,
    db: DbSession,
    manager_id: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmEngineRead]:
    """Persist the project's default engine choice (validated, attributed).

    The default is always a catalogue pair (§3.1) — a host provider or an
    off-catalogue pair is a 400. ``user_choice_allowed`` rides the same
    write: ``False`` binds members to this default.
    """
    trace_id = getattr(request.state, "trace_id", None)
    service = LlmEngineService(db)
    try:
        await service.set_for_project(
            project_id=project_id,
            provider=body.provider,
            model=body.model,
            mode=body.mode,
            updated_by=manager_id,
            user_choice_allowed=body.user_choice_allowed,
        )
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    data = await service.get_engine_read(project_id, manager_id)
    await db.commit()
    return ApiResponse.success(data, trace_id=trace_id)


@router.put("/{project_id}/llm-engine/me", response_model=ApiResponse[LlmEngineRead])
@limiter.limit("30/minute")
async def set_my_llm_engine(
    project_id: UUID,
    body: UserEngineUpdateRequest,
    request: Request,
    db: DbSession,
    viewer_id: UUID = Depends(require_project_scope),
) -> ApiResponse[LlmEngineRead]:
    """The viewer's own engine for new runs (§4): 403 while locked for a
    non-manager, 422 without a credential (AppErrors, typed envelopes)."""
    trace_id = getattr(request.state, "trace_id", None)
    try:
        await set_user_engine(
            db,
            user_id=viewer_id,
            project_id=project_id,
            provider=body.provider,
            model=body.model,
            mode=body.mode,
            connection_id=body.connection_id,
            is_manager=await viewer_is_manager(db, project_id, viewer_id),
        )
        data = await LlmEngineService(db).get_engine_read(project_id, viewer_id)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=trace_id)


@router.delete("/{project_id}/llm-engine/me", response_model=ApiResponse[UserEngineClearResult])
@limiter.limit("30/minute")
async def clear_my_llm_engine(
    project_id: UUID,
    request: Request,
    db: DbSession,
    viewer_id: UUID = Depends(require_project_scope),
) -> ApiResponse[UserEngineClearResult]:
    """Drop the viewer's own row — the project default takes over again."""
    cleared = await clear_user_engine(db, user_id=viewer_id, project_id=project_id)
    await db.commit()
    return ApiResponse.success(
        UserEngineClearResult(cleared=cleared), trace_id=getattr(request.state, "trace_id", None)
    )
