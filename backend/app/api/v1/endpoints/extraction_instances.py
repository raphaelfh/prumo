"""Extraction instance endpoints.

``POST /api/v1/extraction/instances`` — create one entry of a repeating
section, with its singleton children, in one transaction.

``DELETE /api/v1/extraction/instances`` — delete SEVERAL entries in one
transaction. Not N of the browser's single deletes: an entry cascades to its
children, its values and its reviewer decisions, so a half-finished batch is
a state no undo restores.

``PATCH /api/v1/extraction/instances/{instance_id}`` — rename and/or re-key
one entry of a repeating section. The client sends the coordinate it holds
(project, article, template); the service binds the id to it through the one
instance-in-coordinate predicate, so a foreign row answers 404. A rename or
re-key is a reviewer write (it changes what every reviewer sees and what the
AI re-run matches), hence the same reviewer gate as manual model creation.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError

from app.api.deps.security import (
    ensure_project_manager,
    ensure_project_member,
    ensure_project_reviewer,
    get_current_user_sub,
)
from app.core.deps import DbSession
from app.core.integrity import violates_constraint
from app.schemas.common import ApiResponse
from app.schemas.extraction import (
    EntryBulkDeleteRequest,
    EntryBulkDeleteResponse,
    EntryCreateRequest,
    EntryCreateResponse,
    InstanceIdentityUpdateRequest,
)
from app.schemas.extraction_run import RunViewInstance
from app.services.entry_bulk_delete_service import (
    EntryNotFoundError,
    EntryNotRepeatingError,
    delete_entries,
)
from app.services.entry_hierarchy_service import (
    EntryHierarchyService,
    EntryKeyDuplicateError,
    EntryTargetNotFoundError,
    InvalidEntryTargetError,
)
from app.services.instance_identity_service import (
    InstanceNotFoundError,
    update_instance_identity,
)
from app.utils.rate_limiter import limiter

router = APIRouter()

#: Named as a literal on purpose, like its siblings: the constraint is frozen
#: by a shipped migration (0040) and the api layer must not import migration
#: internals to learn its name.
_PUBLISHED_STATES_FK = "extraction_published_states_instance_id_fkey"


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
    except InvalidEntryTargetError as exc:
        # The body is well formed but names a target that cannot hold an
        # entry. Deliberately NOT a bare `except ValueError`: an unrelated
        # ValueError from below is a bug, and answering 422 with its internal
        # message echoed in `detail` would both mis-state the cause and leak
        # it. Anything else reaches the 500 handler.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await db.commit()
    return ApiResponse.success(created, trace_id=trace_id)


@router.delete(
    "",
    response_model=ApiResponse[EntryBulkDeleteResponse],
    summary="Delete several entries of a repeating section",
    description=(
        "All or nothing: every id is bound to the request coordinate first, "
        "so one foreign or missing id refuses the WHOLE batch and deletes "
        "nothing. A singleton instance is refused with a 422."
    ),
)
@limiter.limit("30/minute")
async def delete_entries_endpoint(
    request: Request,  # noqa: ARG001 — read by the rate limiter
    payload: EntryBulkDeleteRequest,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[EntryBulkDeleteResponse]:
    trace_id = getattr(request.state, "trace_id", None) or "missing-trace-id"
    await ensure_project_member(db, payload.project_id, current_user_sub)
    # MANAGER, not reviewer — deliberately stricter than the create sibling.
    # The RLS policy on this very table is
    # `extraction_instances_delete USING is_project_manager(...)`, and the
    # single delete beside this one is a browser PostgREST call that RLS
    # therefore refuses to a reviewer. Gating the bulk path on
    # `is_project_reviewer` would make the API the MORE permissive of two
    # implementations of one predicate, on a destructive path — the exact
    # drift `.claude/rules/backend.md` § Ownership guards exists to stop.
    # `ensure_project_manager` calls `public.is_project_manager`, the same
    # function the policy calls.
    await ensure_project_manager(db, payload.project_id, current_user_sub)
    try:
        deleted = await delete_entries(
            db,
            instance_ids=payload.instance_ids,
            project_id=payload.project_id,
            article_id=payload.article_id,
            template_id=payload.template_id,
        )
    except EntryNotFoundError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EntryNotRepeatingError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    try:
        await db.commit()
    except IntegrityError as exc:
        # `extraction_published_states.instance_id` is the ONE child FK that
        # does not cascade: NO ACTION, DEFERRABLE INITIALLY DEFERRED. It
        # therefore fires at COMMIT — outside the block above — so without
        # this the reviewer gets a bare 500 for the one refusal the UI
        # already knows how to explain ("this entry is pinned by a published
        # revision"). The single delete answers 409 with the constraint name;
        # so does this one, and the message carries the name the client
        # matches on.
        await db.rollback()
        if violates_constraint(exc, _PUBLISHED_STATES_FK):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Entry is pinned by a published revision "
                    f"({_PUBLISHED_STATES_FK}); it cannot be deleted."
                ),
            ) from exc
        raise
    return ApiResponse.success(EntryBulkDeleteResponse(deleted=deleted), trace_id=trace_id)


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
