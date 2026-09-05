"""Extraction instance endpoints.

``POST /api/v1/extraction/instances`` — create one entry of a repeating
section, with its singleton children, in one transaction.

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
from app.schemas.extraction import (
    EntryCreateRequest,
    EntryCreateResponse,
    InstanceIdentityUpdateRequest,
)
from app.schemas.extraction_run import RunViewInstance
from app.services.entry_hierarchy_service import (
    EntryHierarchyService,
    EntryKeyDuplicateError,
    EntryTargetNotFoundError,
)
from app.services.instance_identity_service import (
    InstanceNotFoundError,
    update_instance_identity,
)
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.post(
    "",
    response_model=ApiResponse[EntryCreateResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Create one entry of a repeating section",
    description=(
        "Creates the entry and its singleton children in one transaction. "
        "A nested group requires parentInstanceId; a root group refuses one. "
        "A duplicate entry key answers a typed 409 ENTRY_KEY_DUPLICATE."
    ),
)
@limiter.limit("60/minute")
async def create_entry(
    request: Request,  # noqa: ARG001 — read by the rate limiter
    payload: EntryCreateRequest,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[EntryCreateResponse]:
    trace_id = getattr(request.state, "trace_id", None) or "missing-trace-id"
    await ensure_project_member(db, payload.project_id, current_user_sub)
    # Creating an entry records the key value as a ReviewerDecision, so it
    # carries the same reviewer gate as the PATCH below and as
    # POST /runs/{id}/decisions: a read-only viewer is a member but must
    # not author audit-trail rows.
    await ensure_project_reviewer(db, payload.project_id, current_user_sub)
    try:
        created = await EntryHierarchyService(db).create_entry(
            project_id=payload.project_id,
            article_id=payload.article_id,
            template_id=payload.template_id,
            entity_type_id=payload.entity_type_id,
            parent_instance_id=payload.parent_instance_id,
            label=payload.label,
            entity_key=payload.entity_key,
            user_id=current_user_sub,
        )
    except EntryKeyDuplicateError:
        await db.rollback()
        raise  # AppError -> the global handler's typed 409 envelope
    except EntryTargetNotFoundError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        # InvalidEntryTargetError and its siblings: the body is well formed
        # but names a target that cannot hold an entry.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await db.commit()
    return ApiResponse.success(created, trace_id=trace_id)


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
