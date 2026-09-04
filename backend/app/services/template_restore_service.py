"""Write a published snapshot back into the live template rows (B-9c1, T1).

The inverse of ``extraction_snapshot.SNAPSHOT_SQL``: given a stored
``extraction_template_versions.schema_``, reconcile the live
``extraction_entity_types`` / ``extraction_fields`` rows until a fresh
snapshot build would reproduce it. Discard-draft (T2) and B-9e's
"restore vN as a draft" are the same writer with different sources and
different marker policies, which is why this module is a **pure
reconcile**:

* it never reads or writes ``config_draft_since`` (plan D7 — the Discard
  service clears the marker, in the same transaction, after the last
  flush; the 0048 AFTER-ROW triggers re-stamp it on every row written
  here and that is expected);
* it never decides refusals beyond the one structural impossibility it
  cannot write around (:class:`ContainerSwapUnsupportedError`, D3);
* it never commits.

Blunt delete-all-and-reinsert is impossible: ``extraction_instances``
and five workflow tables hold RESTRICT references to entity types and
fields. So the writer is a differential patch, and the phase order below
(plan D2) is the load-bearing part — ``extraction_fields.entity_type_id``
is ON DELETE **CASCADE**, so deleting a draft-added section before
re-parenting destroys the baseline fields the draft had moved into it,
and ``uq_extraction_fields_entity_type_name`` is immediate, so a draft
that deleted field ``x`` and renamed a sibling to ``x`` collides during
the create pass unless names are parked first. The entry key
(``uq_extraction_fields_one_entity_key``, partial and immediate) is parked
the same way with ``false`` as its universal park value — and because the
index is partial, a KEPT row can simply stop holding it, which a name slot
never allows.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from fastapi import status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionEntityType,
    ExtractionField,
    ProjectExtractionTemplate,
)
from app.schemas.hitl_session import TemplateDiscardRefusalCode
from app.services.template_clone_service import TemplateCloneService, TemplateNotFoundError
from app.services.template_diff import (
    ENTITY_ATTRIBUTE_DEFAULTS,
    ENTITY_KEY_KEY,
    FIELD_ATTRIBUTE_DEFAULTS,
    IDENTITY_KEY,
    NESTING_KEY,
    OPTION_KEY,
    ORDER_KEY,
    _instruction,
    _normalize_entity,
    _normalize_field,
)
from app.services.template_section_service import sweep_empty_instances
from app.services.template_version_service import TemplateVersionService

__all__ = [
    "ContainerSwapUnsupportedError",
    "RestoreOutcome",
    "restore_snapshot",
]

#: Transient, guaranteed-unique ``name`` a field wears between phase 0 and
#: phase 6. ``extraction_fields.name`` is an unconstrained ``String`` (the
#: 50-char cap is application-level only), so a long park value is legal.
_PARK_PREFIX = "__restore_"

_PARENT_KEY = "parent_entity_type_id"
_OWNER_KEY = "entity_type_id"
_NAME_KEY = "name"

#: The D1 projection: exactly what ``template_diff``'s normalizers emit,
#: plus the two columns they omit. Kept as tuples so the live side is read
#: through the same key list the baseline side is built from.
_ENTITY_KEYS: tuple[str, ...] = (*ENTITY_ATTRIBUTE_DEFAULTS, ORDER_KEY)
_FIELD_KEYS: tuple[str, ...] = (*FIELD_ATTRIBUTE_DEFAULTS, OPTION_KEY, _OWNER_KEY, ORDER_KEY)


class ContainerSwapUnsupportedError(AppError):
    """The draft replaced the template's ``model_container`` (D3).

    ``uq_extraction_entity_types_one_container_per_project`` is a partial
    unique index, so the create pass would collide with the container the
    delete pass has not reached yet. Solving it would need a third pass
    that parks the live container's role — deliberately out of scope.

    An ``AppError`` since B-9c2 D1, so the endpoint lets it propagate to
    ``app_error_handler`` with its own code instead of flattening it into a
    ``HTTP_ERROR`` no client can tell from the ack question.
    """

    def __init__(self, message: str) -> None:
        super().__init__(
            code=TemplateDiscardRefusalCode.CONTAINER_SWAP_UNSUPPORTED,
            message=message,
            status_code=status.HTTP_409_CONFLICT,
        )


@dataclass(frozen=True, slots=True)
class RestoreOutcome:
    """What the reconcile actually wrote. T2 wraps this into its response
    and its telemetry event."""

    created_entity_types: int = 0
    deleted_entity_types: int = 0
    updated_entity_types: int = 0
    created_fields: int = 0
    deleted_fields: int = 0
    updated_fields: int = 0
    instruction_reset: bool = False
    name_conflicted_field_ids: frozenset[UUID] = frozenset()
    """Baseline fields left exactly as the draft had them because a KEPT
    node holds their ``(entity_type_id, name)`` slot. The caller reports
    them; the marker must stay set while any of them exist."""


# --------------------------------------------------------------------------
# D1 — the comparison projection
# --------------------------------------------------------------------------
#
# Identity is the node id. The projection is the snapshot key set PLUS two
# columns the snapshot does not compare: ``sort_order`` (both node kinds)
# and a field's owning ``entity_type_id`` (derived from JSON nesting).
# ``template_diff``'s normalizers supply the canonical defaults for absent
# keys — including the role-aware ``entry_label`` rule that keeps a
# pre-0051 baseline from nulling a container's entry noun — but they are
# NOT the projection, because they omit exactly those two columns. Without
# them a field the draft only moved or reordered compares byte-identical
# and Discard silently fails to undo it.


def _as_uuid(raw: Any) -> UUID | None:
    return UUID(raw) if isinstance(raw, str) else raw


def _baseline_entity_columns(raw: dict[str, Any]) -> dict[str, Any]:
    columns = _normalize_entity(raw)
    columns[_PARENT_KEY] = _as_uuid(columns[_PARENT_KEY])
    columns[ORDER_KEY] = int(raw.get(ORDER_KEY) or 0)
    return columns


def _baseline_field_columns(raw: dict[str, Any], owner_id: UUID) -> dict[str, Any]:
    columns = _normalize_field(raw)
    columns[_OWNER_KEY] = owner_id
    columns[ORDER_KEY] = int(raw.get(ORDER_KEY) or 0)
    return columns


def _live_columns(
    row: ExtractionEntityType | ExtractionField, keys: tuple[str, ...]
) -> dict[str, Any]:
    return {key: getattr(row, key) for key in keys}


def _index_snapshot(
    snapshot: dict[str, Any],
) -> tuple[dict[UUID, dict[str, Any]], dict[UUID, dict[str, Any]]]:
    """Baseline entity types and fields by id, both fully projected."""
    entities: dict[UUID, dict[str, Any]] = {}
    fields: dict[UUID, dict[str, Any]] = {}
    for raw_entity in snapshot.get("entity_types") or []:
        entity_id = UUID(str(raw_entity[IDENTITY_KEY]))
        entities[entity_id] = _baseline_entity_columns(raw_entity)
        for raw_field in raw_entity.get(NESTING_KEY) or []:
            field_id = UUID(str(raw_field[IDENTITY_KEY]))
            fields[field_id] = _baseline_field_columns(raw_field, entity_id)
    return entities, fields


# --------------------------------------------------------------------------
# Live reads
# --------------------------------------------------------------------------


async def _live_entity_types(
    db: AsyncSession, template_id: UUID
) -> dict[UUID, ExtractionEntityType]:
    rows = (
        (
            await db.execute(
                select(ExtractionEntityType).where(
                    ExtractionEntityType.project_template_id == template_id
                )
            )
        )
        .scalars()
        .all()
    )
    return {row.id: row for row in rows}


async def _live_fields(
    db: AsyncSession, entity_type_ids: list[UUID]
) -> dict[UUID, ExtractionField]:
    if not entity_type_ids:
        return {}
    rows = (
        (
            await db.execute(
                select(ExtractionField).where(ExtractionField.entity_type_id.in_(entity_type_ids))
            )
        )
        .scalars()
        .all()
    )
    return {row.id: row for row in rows}


# --------------------------------------------------------------------------
# Insert / delete ordering
# --------------------------------------------------------------------------


def _levels(rows: list[ExtractionEntityType]) -> list[list[ExtractionEntityType]]:
    """Group a parent-before-child ordering into depth levels.

    SQLAlchemy will not honour insert order inside one flush, and the
    self-FK is checked per row, so each level has to be flushed before the
    next one is added (the clone service's two-pass precedent, generalized
    to arbitrary depth).
    """
    ordered = TemplateCloneService._topologically_sorted(rows)
    in_scope = {row.id for row in ordered}
    depth: dict[UUID, int] = {}
    buckets: dict[int, list[ExtractionEntityType]] = {}
    for row in ordered:
        parent = row.parent_entity_type_id
        level = depth[parent] + 1 if parent in in_scope else 0
        depth[row.id] = level
        buckets.setdefault(level, []).append(row)
    return [buckets[level] for level in sorted(buckets)]


# --------------------------------------------------------------------------
# The writer
# --------------------------------------------------------------------------


async def restore_snapshot(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    snapshot: dict[str, Any],
    skip_entity_type_ids: frozenset[UUID] = frozenset(),
) -> RestoreOutcome:
    """Reconcile the live rows of ``template_id`` to ``snapshot``.

    ``skip_entity_type_ids`` is D4's blocked set: entity types the caller
    has determined cannot be removed (they own instances, or their fields
    are referenced by the workflow tables). The delete phases honour it —
    the excluded sections **and the fields that live under them** survive,
    everything else is still restored, and the caller reports what it
    kept. The caller owns the contents of the set: it must already
    include every descendant AND every ancestor of a blocked node, since
    deleting an ancestor would cascade the blocked node away.

    Keeping a node can make part of the baseline unrestorable, and that is
    the writer's problem, not the caller's: a kept field holds its
    ``(entity_type_id, name)`` slot forever, so every baseline field aimed
    at it is skipped and returned in
    :attr:`RestoreOutcome.name_conflicted_field_ids` rather than crashing
    the transaction on the immediate unique index.

    There is deliberately no "no draft open ⇒ no-op" short-circuit (D7):
    Restore-vN runs on clean templates, and a marker-NULL template whose
    live tree drifted is a real state. A genuinely identical tree costs
    three empty id sets.
    """
    # BOLA defense (unlocked read), mirroring ``republish``: a caller who
    # is only a manager elsewhere can never lock — or even match — a
    # foreign project's template row.
    owned = (
        await db.execute(
            select(ProjectExtractionTemplate.id).where(
                ProjectExtractionTemplate.id == template_id,
                ProjectExtractionTemplate.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if owned is None:
        raise TemplateNotFoundError(f"Template {template_id} not found")

    # D9 — the publish locks, before any detection query. They narrow the
    # race with concurrent editors; they do not close it (the AI proposal
    # writers take none).
    await TemplateVersionService(db).acquire_publish_locks(template_id)

    baseline_entities, baseline_fields = _index_snapshot(snapshot)
    live_entities = await _live_entity_types(db, template_id)
    live_fields = await _live_fields(db, list(live_entities))

    create_entity_ids = [eid for eid in baseline_entities if eid not in live_entities]
    delete_entity_ids = [
        eid
        for eid in live_entities
        if eid not in baseline_entities and eid not in skip_entity_type_ids
    ]
    update_entity_ids = [
        eid
        for eid, columns in baseline_entities.items()
        if eid in live_entities and _live_columns(live_entities[eid], _ENTITY_KEYS) != columns
    ]

    _refuse_container_swap(
        baseline_entities=baseline_entities,
        live_entities=live_entities,
        create_entity_ids=create_entity_ids,
    )

    delete_field_ids = [
        fid
        for fid, row in live_fields.items()
        if fid not in baseline_fields and row.entity_type_id not in skip_entity_type_ids
    ]
    # A kept field occupies its ``(entity_type_id, name)`` slot for good, so
    # any baseline field aimed at that slot is unrestorable (see
    # ``_name_conflicted``). Resolved BEFORE the create/update sets so those
    # fields are never parked, created or renamed.
    name_conflicted = _name_conflicted(
        baseline_fields=baseline_fields,
        live_fields=live_fields,
        kept_field_ids=frozenset(live_fields) - frozenset(baseline_fields) - set(delete_field_ids),
    )
    create_field_ids = [
        fid for fid in baseline_fields if fid not in live_fields and fid not in name_conflicted
    ]
    update_field_ids = [
        fid
        for fid, columns in baseline_fields.items()
        if fid in live_fields
        and fid not in name_conflicted
        and _live_columns(live_fields[fid], _FIELD_KEYS) != columns
    ]
    # Every phase-0 decision is taken from the pre-write reads above.
    park_field_ids = [
        fid for fid in update_field_ids if _moves_name_slot(live_fields[fid], baseline_fields[fid])
    ]
    stray_key_ids = _stray_entry_keys(
        baseline_fields, live_fields, unrestorable_field_ids=name_conflicted
    )

    # Phase 0 — park the two per-section slots. Names: every field whose
    # name or owner changes, INCLUDING a parent-only change, gets a unique
    # transient name, because a draft that deleted field `x` and renamed a
    # sibling to `x` otherwise collides on the immediate unique index during
    # the create pass. Keys: ``false`` is the park value, and phase 6 settles
    # both through the same ``.values(**baseline)`` write.
    for field_id in park_field_ids:
        await db.execute(
            update(ExtractionField)
            .where(ExtractionField.id == field_id)
            .values(name=f"{_PARK_PREFIX}{uuid4().hex}")
        )
    if stray_key_ids:
        await db.execute(
            update(ExtractionField)
            .where(ExtractionField.id.in_(stray_key_ids))
            .values(is_entity_key=False)
        )
    await db.flush()

    # Phase 1 — create missing entity types, topologically, level by level.
    for level in _levels(
        [
            ExtractionEntityType(
                id=entity_id,
                project_template_id=template_id,
                template_id=None,
                **baseline_entities[entity_id],
            )
            for entity_id in create_entity_ids
        ]
    ):
        db.add_all(level)
        await db.flush()
    await db.flush()

    # Phase 2 — re-parent every surviving field to its baseline parent, so
    # no baseline row sits under a section phase 4 is about to delete
    # (entity_type_id is ON DELETE CASCADE: this is the data-loss trap).
    for field_id in update_field_ids:
        owner_id = baseline_fields[field_id][_OWNER_KEY]
        if live_fields[field_id].entity_type_id != owner_id:
            await db.execute(
                update(ExtractionField)
                .where(ExtractionField.id == field_id)
                .values(entity_type_id=owner_id)
            )
    await db.flush()

    # Phase 3 — delete draft-added fields.
    if delete_field_ids:
        await db.execute(delete(ExtractionField).where(ExtractionField.id.in_(delete_field_ids)))
    await db.flush()

    # Phase 4 — delete draft-added entity types, reverse-topologically.
    #
    # The instance sweep comes first: ``extraction_instances.entity_type_id``
    # is ON DELETE RESTRICT, and a session seeds an empty instance for every
    # top-level section on open, so without it the FK would refuse every
    # section anyone had ever opened. Safe because the caller's gate
    # (``_analyze`` -> ``sections_with_recorded_work``) has already kept back
    # every section holding recorded work, and the up-walk in
    # ``_closed_over_the_tree`` keeps a blocked node's draft-added ancestors
    # with it — so nothing reachable from here owns work to lose.
    if delete_entity_ids:
        await sweep_empty_instances(db, section_ids=sorted(delete_entity_ids))
        await db.flush()
    for level in reversed(_levels([live_entities[eid] for eid in delete_entity_ids])):
        await db.execute(
            delete(ExtractionEntityType).where(
                ExtractionEntityType.id.in_([row.id for row in level])
            )
        )
        await db.flush()
    await db.flush()

    # Phase 5 — create missing fields (their owners now all exist).
    db.add_all(
        [ExtractionField(id=field_id, **baseline_fields[field_id]) for field_id in create_field_ids]
    )
    await db.flush()

    # Phase 6 — settle the parked slots and the rest of the attributes.
    for field_id in update_field_ids:
        await db.execute(
            update(ExtractionField)
            .where(ExtractionField.id == field_id)
            .values(**baseline_fields[field_id])
        )
    await db.flush()

    # Phase 7 — update survivor entity types.
    for entity_id in update_entity_ids:
        await db.execute(
            update(ExtractionEntityType)
            .where(ExtractionEntityType.id == entity_id)
            .values(**baseline_entities[entity_id])
        )
    await db.flush()

    # Phase 8 — the template-level instruction, with absent ≡ null ≡ ""
    # (mirroring ``template_instruction_service``'s normalization).
    instruction_reset = await _restore_instruction(db, template_id=template_id, snapshot=snapshot)
    await db.flush()

    return RestoreOutcome(
        created_entity_types=len(create_entity_ids),
        deleted_entity_types=len(delete_entity_ids),
        updated_entity_types=len(update_entity_ids),
        created_fields=len(create_field_ids),
        deleted_fields=len(delete_field_ids),
        updated_fields=len(update_field_ids),
        instruction_reset=instruction_reset,
        name_conflicted_field_ids=name_conflicted,
    )


def _moves_name_slot(live: ExtractionField, baseline: dict[str, Any]) -> bool:
    """Only a field whose ``(entity_type_id, name)`` slot changes can collide
    while the rest of the update set settles; an attribute-only change
    keeps its slot and needs no transient name."""
    return bool(live.name != baseline[_NAME_KEY] or live.entity_type_id != baseline[_OWNER_KEY])


def _stray_entry_keys(
    baseline_fields: dict[UUID, dict[str, Any]],
    live_fields: dict[UUID, ExtractionField],
    *,
    unrestorable_field_ids: frozenset[UUID],
) -> list[UUID]:
    """Live key holders the baseline does not grant a key — release them.

    Settling in snapshot order would otherwise re-grant the baseline holder
    while the field the draft moved the key to still holds it, and phase 5
    would collide re-creating a deleted holder. A KEPT row's key is not
    something the row needs to survive (the index is partial), so unlike a
    name it is released rather than reported.

    The one exception: when the baseline's holder for a section is itself
    unrestorable (its name slot is held by a kept field, so phases 5/6 will
    never write it), releasing the live key would leave the section with
    NO key — and a keyless repeating section refuses AI re-runs. That
    section keeps the key where the draft put it.
    """
    unwritable_sections = {
        columns[_OWNER_KEY]
        for field_id, columns in baseline_fields.items()
        if field_id in unrestorable_field_ids and columns[ENTITY_KEY_KEY]
    }
    return [
        field_id
        for field_id, row in live_fields.items()
        if row.is_entity_key
        and not baseline_fields.get(field_id, {}).get(ENTITY_KEY_KEY, False)
        and row.entity_type_id not in unwritable_sections
    ]


def _name_conflicted(
    *,
    baseline_fields: dict[UUID, dict[str, Any]],
    live_fields: dict[UUID, ExtractionField],
    kept_field_ids: frozenset[UUID],
) -> frozenset[UUID]:
    """Baseline fields whose ``(entity_type_id, name)`` slot a KEPT field
    holds, so the reconcile must leave them exactly as the draft did.

    ``uq_extraction_fields_entity_type_name`` (0050) is immediate and
    non-deferrable, and a kept field is by definition never deleted — so
    re-creating (phase 5) or renaming into (phase 6) its slot aborts the
    whole transaction with a 23505 no caller can tell apart from a bug.
    Skipping and reporting instead is the same bargain D4 already strikes
    for the nodes the RESTRICT FKs refuse to delete: something was kept, so
    the draft shrinks around it and the marker stays set.

    The walk is a fixpoint because an excluded field keeps its DRAFT slot,
    which can in turn be the slot a second baseline field is aimed at (a
    draft that renamed two fields around one kept name).
    """
    taken = {(live_fields[fid].entity_type_id, live_fields[fid].name) for fid in kept_field_ids}
    conflicted: set[UUID] = set()
    pending = True
    while pending:
        pending = False
        for field_id, columns in baseline_fields.items():
            if field_id in conflicted or (columns[_OWNER_KEY], columns[_NAME_KEY]) not in taken:
                continue
            conflicted.add(field_id)
            pending = True
            live = live_fields.get(field_id)
            if live is not None:
                taken.add((live.entity_type_id, live.name))
    return frozenset(conflicted)


def _refuse_container_swap(
    *,
    baseline_entities: dict[UUID, dict[str, Any]],
    live_entities: dict[UUID, ExtractionEntityType],
    create_entity_ids: list[UUID],
) -> None:
    """D3, checked before anything is written so the refusal is inert.

    The delete side is read PRE-skip — every live container absent from the
    baseline, whether or not D4 kept it. A kept container is still an
    incumbent on ``uq_extraction_entity_types_one_container_per_project``,
    so reading the filtered delete set would silence the refusal and let
    phase 1 collide instead.
    """
    container = ExtractionEntityRole.MODEL_CONTAINER.value
    creates_container = any(
        baseline_entities[entity_id]["role"] == container for entity_id in create_entity_ids
    )
    live_has_an_unpublished_container = any(
        row.role == container
        for entity_id, row in live_entities.items()
        if entity_id not in baseline_entities
    )
    if creates_container and live_has_an_unpublished_container:
        raise ContainerSwapUnsupportedError(
            "Cannot restore: the draft replaced the template's model container. "
            "Delete the new container first, then try again."
        )


async def _restore_instruction(
    db: AsyncSession, *, template_id: UUID, snapshot: dict[str, Any]
) -> bool:
    desired = _instruction(snapshot)
    current = (
        await db.execute(
            select(ProjectExtractionTemplate.llm_template_instruction).where(
                ProjectExtractionTemplate.id == template_id
            )
        )
    ).scalar_one()
    if ((current or "").strip() or None) == desired:
        return False
    await db.execute(
        update(ProjectExtractionTemplate)
        .where(ProjectExtractionTemplate.id == template_id)
        .values(llm_template_instruction=desired)
    )
    return True
