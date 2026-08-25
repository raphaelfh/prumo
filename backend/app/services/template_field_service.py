"""Typed field writes on the config editor's live tables (slice B-7).

Every operation re-verifies the full ownership chain in the service —
project -> template (``ProjectTemplateNotFoundError``) -> entity type
(``EntityTypeNotFoundError``) -> field (``FieldNotFoundError``) — with
404-not-403 semantics so foreign ids never leak existence. The endpoint
layer maps the typed errors; nothing here touches HTTP.

Draft contract (B-4): these writes land on the LIVE rows; the 0048
AFTER-row triggers stamp ``config_draft_since`` and row-lock the
template, serializing every edit behind ``republish``'s FOR UPDATE — no
advisory locks here (panel 4), and the trigger's port/retire is
consciously deferred (see the B-7 plan).

Name uniqueness is enforced per section (create/update/move) ahead of
the 0050 unique index; once that index lands, a racing writer that
slips past the read-time check is remapped from the 23505 backstop to
the same ``DuplicateFieldNameError``.

``sort_order`` is client-supplied on create/move/reorder (panel 10): it
is a per-section rendering convention computed at dequeue time by the
frontend's optimistic-row ghost chain; the schema validates >= 0.

Services flush, never commit — the endpoint owns the transaction.
"""

from typing import Any, cast
from uuid import UUID

from sqlalchemy import CursorResult, Integer, column, func, select, update, values
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ProjectExtractionTemplate,
)
from app.schemas.template_structure import (
    TemplateFieldCreateRequest,
    TemplateFieldDeleteResponse,
    TemplateFieldMoveRequest,
    TemplateFieldRead,
    TemplateFieldReorderRequest,
    TemplateFieldReorderResponse,
    TemplateFieldUpdateRequest,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError

__all__ = [
    "DuplicateEntityKeyError",
    "CrossTemplateMoveError",
    "DuplicateFieldNameError",
    "DuplicateReorderIdsError",
    "EntityTypeNotFoundError",
    "FieldInUseError",
    "FieldNotFoundError",
    "ProjectTemplateNotFoundError",
    "create_field",
    "delete_field",
    "move_field",
    "reorder_fields",
    "update_field",
]

_FK_VIOLATION = "23503"
_UNIQUE_VIOLATION = "23505"
# Frozen by the B-7 plan (panel 7); matches migration 0050's CREATE
# UNIQUE INDEX — the DB backstop behind the read-time checks below.
_FIELD_NAME_UNIQUE_INDEX = "uq_extraction_fields_entity_type_name"
# 0059: at most one identity field per section.
_ENTITY_KEY_UNIQUE_INDEX = "uq_extraction_fields_one_entity_key"


class EntityTypeNotFoundError(Exception):
    """The entity type does not belong to this template (404 family)."""


class FieldNotFoundError(Exception):
    """The field does not belong to a section of this template (404 family)."""


class DuplicateFieldNameError(Exception):
    """A sibling field in the target section already carries this name."""


class DuplicateEntityKeyError(Exception):
    """The section already declares an identity field (422).

    A section has ONE identity. Moving the key means clearing it on the
    current holder first; refusing here keeps the raw 23505 from the
    partial unique index out of the response.
    """


class FieldInUseError(Exception):
    """Workflow rows (RESTRICT FKs) pin the field — delete refused (409)."""


class CrossTemplateMoveError(Exception):
    """Move destination is not a section of this template (422).

    Raised uniformly whether the destination id exists elsewhere or not
    at all, so the response is no existence oracle. 422 — not 409 —
    because the payload references an illegal destination
    deterministically: no retry can succeed, while 409 is reserved in
    this stack for retryable state conflicts (B-4 drift republish).
    """


class DuplicateReorderIdsError(Exception):
    """The reorder batch names the same field twice (422 family)."""


def _pgcode(exc: IntegrityError) -> str | None:
    """SQLSTATE of the driver error under SQLAlchemy's dbapi adapter."""
    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None)):
        code = getattr(candidate, "sqlstate", None) or getattr(candidate, "pgcode", None)
        if code:
            return str(code)
    return None


def _is_field_name_unique_violation(exc: IntegrityError) -> bool:
    if _pgcode(exc) != _UNIQUE_VIOLATION:
        return False
    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None)):
        if getattr(candidate, "constraint_name", None) == _FIELD_NAME_UNIQUE_INDEX:
            return True
    return _FIELD_NAME_UNIQUE_INDEX in str(orig or exc)


