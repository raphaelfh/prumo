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

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Select, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.integrity import violates_constraint
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionInstance,
)
from app.repositories.extraction_field_reference_repository import (
    RESTRICT_FKS,
    ExtractionFieldReferenceRepository,
)
from app.schemas.template_structure import (
    SectionCreateRequest,
    SectionDeleteResponse,
    SectionRead,
    SectionUpdateRequest,
)
from app.services.project_template_active_service import owned_template

# Constraint names duplicated as literals on purpose: both are frozen by
# shipped migrations (0016 partial unique index; baseline FK) and the
# schemas/services layers must not depend on migration internals.
_ONE_CONTAINER_INDEX = "uq_extraction_entity_types_one_container_per_project"


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
    """Recorded extraction work lives under the section.

    409-class. The arbiter is
    ``ExtractionFieldReferenceRepository.sections_hold_recorded_work`` over
    the section's whole subtree, NOT the
    ``extraction_instances_entity_type_id_fkey`` RESTRICT -- that FK counts
    the empty containers a HITL session seeds on open, so it made every
    main section permanently un-deletable the moment one reviewer opened
    one article. The FKs remain the commit-time backstop for a race."""


class SectionEntryLabelRoleError(Exception):
    """``entry_label`` is only editable on a repeating section.

    422-class: deterministic rule (B-8, D5; unlocked from the container in
    the entry-group train) — the entry noun names one entry of a
    ``cardinality='many'`` section, so a section that does not repeat has
    nothing for it to name; no retry can succeed."""


class SectionCardinalityRoleError(Exception):
    """``cardinality`` is only editable on a per-model section.

    422-class (B-8, D5): roots keep their create-time choice and a
    group always repeats — only model_section rows may flip."""


class SectionCardinalityInUseError(Exception):
    """many -> one refused: a parent instance already holds 2+ entries.

    409-class (B-8, D5): the run view renders only ``instances[0]`` for
    cardinality-one sections while the completion gate counts required
    fields on EVERY instance — flipping would make those runs
    un-completable. The message names the section label."""


