"""Throw away a template's unpublished config draft (B-9c1, T2).

Wraps :func:`template_restore_service.restore_snapshot` — the pure
snapshot→live reconcile — with everything the reconcile deliberately
refuses to know:

* **D4 — partial, not all-or-nothing.** A draft-added section that already
  owns ``extraction_instances``, or a draft-added field the review
  workflow references, cannot be deleted (RESTRICT). Refusing the whole
  Discard would make it permanently unavailable in the commonest draft
  shape, so those nodes are excluded from the delete set, everything else
  is restored, and the response reports what was kept.
* **D5 — the refusals that must abort**, because restoring them would
  corrupt data rather than merely fail.
* **D6 — the orphan ack.** "Discard adds no new undo power over data" is
  false for the *update* set: reverting a field's options or type can
  strand values a reviewer already recorded, and ``diff total == 0``
  cannot see it.
* **D7 — the marker.** The writer never touches ``config_draft_since``;
  this service clears it last, in the same transaction, and only when
  nothing was kept.
* **D8 — detection is advisory, the DB is authoritative.** The up-front
  queries exist for good messages. ``acquire_publish_locks`` narrows the
  race but does not close it (``ModelExtractionService`` and the proposal
  writers take no locks), so a lost race surfaces as a typed refusal
  rather than a 500 — and no further SQL is issued on the poisoned
  transaction.
* **D10 — telemetry.** This is the most destructive operation in the
  stack; one structured event per call makes an accidental Discard
  reconstructable.

**Lock order (D9), and why it is the established one.** Discard takes
``acquire_publish_locks`` first — the editable-stage advisory locks, then
the template row ``FOR UPDATE`` — and only then writes
``extraction_entity_types`` / ``extraction_fields``. That is the clone
service's order, not a new one: its zero-state rebuild takes the same locks
*before* inserting live rows, precisely because the 0048 AFTER-ROW trigger
stamps ``config_draft_since`` and therefore write-locks the template row on
every live-row write. ``republish``, ``open_or_resume`` and ``create_run``
never write live rows at all (versions, instances and runs only), so no
cycle runs through them.

The one counter-order writer is the single-row edit path (the B-7
section/field services and any direct PostgREST write): it locks its row
first and reaches the template row through the trigger. A multi-row writer
can therefore deadlock with a concurrent editor — but that is a property of
the trigger, not of this service, and it predates it (the clone rebuild has
the same exposure). Dropping the ``FOR UPDATE`` would not remove it either:
the first live-row write would take the template lock through the trigger
anyway, leaving "holds row A, wants the template" against "holds row B,
wants the template". So the order stays, and the 40P01 that a lost race
produces is absorbed by D8 into ``DiscardRacedError`` (409, "try again")
rather than a 500.

Known gap (T1's finding, folded into the endpoint docstring): a baseline
that predates ``allows_not_applicable`` normalizes the flag to ``False``
rather than "leave alone", so restoring it silently rewrites those
columns while ``diff_snapshots`` still reports ``total == 0``. That is one
more reason a *narrow* baseline is refused outright (D5) — but era drift
inside a wide baseline is not detectable here.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any, NoReturn
from uuid import UUID

from fastapi import status
from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.core.logging import get_logger
from app.domain.template_change import ChangeTier
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionInstance,
    ProjectExtractionTemplate,
)
from app.repositories.extraction_field_reference_repository import (
    ExtractionFieldReferenceRepository,
)
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.schemas.hitl_session import (
    DiscardDraftResponse,
    DiscardKeptNode,
    TemplateDiscardRefusalCode,
    TemplateDiscardRefusalDetails,
    TemplateDiscardRefusalOrphan,
)
from app.services.extraction_snapshot import (
    baseline_is_restorable,
    build_template_version_snapshot,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_diff import TemplateChange, diff_snapshots
from app.services.template_restore_service import ContainerSwapUnsupportedError, restore_snapshot
from app.services.template_section_service import has_multi_entry_parent
from app.services.template_version_read_service import NoActiveTemplateVersionError
from app.services.template_version_service import TemplateVersionService

logger = get_logger(__name__)

__all__ = [
    "DiscardBlockedByCardinalityError",
    "DiscardRacedError",
    "NarrowBaselineError",
    "OrphanAcknowledgementRequiredError",
    "discard_draft",
]

#: The RESTRICT references that make a live node un-deletable. Detection
#: queries these tables up front (D4); this list is the D8 backstop, used to
#: tell a lost race apart from a genuine bug in the writer's own phase order
#: (a ``parent_entity_type_id`` violation is also 23503 and must NOT be
#: reported as a race).
_RESTRICT_FKS = frozenset(
    {
        "extraction_instances_entity_type_id_fkey",
        "extraction_proposal_records_field_id_fkey",
        "extraction_reviewer_decisions_field_id_fkey",
        "extraction_reviewer_states_field_id_fkey",
        "extraction_consensus_decisions_field_id_fkey",
        "extraction_published_states_field_id_fkey",
    }
)

_FK_VIOLATION = "23503"
_DEADLOCK = "40P01"


class _DiscardRefusal(AppError):
    """Base for the D5/D6/D8 refusals: HTTP 409 with a slice-local code.

    B-9c2 D1 — the endpoint lets these propagate to ``app_error_handler``
    (the ``ExportColumnLimitError`` precedent) instead of re-raising
    ``HTTPException(409, str(e))``, which collapsed all five onto
    ``HTTP_ERROR`` and dropped ``details`` entirely. Forwarding by keyword
    keeps ``AppError.__init__``'s ``super().__init__(message)``, so
    ``str(exc)`` is still the message every existing assertion reads."""

    _code: TemplateDiscardRefusalCode

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            code=self._code,
            message=message,
            status_code=status.HTTP_409_CONFLICT,
            details=details,
        )


class DiscardBlockedByCardinalityError(_DiscardRefusal):
    """Restoring would lower ``cardinality`` from ``many`` to ``one`` while a
    parent instance still holds 2+ entries.

    409-class (D5). The run view renders only ``instances[0]`` for a
    cardinality-one section while the completion gate counts required
    fields on EVERY instance, so those runs would become un-completable.
    The same hazard the PATCH-time and publish-time guards refuse — Discard
    is the third door into it, and it aborts rather than partially applies
    because the offending node is a *survivor*, not a draft addition."""

    _code = TemplateDiscardRefusalCode.CARDINALITY_DOWNGRADE_BLOCKED


class NarrowBaselineError(_DiscardRefusal):
    """The published baseline predates the wide snapshot builder (0026).

    409-class (D5). Writing it back would null ``llm_description`` /
    ``allow_other`` project-wide, because absent keys normalize to their
    column defaults rather than to "leave alone"."""

    _code = TemplateDiscardRefusalCode.NARROW_BASELINE


class OrphanAcknowledgementRequiredError(_DiscardRefusal):
    """Destructive-tier changes touch fields that already hold values (D6).

    409-class, and the only refusal a retry can satisfy: the client re-posts
    with ``acknowledge_orphans``. The fields it names ride in ``details``
    (see :func:`_orphan_refusal`) so the dialog can list them without
    parsing English."""

    _code = TemplateDiscardRefusalCode.ORPHAN_ACK_REQUIRED


class DiscardRacedError(_DiscardRefusal):
    """The database refused a delete the detection pass had cleared (D8).

    409-class. Between detection and the write, a concurrent writer gave a
    draft-added node recorded work (23503 on a RESTRICT FK) or the
    transaction deadlocked (40P01). Retrying recomputes the blocked set and
    keeps the node."""

    _code = TemplateDiscardRefusalCode.DISCARD_RACED


@dataclass(frozen=True, slots=True)
class _Blocked:
    """The D4 analysis: what cannot be deleted, and what survives with it."""

    skip_entity_type_ids: frozenset[UUID]
    kept: tuple[DiscardKeptNode, ...]
    fields_with_values: frozenset[UUID]


async def discard_draft(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    user_id: UUID,
    acknowledge_orphans: bool = False,
) -> DiscardDraftResponse:
    """Restore ``template_id``'s live rows to its active published version.

    Flushes, never commits — the endpoint owns the transaction. On a D8
    refusal the transaction is left aborted and unusable on purpose: the
    endpoint maps the typed error to a 409 without committing, and the
    request-scoped session discards it.
    """
    template = await db.get(ProjectExtractionTemplate, template_id)
    if template is None or template.project_id != project_id:
        # 404, never 403 — a foreign template id must not leak its existence.
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")
    draft_since = template.config_draft_since

    # D9 — the publish locks, before any detection query, in republish's
    # lock order (advisory locks on editable-stage runs, then the template
    # row FOR UPDATE). ``restore_snapshot`` re-takes them harmlessly.
    await TemplateVersionService(db).acquire_publish_locks(template_id)

    active = await ExtractionTemplateVersionRepository(db).get_active(template_id)
    if active is None:
        _refuse(
            NoActiveTemplateVersionError(
                f"Project template {template_id} has no published version to discard back to."
            ),
            project_id=project_id,
            template_id=template_id,
            user_id=user_id,
        )
    baseline: dict[str, Any] = active.schema_ or {}
    if not baseline_is_restorable(baseline):
        _refuse(
            NarrowBaselineError(
                "This template's published version predates the current snapshot "
                "format, so discarding would erase AI instructions and option "
                "settings across the project. Support for these templates lands "
                "in B-9x; publish the current configuration instead."
            ),
            project_id=project_id,
            template_id=template_id,
            user_id=user_id,
        )

    live_entities, live_fields = await _live_tree(db, template_id)
    blocked = await _analyze(
        db, baseline=baseline, live_entities=live_entities, live_fields=live_fields
    )
    await _refuse_cardinality_downgrade(
        db,
        baseline=baseline,
        live_entities=live_entities,
        project_id=project_id,
        template_id=template_id,
        user_id=user_id,
    )

    # D6/D10 — the live snapshot, captured BEFORE the writer runs. Diffed in
    # the direction of the operation (live -> published), so a "destructive"
    # tier names what THIS Discard destroys, not what the draft did.
    current = await build_template_version_snapshot(db, template_id)
    kept_ids = {node.node_id for node in blocked.kept}
    discarded = [
        change
        for change in diff_snapshots(
            current, baseline, fields_with_values=blocked.fields_with_values
        ).changes
        if change.node_id not in kept_ids
    ]
    orphans = [
        change
        for change in discarded
        if change.tier is ChangeTier.DESTRUCTIVE and change.node_id in blocked.fields_with_values
    ]
    if orphans and not acknowledge_orphans:
        _refuse(
            _orphan_refusal(orphans),
            project_id=project_id,
            template_id=template_id,
            user_id=user_id,
            blocking_node_id=orphans[0].node_id,
        )

    try:
        outcome = await restore_snapshot(
            db,
            project_id=project_id,
            template_id=template_id,
            snapshot=baseline,
            skip_entity_type_ids=blocked.skip_entity_type_ids,
        )
    except ContainerSwapUnsupportedError as exc:
        _refuse(exc, project_id=project_id, template_id=template_id, user_id=user_id)
    except DBAPIError as exc:
        _reraise_if_raced(exc, project_id=project_id, template_id=template_id, user_id=user_id)
        raise

    # A kept field owns its per-section name for good, so the baseline
    # fields aimed at that name stayed as the draft left them. They are part
    # of what Discard could not undo, so they join ``kept`` — and, like any
    # other kept node, they hold the marker open.
    kept_nodes = (
        *blocked.kept,
        *_name_conflicted_nodes(baseline, outcome.name_conflicted_field_ids),
    )

    # D7 — the marker, last and by Core UPDATE: the 0048 AFTER-ROW triggers
    # re-stamp it on every row the writer touched, and an ORM attribute set
    # could be flushed before them. Cleared only when the live tree now
    # matches the published version exactly.
    marker_cleared = not kept_nodes
    if marker_cleared:
        await db.execute(
            update(ProjectExtractionTemplate)
            .where(ProjectExtractionTemplate.id == template_id)
            .values(config_draft_since=None)
        )

    logger.info(
        "template_config_draft_discarded",
        project_id=str(project_id),
        template_id=str(template_id),
        user_id=str(user_id),
        config_draft_since=str(draft_since) if draft_since is not None else None,
        created_entity_types=outcome.created_entity_types,
        deleted_entity_types=outcome.deleted_entity_types,
        updated_entity_types=outcome.updated_entity_types,
        created_fields=outcome.created_fields,
        deleted_fields=outcome.deleted_fields,
        updated_fields=outcome.updated_fields,
        instruction_reset=outcome.instruction_reset,
        acknowledged_orphans=bool(orphans),
        marker_cleared=marker_cleared,
        kept=[
            {"node_id": str(node.node_id), "node_kind": node.node_kind, "reason": node.reason}
            for node in kept_nodes
        ],
        # Re-filtered against the FINAL kept set: the pre-write diff counted
        # the name conflicts, which only the writer can resolve, as discarded.
        discarded_changes_by_tier=_tier_summary(
            [
                change
                for change in discarded
                if change.node_id not in outcome.name_conflicted_field_ids
            ]
        ),
    )

    return DiscardDraftResponse(
        project_template_id=template_id,
        draft_was_open=draft_since is not None,
        created_entity_types=outcome.created_entity_types,
        deleted_entity_types=outcome.deleted_entity_types,
        updated_entity_types=outcome.updated_entity_types,
        created_fields=outcome.created_fields,
        deleted_fields=outcome.deleted_fields,
        updated_fields=outcome.updated_fields,
        instruction_reset=outcome.instruction_reset,
        kept=list(kept_nodes),
    )


def _name_conflicted_nodes(
    baseline: dict[str, Any], field_ids: frozenset[UUID]
) -> list[DiscardKeptNode]:
    """Report the baseline fields the writer could not restore because a
    kept field holds their per-section name (see
    :func:`template_restore_service._name_conflicted`).

    Labelled from the BASELINE: the node may not exist live at all (the
    "delete the field, re-add it with the same name to change its type"
    workaround), and when it does, its live label is the draft's."""
    return [
        DiscardKeptNode(
            node_id=UUID(str(raw["id"])),
            node_kind="field",
            label=raw.get("label") or raw["name"],
            reason="name_taken_by_kept_node",
        )
        for entity in baseline.get("entity_types") or []
        for raw in entity.get("fields") or []
        if UUID(str(raw["id"])) in field_ids
    ]


