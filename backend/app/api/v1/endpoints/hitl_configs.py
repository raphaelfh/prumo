"""HITL configuration endpoints (project + template scope).

These power the Project Settings → Review consensus UI. Resolution
order at Run creation is unchanged: ``template > project > system_default``.
The endpoints here are CRUD-style: they let a manager set the
project-wide default and optionally override per template.

Response semantics
------------------
* ``GET`` — always returns a resolved config plus an ``inherited`` flag
  so the UI can display a "Inherits from project" badge instead of a
  blank form when no row exists at the requested scope.
* ``PUT`` — upsert. The route always replaces the full payload (no
  partial PATCH); a write at this scope makes ``inherited`` false.
* ``DELETE`` — drop the row at this scope. The next ``GET`` will
  resolve up the chain and report ``inherited=true``.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager, require_project_scope
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.hitl_config import HitlConfigPayload, HitlConfigRead
from app.services.hitl_config_service import (
    ArbitratorNotProjectMemberError,
    HitlConfigService,
    ProjectTemplateNotFoundError,
    TemplateProjectMismatchError,
)

router = APIRouter()


def _to_read(snapshot: dict) -> HitlConfigRead:
    """Convert a service snapshot dict into the API response model."""
    scope_id = snapshot.get("scope_id")
    return HitlConfigRead(
        scope_kind=snapshot["scope_kind"],
        scope_id=UUID(scope_id) if scope_id else None,
        reviewer_count=snapshot["reviewer_count"],
        consensus_rule=snapshot["consensus_rule"],
        arbitrator_id=(UUID(snapshot["arbitrator_id"]) if snapshot.get("arbitrator_id") else None),
        inherited=bool(snapshot.get("inherited", False)),
    )


# ---------------------------------------------------------------------------
# Project-scoped
# ---------------------------------------------------------------------------


@router.get("/{project_id}/hitl-config")
async def get_project_hitl_config(
    project_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_scope),
) -> ApiResponse[HitlConfigRead]:
    """Return the resolved HITL config for the project.

    Any project member can read; the UI uses this to display the project
    default and to populate the per-template "inherit from project"
    placeholder.
    """
    service = HitlConfigService(db)
    snapshot = await service.get_for_project(project_id)
    return ApiResponse.success(
        _to_read(snapshot),
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.put("/{project_id}/hitl-config")
async def upsert_project_hitl_config(
    project_id: UUID,
    body: HitlConfigPayload,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[HitlConfigRead]:
    service = HitlConfigService(db)
    try:
        snapshot = await service.upsert_for_project(
            project_id=project_id,
            reviewer_count=body.reviewer_count,
            consensus_rule=body.consensus_rule,
            arbitrator_id=body.arbitrator_id,
        )
    except ArbitratorNotProjectMemberError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        _to_read(snapshot),
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.delete("/{project_id}/hitl-config", status_code=status.HTTP_200_OK)
async def delete_project_hitl_config(
    project_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[HitlConfigRead]:
    service = HitlConfigService(db)
    snapshot = await service.clear_for_project(project_id)
    await db.commit()
    return ApiResponse.success(
        _to_read(snapshot),
        trace_id=getattr(request.state, "trace_id", None),
    )


# ---------------------------------------------------------------------------
# Template-scoped (still rooted at the project URL for auth simplicity)
# ---------------------------------------------------------------------------


@router.get("/{project_id}/templates/{project_template_id}/hitl-config")
async def get_template_hitl_config(
    project_id: UUID,
    project_template_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_scope),
) -> ApiResponse[HitlConfigRead]:
    service = HitlConfigService(db)
    try:
        snapshot = await service.get_for_template(project_id, project_template_id)
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except TemplateProjectMismatchError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ApiResponse.success(
        _to_read(snapshot),
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.put("/{project_id}/templates/{project_template_id}/hitl-config")
async def upsert_template_hitl_config(
    project_id: UUID,
    project_template_id: UUID,
    body: HitlConfigPayload,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[HitlConfigRead]:
    service = HitlConfigService(db)
    try:
        snapshot = await service.upsert_for_template(
            project_id=project_id,
            project_template_id=project_template_id,
            reviewer_count=body.reviewer_count,
            consensus_rule=body.consensus_rule,
            arbitrator_id=body.arbitrator_id,
        )
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except TemplateProjectMismatchError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ArbitratorNotProjectMemberError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        _to_read(snapshot),
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.delete(
    "/{project_id}/templates/{project_template_id}/hitl-config",
    status_code=status.HTTP_200_OK,
)
async def delete_template_hitl_config(
    project_id: UUID,
    project_template_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[HitlConfigRead]:
    service = HitlConfigService(db)
    try:
        snapshot = await service.clear_for_template(project_id, project_template_id)
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except TemplateProjectMismatchError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        _to_read(snapshot),
        trace_id=getattr(request.state, "trace_id", None),
    )
