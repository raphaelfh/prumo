"""Typed section writes for the template config editor (B-7 task 3).

Replaces the frontend's direct PostgREST writes on
``extraction_entity_types`` (templateService.ts createSection /
deleteSection) with manager-gated, BOLA-checked, server-validated
operations. BOLA chain (panel 5): every operation re-verifies
entity_type -> template -> project — the path template must belong to
the path project (404, never 403, so foreign ids don't leak existence),
and any section/parent id must belong to THAT template.

Server-side ``sort_order``: computed as max+1 template-wide by a scalar
subquery inside the INSERT itself, killing the frontend's
read-then-write race (two racing creates no longer read the same max).

Draft-marker contract (B-4): every write here fires the 0048 AFTER-row
trigger, which stamps ``config_draft_since`` on the owning template and
row-locks it — serializing edits behind ``republish``'s FOR UPDATE. The
trigger is deliberately NOT ported into this service (B-7 plan: the
trigger stays the seed/E2E/clone chokepoint and owns the lock ordering).

The deferred ``trg_check_model_section_parent_role`` trigger fires only
at COMMIT — outside this flush-only service — so its predicate (a
model_section's parent must be a model_container) is pre-checked here
and surfaced as the typed ``SectionParentRoleError``. The trigger
remains the commit-time backstop for races (a parent whose role changes
concurrently aborts the endpoint's commit with a raw 23514-class error).

Services flush, never commit (the endpoint owns the transaction).
"""

from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEntityType, ProjectExtractionTemplate
from app.schemas.template_structure import (
    SectionCreateRequest,
    SectionDeleteResponse,
    SectionRead,
    SectionRenameRequest,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError

# Constraint names duplicated as literals on purpose: both are frozen by
# shipped migrations (0016 partial unique index; baseline FK) and the
# schemas/services layers must not depend on migration internals.
_ONE_CONTAINER_INDEX = "uq_extraction_entity_types_one_container_per_project"
_INSTANCES_ENTITY_TYPE_FK = "extraction_instances_entity_type_id_fkey"


class SectionNotFoundError(Exception):
    """Section (or referenced parent) is not part of the path template.

    404-class: raised for genuinely missing ids AND for ids owned by
    another template/project, so existence never leaks."""


class SectionParentRoleError(Exception):
    """A model_section's parent must be the template's model_container.

    400-class: deterministic request-time surface of the deferred
    ``trg_check_model_section_parent_role`` predicate."""


class OneContainerError(Exception):
    """The template already has a model_container.

    409-class: remap of the 23505 from the partial unique index
    ``uq_extraction_entity_types_one_container_per_project``."""


class SectionInUseError(Exception):
    """The section still has extraction instances.

    409-class: remap of the 23503 from the RESTRICT FK
    ``extraction_instances_entity_type_id_fkey`` (fires for the section
    itself or, via the parent cascade, for any of its model_sections)."""


def _violates(exc: IntegrityError, constraint_name: str) -> bool:
    """True when ``exc`` is a violation of ``constraint_name``.

    asyncpg exposes the violated constraint on ``constraint_name`` —
    reachable via ``exc.orig`` or its ``__cause__`` once SQLAlchemy's
    dbapi adapter wraps the driver error; fall back to the message text
    (Postgres always names the constraint there)."""
    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None)):
        if getattr(candidate, "constraint_name", None) == constraint_name:
            return True
    return constraint_name in str(orig or exc)


async def _owned_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> ProjectExtractionTemplate:
    """BOLA guard: 404 (not 403) so foreign ids don't leak existence."""
    tpl = await db.get(ProjectExtractionTemplate, template_id)
    if tpl is None or tpl.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")
    return tpl


async def _owned_section(
    db: AsyncSession, *, template_id: UUID, section_id: UUID
) -> ExtractionEntityType:
    """BOLA guard: the section must belong to THIS template (project
    lineage) — a foreign or global-lineage id 404s identically."""
    section = (
        await db.execute(
            select(ExtractionEntityType).where(
                ExtractionEntityType.id == section_id,
                ExtractionEntityType.project_template_id == template_id,
            )
        )
    ).scalar_one_or_none()
    if section is None:
        raise SectionNotFoundError(f"Section {section_id} not found")
    return section


async def create_section(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    payload: SectionCreateRequest,
) -> SectionRead:
    """Create a section in the template; sort_order is server-computed.

    Raises ProjectTemplateNotFoundError / SectionNotFoundError (BOLA),
    SectionParentRoleError (parent is not the model_container), or
    OneContainerError (second model_container, 23505)."""
    await _owned_template(db, project_id=project_id, template_id=template_id)
    if payload.parent_entity_type_id is not None:
        parent = await _owned_section(
            db, template_id=template_id, section_id=payload.parent_entity_type_id
        )
        if parent.role != "model_container":
            raise SectionParentRoleError(
                "A model_section's parent must be the template's model_container"
            )

    next_sort_order = (
        select(func.coalesce(func.max(ExtractionEntityType.sort_order), 0) + 1)
        .where(ExtractionEntityType.project_template_id == template_id)
        .scalar_subquery()
    )
    section = ExtractionEntityType(
        project_template_id=template_id,
        template_id=None,
        name=payload.name,
        label=payload.label,
        description=payload.description,
        cardinality=payload.cardinality,
        role=payload.role,
        parent_entity_type_id=payload.parent_entity_type_id,
        is_required=payload.is_required,
        sort_order=next_sort_order,
    )
    db.add(section)
    try:
        await db.flush()
    except IntegrityError as exc:
        if _violates(exc, _ONE_CONTAINER_INDEX):
            raise OneContainerError("This template already has a model container") from exc
        raise
    # sort_order was written as a SQL expression and created_at is a
    # server default — reload both for the response payload.
    await db.refresh(section)
    return SectionRead.model_validate(section)


async def rename_section(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    section_id: UUID,
    payload: SectionRenameRequest,
) -> SectionRead:
    """Rename a section (label only; already trimmed by the schema).

    A no-op rename (same label) skips the write so the 0048 trigger does
    not stamp the draft marker (the instruction-service precedent)."""
    await _owned_template(db, project_id=project_id, template_id=template_id)
    section = await _owned_section(db, template_id=template_id, section_id=section_id)
    if payload.label != section.label:
        section.label = payload.label
        await db.flush()
    return SectionRead.model_validate(section)


async def delete_section(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    section_id: UUID,
) -> SectionDeleteResponse:
    """Delete a section; the DB cascades its fields and child sections.

    Raises SectionInUseError (23503) when the section — or a child
    model_section reached via the parent cascade — still has extraction
    instances (RESTRICT FK)."""
    await _owned_template(db, project_id=project_id, template_id=template_id)
    await _owned_section(db, template_id=template_id, section_id=section_id)
    try:
        # Core DELETE (not ORM cascade): one statement, the DB cascades
        # fields + child sections, and the RESTRICT FK stays the arbiter.
        await db.execute(delete(ExtractionEntityType).where(ExtractionEntityType.id == section_id))
    except IntegrityError as exc:
        if _violates(exc, _INSTANCES_ENTITY_TYPE_FK):
            raise SectionInUseError(
                "This section has extracted data and cannot be deleted"
            ) from exc
        raise
    return SectionDeleteResponse(id=section_id, deleted=True)