async def owned_section(
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
    await owned_template(db, project_id=project_id, template_id=template_id)
    if payload.parent_entity_type_id is not None:
        parent = await owned_section(
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
        # Post-validator value: 'model'-defaulted for containers, None
        # for every other role (the schema rejects it there).
        entry_label=payload.entry_label,
        is_required=payload.is_required,
        sort_order=next_sort_order,
    )
    db.add(section)
    try:
        await db.flush()
    except IntegrityError as exc:
        if violates_constraint(exc, _ONE_CONTAINER_INDEX):
            raise OneContainerError("This template already has a model container") from exc
        raise
    # sort_order was written as a SQL expression and created_at is a
    # server default — reload both for the response payload.
    await db.refresh(section)
    return SectionRead.model_validate(section)


async def has_multi_entry_parent(db: AsyncSession, *, section_id: UUID) -> bool:
    """True when any parent instance holds 2+ instances of this section.

    Shared with ``TemplateVersionService.republish``, which re-runs the
    many->one rule under its publish locks (B-8 review): a reviewer on a
    run still pinned to the old 'many' snapshot can add entries between
    the PATCH-time check below and Publish."""
    row = (
        await db.execute(
            select(ExtractionInstance.parent_instance_id)
            .where(ExtractionInstance.entity_type_id == section_id)
            .group_by(ExtractionInstance.parent_instance_id)
            .having(func.count() >= 2)
            .limit(1)
        )
    ).first()
    return row is not None


async def update_section(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    section_id: UUID,
    payload: SectionUpdateRequest,
) -> SectionRead:
    """Partial section update (label / entry_label / cardinality).

    Role rules (B-8, D5): ``entry_label`` only on a repeating section
    (SectionEntryLabelRoleError); ``cardinality`` only on model_section
    (SectionCardinalityRoleError); many -> one refused while any parent
    instance holds 2+ entries (SectionCardinalityInUseError) — the run
    view would stop rendering instances the completion gate still
    counts. Each provided field is applied only when it differs from the
    row; an all-no-op update skips the flush entirely so the 0048
    trigger does not stamp the draft marker (extends the old
    rename-no-op contract)."""
    await owned_template(db, project_id=project_id, template_id=template_id)
    section = await owned_section(db, template_id=template_id, section_id=section_id)

    if payload.entry_label is not None and section.cardinality != "many":
        raise SectionEntryLabelRoleError("entry_label can only be edited on a repeating section")
    if payload.cardinality is not None and section.role != "model_section":
        raise SectionCardinalityRoleError("cardinality can only be edited on a per-model section")
    if (
        payload.cardinality == "one"
        and section.cardinality == "many"
        and await has_multi_entry_parent(db, section_id=section_id)
    ):
        raise SectionCardinalityInUseError(
            f'Section "{section.label}" has an entry with multiple items; '
            "remove the extra items before switching it to once-per-entry"
        )

    changed = False
    for attr in ("label", "entry_label", "cardinality"):
        value = getattr(payload, attr)
        if value is not None and value != getattr(section, attr):
            setattr(section, attr, value)
            changed = True
    if changed:
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

    Raises SectionInUseError when RECORDED work (a proposal, a reviewer or
    consensus decision, a reviewer state, a published value) exists
    anywhere in the section's subtree. Empty instances are swept first:
    they are the containers ``HITLSessionService.open_or_resume`` seeds for
    every top-level cardinality-one section, so leaving the RESTRICT FK as
    the arbiter meant one reviewer opening one article froze the whole
    template's structure."""
    await owned_template(db, project_id=project_id, template_id=template_id)
    await owned_section(db, template_id=template_id, section_id=section_id)

    subtree = _subtree_section_ids(section_id)
    if await ExtractionFieldReferenceRepository(db).sections_with_recorded_work(subtree):
        raise SectionInUseError("This section has extracted data and cannot be deleted")

    try:
        await sweep_empty_instances(db, section_ids=subtree)
        # Core DELETE (not ORM cascade): one statement, the DB cascades
        # fields + child sections.
        await db.execute(delete(ExtractionEntityType).where(ExtractionEntityType.id == section_id))
    except IntegrityError as exc:
        # Backstop for a work row committed between the pre-check and here.
        if violates_constraint(exc, *RESTRICT_FKS):
            raise SectionInUseError(
                "This section has extracted data and cannot be deleted"
            ) from exc
        raise
    return SectionDeleteResponse(id=section_id, deleted=True)


async def sweep_empty_instances(
    db: AsyncSession, *, section_ids: Select[tuple[UUID]] | Sequence[UUID]
) -> None:
    """Delete the extraction instances of sections that are about to go.

    ``extraction_instances.entity_type_id`` is ON DELETE RESTRICT, so a
    section cannot be deleted while ANY instance references it — and a HITL
    session seeds one empty instance per top-level section on open. Without
    this sweep the FK, not the caller, decides what is deletable, and it
    answers "was this template ever opened" rather than "was anything
    recorded".

    CALLER'S PRECONDITION, and it is not optional: every section named here
    must already have been cleared by
    ``ExtractionFieldReferenceRepository.sections_with_recorded_work``. The
    rows this deletes cascade to reviewer decisions, reviewer states,
    proposals and consensus decisions, so sweeping a section that holds work
    would destroy it silently. Both callers check first; the five field-level
    RESTRICT FKs are the backstop for a row written in between.
    """
    await db.execute(
        delete(ExtractionInstance).where(ExtractionInstance.entity_type_id.in_(section_ids))
    )


def _subtree_section_ids(section_id: UUID) -> Select[tuple[UUID]]:
    """The section plus its per-model children, as a SELECT.

    A subquery rather than a materialized list: both consumers (the work
    probe and the instance sweep) inline it, so the subtree costs no round
    trip of its own.

    Exactly two levels, and that is a schema invariant rather than a
    shortcut: ``ck_extraction_entity_types_role_parent`` forces a parent on
    ``model_section`` rows and forbids one everywhere else, so nothing can
    sit below a child."""
    return select(ExtractionEntityType.id).where(
        or_(
            ExtractionEntityType.id == section_id,
            ExtractionEntityType.parent_entity_type_id == section_id,
        )
    )
