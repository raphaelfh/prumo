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

The deferred ``trg_check_section_parent_repeats`` trigger (0069) fires
only at COMMIT — outside this flush-only service — so its predicate (a
section's parent must repeat) is pre-checked here and surfaced as the
typed ``SectionParentMustRepeatError``. The trigger remains the
commit-time backstop for races (a parent that stops repeating
concurrently aborts the endpoint's commit with a raw 23514-class error).

Services flush, never commit (the endpoint owns the transaction).
"""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Select, delete, func, select
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


class SectionNotFoundError(Exception):
    """Section (or referenced parent) is not part of the path template.

    404-class: raised for genuinely missing ids AND for ids owned by
    another template/project, so existence never leaks."""


class SectionParentMustRepeatError(Exception):
    """A section may name a parent only if that parent repeats.

    422-class: deterministic request-time surface of the deferred
    ``trg_check_section_parent_repeats`` predicate (0069). Replaces
    ``SectionParentRoleError``, which required the parent to BE the one
    model container; any entry group owns children now.

    ``OneContainerError`` left with it: it remapped the 23505 from 0016's
    partial unique index, and a template may hold several root groups, so
    there is no second container to refuse."""


class SectionInUseError(Exception):
    """Recorded extraction work lives under the section.

    409-class. The arbiter is
    ``ExtractionFieldReferenceRepository.sections_hold_recorded_work`` over
    the section's whole subtree, NOT the
    ``extraction_instances_entity_type_id_fkey`` RESTRICT -- that FK counts
    the empty containers a HITL session seeds on open, so it made every
    main section permanently un-deletable the moment one reviewer opened
    one article. The FKs remain the commit-time backstop for a race."""


class SectionEntryLabelCardinalityError(Exception):
    """``entry_label`` is only editable on a repeating section.

    422-class: deterministic rule (B-8, D5; unlocked from the container in
    the entry-group train) — the entry noun names one entry of a
    ``cardinality='many'`` section, so a section that does not repeat has
    nothing for it to name; no retry can succeed."""


class SectionOwnsChildrenError(Exception):
    """many -> one refused: the section owns child sections.

    422-class: a child is filled once per ENTRY, so a section that stops
    repeating leaves its children hanging off nothing. Replaces
    ``SectionCardinalityRoleError``, which refused the edit on every
    section except a ``model_section``; cardinality is editable on any
    section now (spec §5), and this is the rule that protects the data."""


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

    Raises ProjectTemplateNotFoundError / SectionNotFoundError (BOLA) or
    SectionParentMustRepeatError (the named parent is not an entry group)."""
    await owned_template(db, project_id=project_id, template_id=template_id)
    if payload.parent_entity_type_id is not None:
        parent = await owned_section(
            db, template_id=template_id, section_id=payload.parent_entity_type_id
        )
        if parent.cardinality != "many":
            raise SectionParentMustRepeatError(
                "A section's parent must repeat: only an entry group owns per-entry children"
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
        parent_entity_type_id=payload.parent_entity_type_id,
        # Post-validator value: the trimmed noun on a repeating section,
        # None on every other (the schema refuses it there).
        entry_label=payload.entry_label,
        is_required=payload.is_required,
        sort_order=next_sort_order,
    )
    db.add(section)
    await db.flush()
    # sort_order was written as a SQL expression and created_at is a
    # server default — reload both for the response payload.
    await db.refresh(section)
    return SectionRead.model_validate(section)


async def has_multi_entry_parent(db: AsyncSession, *, section_id: UUID) -> bool:
    """True when any parent instance holds 2+ instances of this section.

    Shared with ``TemplateVersionService.republish``, which re-runs the
    many->one rule under its publish locks (B-8 review): a reviewer on a
    run still pinned to the old 'many' snapshot can add entries between
    the PATCH-time check below and Publish.

    Grouped by ``(article_id, parent_instance_id)``, not by parent alone.
    A ROOT section's instances all carry ``parent_instance_id IS NULL``,
    so grouping by the parent alone collapses every article in the
    project into ONE bucket and reports "2+ entries" for a section that
    holds exactly one per article. Unreachable while cardinality was
    editable only on a ``model_section`` (which always has a parent);
    trees B5 makes cardinality editable on any section, which is what
    exposes it."""
    row = (
        await db.execute(
            select(ExtractionInstance.article_id)
            .where(ExtractionInstance.entity_type_id == section_id)
            .group_by(ExtractionInstance.article_id, ExtractionInstance.parent_instance_id)
            .having(func.count() >= 2)
            .limit(1)
        )
    ).first()
    return row is not None


async def owns_children(db: AsyncSession, *, section_id: UUID) -> bool:
    """True when any section names this one as its parent."""
    return (
        await db.execute(
            select(ExtractionEntityType.id)
            .where(ExtractionEntityType.parent_entity_type_id == section_id)
            .limit(1)
        )
    ).first() is not None


async def update_section(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    section_id: UUID,
    payload: SectionUpdateRequest,
) -> SectionRead:
    """Partial section update (label / entry_label / cardinality / description).

    Rules (spec §5): ``entry_label`` only on a repeating section
    (SectionEntryLabelCardinalityError), and REQUIRED when a PATCH turns a
    section into one, unless the row already carries a noun — the 0069
    CHECK is the backstop, refusing here names the section. ``cardinality``
    is editable on ANY section now that roles are gone, but many -> one is
    refused while the section owns children (SectionOwnsChildrenError),
    which would leave them hanging off a singleton, and while any parent
    holds 2+ entries (SectionCardinalityInUseError) — the run view would
    stop rendering instances the completion gate still counts.
    ``description`` — the section's AI instruction — is editable on every
    section, and a blank clears it. Each provided field is applied
    only when it differs from the row; an all-no-op update skips the
    flush entirely so the 0048 trigger does not stamp the draft marker
    (extends the old rename-no-op contract)."""
    await owned_template(db, project_id=project_id, template_id=template_id)
    section = await owned_section(db, template_id=template_id, section_id=section_id)

    becoming_repeating = payload.cardinality == "many" and section.cardinality != "many"
    if payload.entry_label is not None and section.cardinality != "many" and not becoming_repeating:
        raise SectionEntryLabelCardinalityError(
            "entry_label can only be edited on a repeating section"
        )
    if becoming_repeating and not (payload.entry_label or section.entry_label):
        # The 0069 CHECK is the backstop; refusing here names the section.
        raise SectionEntryLabelCardinalityError(
            f'Section "{section.label}" needs a word for one entry before it can repeat'
        )
    if payload.cardinality == "one" and section.cardinality == "many":
        if await owns_children(db, section_id=section_id):
            raise SectionOwnsChildrenError(
                f'Section "{section.label}" owns sections that are filled once per entry; '
                "move or delete them before switching it to once-per-article"
            )
        if await has_multi_entry_parent(db, section_id=section_id):
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
    if payload.description is not None:
        # Blank clears: the column is nullable and an emptied textarea is a
        # real edit here, unlike a blanked label.
        description = payload.description or None
        if description != section.description:
            section.description = description
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

    A recursive CTE, not the two-level ``id = X OR parent = X`` it
    replaces. That shortcut was a real schema invariant —
    ``ck_extraction_entity_types_role_parent`` forced a parent on
    ``model_section`` rows and forbade one everywhere else, so nothing
    could sit below a child. 0069 drops that CHECK, so depth is unbounded
    and the two-level form would silently MISS descendants: a delete would
    report no recorded work while a grandchild held some, and its instance
    sweep would leave that grandchild's rows behind."""
    base = (
        select(ExtractionEntityType.id)
        .where(ExtractionEntityType.id == section_id)
        .cte("section_subtree", recursive=True)
    )
    descendants = select(ExtractionEntityType.id).where(
        ExtractionEntityType.parent_entity_type_id == base.c.id
    )
    return select(base.union_all(descendants).c.id)