# --------------------------------------------------------------------------
# D4 — the blocked set and its closure
# --------------------------------------------------------------------------


async def _live_tree(
    db: AsyncSession, template_id: UUID
) -> tuple[dict[UUID, ExtractionEntityType], dict[UUID, ExtractionField]]:
    entities = {
        row.id: row
        for row in (
            await db.execute(
                select(ExtractionEntityType).where(
                    ExtractionEntityType.project_template_id == template_id
                )
            )
        )
        .scalars()
        .all()
    }
    if not entities:
        return entities, {}
    fields = {
        row.id: row
        for row in (
            await db.execute(
                select(ExtractionField).where(ExtractionField.entity_type_id.in_(list(entities)))
            )
        )
        .scalars()
        .all()
    }
    return entities, fields


async def _entity_types_with_instances(
    db: AsyncSession, entity_type_ids: list[UUID]
) -> frozenset[UUID]:
    """Which of these entity types already own extraction instances.

    Instances materialize from LIVE rows, so a draft-added section owns real
    run data as soon as any session opens on the article."""
    if not entity_type_ids:
        return frozenset()
    rows = await db.execute(
        select(ExtractionInstance.entity_type_id)
        .where(ExtractionInstance.entity_type_id.in_(entity_type_ids))
        .distinct()
    )
    return frozenset(rows.scalars().all())


