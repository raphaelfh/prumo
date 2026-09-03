"""Extraction instance identity endpoint.

``PATCH /api/v1/extraction/instances/{instance_id}`` — rename and/or re-key
one entry of a repeating section. The client sends the coordinate it holds
(project, article, template); the service binds the id to it through the one
instance-in-coordinate predicate, so a foreign row answers 404. A rename or
re-key is a reviewer write (it changes what every reviewer sees and what the
AI re-run matches), hence the same reviewer gate as manual model creation.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import (
    ensure_project_member,
    ensure_project_reviewer,
    get_current_user_sub,
)
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.extraction import InstanceIdentityUpdateRequest
from app.schemas.extraction_run import RunViewInstance
from app.services.instance_identity_service import (
    InstanceNotFoundError,
    update_instance_identity,
)
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.patch(
    "/{instance_id}",
    response_model=ApiResponse[RunViewInstance],
    summary="Rename or re-key one extraction instance",
    description=(
        "Rewrites the entry's label and/or its identity key; a re-key appends "
        "{who, when, from, to} to the instance's entity_key_history."
    ),
)
@limiter.limit("60/minute")
async def update_instance(
    request: Request,  # noqa: ARG001 — read by the rate limiter
    instance_id: UUID,
    payload: InstanceIdentityUpdateRequest,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[RunViewInstance]:
    trace_id = getattr(request.state, "trace_id", None) or "missing-trace-id"
    await ensure_project_member(db, payload.project_id, current_user_sub)
    await ensure_project_reviewer(db, payload.project_id, current_user_sub)
    try:
        view = await update_instance_identity(
            db,
            instance_id=instance_id,
            project_id=payload.project_id,
            article_id=payload.article_id,
            template_id=payload.template_id,
            actor_id=current_user_sub,
            label=payload.label,
            entity_key=payload.entity_key,
        )
    except InstanceNotFoundError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    return ApiResponse.success(view, trace_id=trace_id)