async def _entity_key_taken(
    db: AsyncSession, *, entity_type_id: UUID, exclude_field_id: UUID | None = None
) -> bool:
    """Does a sibling already declare this section's identity?"""
    stmt = select(ExtractionField.id).where(
        ExtractionField.entity_type_id == entity_type_id,
        ExtractionField.is_entity_key.is_(True),
    )
    if exclude_field_id is not None:
        stmt = stmt.where(ExtractionField.id != exclude_field_id)
    return (await db.execute(stmt.limit(1))).scalar_one_or_none() is not None


async def _flush_name_guarded(db: AsyncSession) -> None:
    """Flush a name-bearing write; remap the 0050/0059 backstops to their
    typed errors (a racing writer past the read-time checks)."""
    try:
        await db.flush()
    except IntegrityError as exc:
        if _is_field_name_unique_violation(exc):
            raise DuplicateFieldNameError(
                "A field with this name already exists in this section"
            ) from exc
        if _ENTITY_KEY_UNIQUE_INDEX in str(getattr(exc, "orig", exc)):
            raise DuplicateEntityKeyError(
                "This section already has an entry key; clear it on the other field first"
            ) from exc
        raise


async def _owned_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> ProjectExtractionTemplate:
    """BOLA guard: 404 (not 403) so foreign ids don't leak existence."""
    tpl = await db.get(ProjectExtractionTemplate, template_id)
    if tpl is None or tpl.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")
    return tpl


async def _owned_entity_type(
    db: AsyncSession, *, template_id: UUID, entity_type_id: UUID
) -> ExtractionEntityType:
    """The section must belong to THIS template (global-lineage rows have
    ``project_template_id IS NULL`` and are refused too)."""
    entity_type = await db.get(ExtractionEntityType, entity_type_id)
    if entity_type is None or entity_type.project_template_id != template_id:
        raise EntityTypeNotFoundError(f"Entity type {entity_type_id} not found")
    return entity_type


async def _owned_field(db: AsyncSession, *, template_id: UUID, field_id: UUID) -> ExtractionField:
    """The field must live in a section of THIS template."""
    field = (
        await db.execute(
            select(ExtractionField)
            .join(
                ExtractionEntityType,
                ExtractionField.entity_type_id == ExtractionEntityType.id,
            )
            .where(
                ExtractionField.id == field_id,
                ExtractionEntityType.project_template_id == template_id,
            )
        )
    ).scalar_one_or_none()
    if field is None:
        raise FieldNotFoundError(f"Field {field_id} not found")
    return field


async def _name_taken(
    db: AsyncSession,
    *,
    entity_type_id: UUID,
    name: str,
    exclude_field_id: UUID | None = None,
) -> bool:
    """Per-section sibling name check; ``exclude_field_id`` keeps a
    self-rename / same-section move from colliding with itself."""
    stmt = select(ExtractionField.id).where(
        ExtractionField.entity_type_id == entity_type_id,
        ExtractionField.name == name,
    )
    if exclude_field_id is not None:
        stmt = stmt.where(ExtractionField.id != exclude_field_id)
    return (await db.execute(stmt.limit(1))).scalar_one_or_none() is not None


async def create_field(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    payload: TemplateFieldCreateRequest,
) -> TemplateFieldRead:
    """Insert a field into a section of the path template."""
    await _owned_template(db, project_id=project_id, template_id=template_id)
    await _owned_entity_type(db, template_id=template_id, entity_type_id=payload.entity_type_id)
    if await _name_taken(db, entity_type_id=payload.entity_type_id, name=payload.name):
        raise DuplicateFieldNameError(f"Field name '{payload.name}' already exists in this section")
    field = ExtractionField(**payload.model_dump())
    db.add(field)
    await _flush_name_guarded(db)
    return TemplateFieldRead.model_validate(field)


async def update_field(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    field_id: UUID,
    payload: TemplateFieldUpdateRequest,
) -> TemplateFieldRead:
    """Apply only the explicitly-set keys (``exclude_unset`` — the schema
    already forbids nulling non-nullable columns and smuggling
    ``entity_type_id``: relocation is ``move_field``'s job)."""
    await _owned_template(db, project_id=project_id, template_id=template_id)
    field = await _owned_field(db, template_id=template_id, field_id=field_id)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("is_entity_key") and await _entity_key_taken(
        db, entity_type_id=field.entity_type_id, exclude_field_id=field.id
    ):
        raise DuplicateEntityKeyError(
            "This section already has an entry key; clear it on the other field first"
        )
    if "name" in changes and await _name_taken(
        db,
        entity_type_id=field.entity_type_id,
        name=changes["name"],
        exclude_field_id=field.id,
    ):
        raise DuplicateFieldNameError(
            f"Field name '{changes['name']}' already exists in this section"
        )
    for key, value in changes.items():
        setattr(field, key, value)
    await _flush_name_guarded(db)
    return TemplateFieldRead.model_validate(field)