async def _analyze(
    db: AsyncSession,
    *,
    baseline: dict[str, Any],
    live_entities: dict[UUID, ExtractionEntityType],
    live_fields: dict[UUID, ExtractionField],
) -> _Blocked:
    """Compute the skip set the writer needs and the report the caller shows."""
    baseline_entity_ids = {UUID(str(et["id"])) for et in baseline.get("entity_types") or []}
    baseline_field_ids = {
        UUID(str(f["id"]))
        for et in baseline.get("entity_types") or []
        for f in et.get("fields") or []
    }
    added_entity_ids = {eid for eid in live_entities if eid not in baseline_entity_ids}
    added_field_ids = {fid for fid in live_fields if fid not in baseline_field_ids}

    with_instances = await _entity_types_with_instances(db, sorted(added_entity_ids))
    # B-9b2a D5: the same repository the config-diff read resolves
    # ``affects_recorded_data`` from, so the two can never disagree about
    # which fields already hold recorded work.
    referenced = await ExtractionFieldReferenceRepository(db).fields_with_recorded_work(
        sorted(live_fields)
    )
    blocked_fields = referenced & added_field_ids

    # The writer's skip set is entity-type-granular: a blocked FIELD is
    # spared by skipping its OWNING section, whether that section is
    # draft-added or a survivor (a survivor is never deleted anyway — the
    # skip only stops its draft-added children being swept).
    seed = set(with_instances) | {live_fields[fid].entity_type_id for fid in blocked_fields}
    skip = _closed_over_the_tree(
        seed,
        instance_blocked=with_instances,
        live_entities=live_entities,
        added_entity_ids=added_entity_ids,
    )

    kept_entity_ids = skip & added_entity_ids
    kept_field_ids = {fid for fid in added_field_ids if live_fields[fid].entity_type_id in skip}
    kept = [
        DiscardKeptNode(
            node_id=eid,
            node_kind="entity_type",
            label=live_entities[eid].label,
            reason="has_recorded_data" if eid in with_instances else "related_to_kept_node",
        )
        for eid in sorted(kept_entity_ids, key=lambda i: live_entities[i].sort_order)
    ] + [
        DiscardKeptNode(
            node_id=fid,
            node_kind="field",
            label=live_fields[fid].label,
            reason="has_recorded_data" if fid in blocked_fields else "related_to_kept_node",
        )
        for fid in sorted(kept_field_ids, key=lambda i: live_fields[i].sort_order)
    ]
    return _Blocked(
        skip_entity_type_ids=frozenset(skip),
        kept=tuple(kept),
        fields_with_values=referenced,
    )


def _closed_over_the_tree(
    seed: set[UUID],
    *,
    instance_blocked: frozenset[UUID],
    live_entities: dict[UUID, ExtractionEntityType],
    added_entity_ids: set[UUID],
) -> set[UUID]:
    """Close the blocked set over the live parent/child tree.

    Two directions, for two different reasons:

    * **up** — ``parent_entity_type_id`` is ON DELETE CASCADE, so keeping a
      blocked node is worthless if a draft-added ANCESTOR is deleted: the
      cascade destroys the very row the RESTRICT FK protects. The plan's D4
      says "the offending nodes plus their subtrees"; that is not enough,
      and the ancestor walk is the correction.
    * **down** — a kept section keeps its draft-added subtree (D4), so the
      manager is left with a coherent branch rather than a decapitated one.
      Only walked from nodes blocked by their own instances: a section kept
      merely to spare one field of its own has no claim on its child
      sections.

    One hop down IS the whole subtree: ``ck_extraction_entity_types_role_parent``
    forces ``study_section``/``model_container`` to be roots and
    ``model_section`` to have a parent, and the deferred
    ``trg_check_model_section_parent_role`` forces that parent to be a
    ``model_container`` — so the live tree is exactly two levels deep and
    has no grandchildren. Should that ever change, this walk needs a
    fixpoint; today one would be unreachable code.
    """
    skip = set(seed)
    stack = list(seed)
    while stack:
        node = stack.pop()
        parent = live_entities[node].parent_entity_type_id
        if parent is not None and parent in added_entity_ids and parent not in skip:
            skip.add(parent)
            stack.append(parent)
        if node not in instance_blocked:
            continue
        for child_id, child in live_entities.items():
            if (
                child.parent_entity_type_id == node
                and child_id in added_entity_ids
                and child_id not in skip
            ):
                skip.add(child_id)
                stack.append(child_id)
    return skip