async def delete_field(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    field_id: UUID,
) -> TemplateFieldDeleteResponse:
    """Delete a field; the five workflow RESTRICT FKs (proposals,
    reviewer decisions/states, consensus, published states) surface as
    ``FieldInUseError`` — the endpoint maps it to 409."""
    await _owned_template(db, project_id=project_id, template_id=template_id)
    field = await _owned_field(db, template_id=template_id, field_id=field_id)
    await db.delete(field)
    try:
        await db.flush()
    except IntegrityError as exc:
        if _pgcode(exc) == _FK_VIOLATION:
            raise FieldInUseError(
                f"Field {field_id} has recorded extraction work and cannot be deleted"
            ) from exc
        raise
    return TemplateFieldDeleteResponse(id=field_id, deleted=True)


async def move_field(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    field_id: UUID,
    payload: TemplateFieldMoveRequest,
) -> TemplateFieldRead:
    """Re-parent a field onto another section of the SAME template.

    The destination check is the security core of this slice (panel
    1/4): the old PostgREST write path accepted any ``entity_type_id``
    the client sent — including another template's. A destination that
    does not resolve to a section of this template raises
    ``CrossTemplateMoveError`` uniformly (foreign and nonexistent ids
    are indistinguishable — no existence oracle).
    """
    await _owned_template(db, project_id=project_id, template_id=template_id)
    field = await _owned_field(db, template_id=template_id, field_id=field_id)
    destination = await db.get(ExtractionEntityType, payload.entity_type_id)
    if destination is None or destination.project_template_id != template_id:
        raise CrossTemplateMoveError(
            f"Destination {payload.entity_type_id} is not a section of this template"
        )
    if await _name_taken(
        db,
        entity_type_id=payload.entity_type_id,
        name=field.name,
        exclude_field_id=field.id,
    ):
        raise DuplicateFieldNameError(
            f"Field name '{field.name}' already exists in the destination section"
        )
    field.entity_type_id = payload.entity_type_id
    field.sort_order = payload.sort_order
    await _flush_name_guarded(db)
    return TemplateFieldRead.model_validate(field)


async def reorder_fields(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    payload: TemplateFieldReorderRequest,
) -> TemplateFieldReorderResponse:
    """Atomic batch renumber — one UPDATE ... FROM (VALUES ...).

    Multi-section batches are legal (panel 4 — a cross-section move
    renumbers two sections in one call). Ownership is verified by ONE
    joined query: every id must belong to a section of THIS template
    (match-count == batch size, else the 404 family). The single
    statement replaces the frontend's old N-independent-UPDATEs loop,
    so a batch either fully applies or fully fails; the rowcount
    assertion catches a row deleted between the check and the write.
    """
    await _owned_template(db, project_id=project_id, template_id=template_id)
    ids = [item.id for item in payload.updates]
    if len(set(ids)) != len(ids):
        raise DuplicateReorderIdsError("Reorder batch names the same field twice")

    owned_count = (
        await db.execute(
            select(func.count())
            .select_from(ExtractionField)
            .join(
                ExtractionEntityType,
                ExtractionField.entity_type_id == ExtractionEntityType.id,
            )
            .where(
                ExtractionField.id.in_(ids),
                ExtractionEntityType.project_template_id == template_id,
            )
        )
    ).scalar_one()
    if owned_count != len(ids):
        raise FieldNotFoundError("One or more fields not found in this template")

    new_orders = values(
        column("id", PG_UUID(as_uuid=True)),
        column("sort_order", Integer),
        name="new_orders",
    ).data([(item.id, item.sort_order) for item in payload.updates])
    result = await db.execute(
        update(ExtractionField)
        .where(ExtractionField.id == new_orders.c.id)
        .values(sort_order=new_orders.c.sort_order)
    )
    # execute() types the return as Result[Any]; an UPDATE yields a
    # CursorResult at runtime, which carries rowcount.
    updated = cast("CursorResult[Any]", result).rowcount or 0
    if updated != len(ids):
        raise FieldNotFoundError("One or more fields disappeared during reorder")
    return TemplateFieldReorderResponse(updated_count=updated)