# --------------------------------------------------------------------------
# D5 — the cardinality refusal
# --------------------------------------------------------------------------


async def _refuse_cardinality_downgrade(
    db: AsyncSession,
    *,
    baseline: dict[str, Any],
    live_entities: dict[UUID, ExtractionEntityType],
    project_id: UUID,
    template_id: UUID,
    user_id: UUID,
) -> None:
    for raw in baseline.get("entity_types") or []:
        entity_id = UUID(str(raw["id"]))
        live = live_entities.get(entity_id)
        if live is None or live.cardinality != "many" or (raw.get("cardinality") or "one") != "one":
            continue
        if await has_multi_entry_parent(db, section_id=entity_id):
            _refuse(
                DiscardBlockedByCardinalityError(
                    f'Section "{live.label}" has an entry with multiple items; discarding '
                    "would set it back to once-per-entry and make those runs "
                    "un-completable. Remove the extra items first."
                ),
                project_id=project_id,
                template_id=template_id,
                user_id=user_id,
                blocking_node_id=entity_id,
            )


# --------------------------------------------------------------------------
# D6 / D8 / D10 — messages, race detection, telemetry
# --------------------------------------------------------------------------


def _orphan_refusal(orphans: list[TemplateChange]) -> OrphanAcknowledgementRequiredError:
    """The D6 question, with the fields it is about (B-9c2 D1).

    Deduped by ``node_id``, insertion-ordered: ``allowed_values`` is diffed
    per option code, so a field losing two recorded options produces two
    destructive changes and would otherwise be listed — and counted — twice.

    The prose names labels only. The ids ride in ``details``, as JSON
    primitives: ``app_error_handler`` renders ``details`` through a bare
    ``JSONResponse``, so a raw ``UUID`` there raises INSIDE the handler and
    the refusal reaches the client as a 500. The ``acknowledge_orphans``
    parameter name is gone too — the dialog re-posts on the code, and API
    parameters are not user-facing copy."""
    deduped: dict[UUID | None, TemplateChange] = {}
    for change in orphans:
        deduped.setdefault(change.node_id, change)
    listed = "; ".join(change.label for change in deduped.values())
    return OrphanAcknowledgementRequiredError(
        "Discarding would remove options or change the type of fields that "
        f"already hold recorded answers: {listed}.",
        details=TemplateDiscardRefusalDetails(
            orphans=[
                TemplateDiscardRefusalOrphan(
                    node_id=str(change.node_id) if change.node_id is not None else None,
                    label=change.label,
                )
                for change in deduped.values()
            ]
        ).model_dump(mode="json"),
    )


def _tier_summary(changes: list[TemplateChange]) -> dict[str, int]:
    counted = Counter(change.tier.value for change in changes)
    return {tier.value: counted.get(tier.value, 0) for tier in ChangeTier}


def _sqlstate(exc: DBAPIError) -> str | None:
    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None)):
        state = getattr(candidate, "sqlstate", None) or getattr(candidate, "pgcode", None)
        if state:
            return str(state)
    return None


def _constraint_name(exc: DBAPIError) -> str | None:
    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None)):
        name = getattr(candidate, "constraint_name", None)
        if name:
            return str(name)
    return None


def _reraise_if_raced(
    exc: DBAPIError, *, project_id: UUID, template_id: UUID, user_id: UUID
) -> None:
    """D8: turn the DB's verdict into the refusal detection would have given.

    Anything else — including a 23503 on ``parent_entity_type_id``, which
    would mean the writer's phase order is wrong — propagates untouched, so
    a real bug never hides behind a "someone else was editing" message."""
    state = _sqlstate(exc)
    raced = state == _DEADLOCK or (
        state == _FK_VIOLATION and _constraint_name(exc) in _RESTRICT_FKS
    )
    if not raced:
        return
    _refuse(
        DiscardRacedError(
            "Someone recorded data on this template while the draft was being "
            "discarded. Nothing was changed — try again."
        ),
        project_id=project_id,
        template_id=template_id,
        user_id=user_id,
        cause=exc,
    )


def _refuse(
    error: Exception,
    *,
    project_id: UUID,
    template_id: UUID,
    user_id: UUID,
    blocking_node_id: UUID | None = None,
    cause: BaseException | None = None,
) -> NoReturn:
    """Log the D10 refusal warning, then raise (D10: every refusal is
    named and attributed, not just the successful discards)."""
    logger.warning(
        "template_config_discard_refused",
        refusal=type(error).__name__,
        project_id=str(project_id),
        template_id=str(template_id),
        user_id=str(user_id),
        blocking_node_id=str(blocking_node_id) if blocking_node_id is not None else None,
        reason=str(error),
    )
    raise error from cause
