"""ACTIVE-version reads for a project template (track B).

* B-3a: the worklist, the dashboard and the exports render template
  structure from the ACTIVE snapshot, not live rows — under B-4 an
  unpublished draft edit must not move progress numbers project-wide.
  The tree comes from B-2's shared provider, so the narrow/heterogeneous
  snapshot -> live fallback chain is inherited, not re-implemented.
* B-4: the Configuration tab's Draft chip reads
  ``get_template_config_status`` (marker + active version number).
* B-9a: that same status calibrates the chip with a change count —
  ``template_diff.diff_snapshots`` of the stored active snapshot against
  a fresh build of the live rows, run ONLY while the draft marker is set.
* B-9b2a: ``get_template_config_diff`` serves the Publish sheet the rows
  behind that count. Same engine, same restorability gate — but it
  resolves the REAL recorded-value set, because it ships tiers and an
  ``affects_recorded_data`` flag rather than a bare integer. Unlike the
  count it runs for a clean template too: a marker-NULL tree that drifted
  (a lost republish) has real changes to show.
"""

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.template_change import ChangeTier, DiffStatus
from app.models.extraction import ProjectExtractionTemplate
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.repositories.extraction_field_reference_repository import (
    ExtractionFieldReferenceRepository,
)
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.schemas.hitl_session import (
    TemplateActiveVersionRead,
    TemplateConfigDiffBuckets,
    TemplateConfigDiffRead,
    TemplateConfigStatusRead,
)
from app.services.extraction_snapshot import (
    baseline_is_restorable,
    build_template_version_snapshot,
    entity_types_for_version,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_diff import TemplateDiff, diff_snapshots
from app.services.template_diff_read import fingerprint, with_recorded_data


class NoActiveTemplateVersionError(Exception):
    """The template exists but has no active version to render from."""


async def _scoped_template(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> ProjectExtractionTemplate:
    """The template, BOLA-scoped by ``(id, project_id)``.

    ONE owner for the comparison every read in this module has to make: a
    template owned elsewhere 404s rather than leaking that it exists, and
    BOLA is a named recurring incident class here.
    """
    template = await db.get(ProjectExtractionTemplate, template_id)
    if template is None or template.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")
    return template


@dataclass(frozen=True, slots=True)
class _DiffOutcome:
    """What :func:`_resolve_template_diff` found, gate included.

    ``diff`` stays empty for anything but :attr:`DiffStatus.AVAILABLE`, so a
    caller that renders it unconditionally still cannot ship rows for a
    template the gate refused to diff.
    """

    status: DiffStatus
    diff: TemplateDiff = TemplateDiff()
    #: Each CURRENT entity type → the field ids it owns. The
    #: ``affects_recorded_data`` post-pass needs it because a section
    #: add/remove absorbs its child rows, so the change list alone cannot say
    #: which fields a section-level row is about.
    children: dict[UUID, frozenset[UUID]] = field(default_factory=dict)
    #: The field ids that already hold recorded work — empty unless the
    #: caller asked for it (D3).
    recorded: frozenset[UUID] = frozenset()


async def _resolve_template_diff(
    db: AsyncSession,
    *,
    template_id: UUID,
    active: ExtractionTemplateVersion | None,
    resolve_values: bool,
) -> _DiffOutcome:
    """The ONLY path to ``diff_snapshots`` in this module — gate included.

    The gate is ``baseline_is_restorable``, the same predicate
    ``discard_available`` uses, and not ``snapshot_is_narrow`` directly. The
    two disagree on exactly one shape: an EMPTY published baseline, which
    ``snapshot_is_narrow`` calls narrow by design (so the run view falls back
    to live rows) but which is a perfectly honest diff baseline — every live
    node reads as added, because it was. Sharing it is what makes
    ``discard_available`` ⇒ an integer count, so the Discard dialog never has
    to render an "unknown count" variant (B-9c2 D2).

    Owning the gate here rather than restating it per caller is not ordinary
    de-duplication: ``role`` defaults to ``None`` in the engine but is
    non-nullable live, so diffing a pre-0026 baseline manufactures at least
    one phantom SEMANTIC row per entity type, deterministically — and the
    caller that forgets the check gets those rows with nothing failing.

    A refused or absent baseline pays for neither the snapshot build nor the
    walk. ``resolve_values`` is the one thing callers still choose (D3): the
    chip's count consumes no tiers, so it must not pay for the five-table
    union the Publish sheet's warnings need.
    """
    if active is None:
        return _DiffOutcome(DiffStatus.INITIAL_VERSION)
    baseline: dict[str, Any] = active.schema_ or {}
    if not baseline_is_restorable(baseline):
        return _DiffOutcome(DiffStatus.BASELINE_TOO_OLD)

    current = await build_template_version_snapshot(db, template_id)
    children = _field_ids_by_parent(current)
    # LIVE field ids only, and that is correct rather than lucky: every
    # workflow ``field_id`` FK is RESTRICT, so a field absent from the live
    # tree provably holds no recorded work.
    recorded = (
        await ExtractionFieldReferenceRepository(db).fields_with_recorded_work(
            sorted({field_id for owned in children.values() for field_id in owned})
        )
        if resolve_values
        else frozenset()
    )
    return _DiffOutcome(
        DiffStatus.AVAILABLE,
        diff=diff_snapshots(baseline, current, fields_with_values=recorded),
        children=children,
        recorded=recorded,
    )


async def get_template_config_status(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateConfigStatusRead:
    """Draft chip read model (B-4/B-9a), BOLA-scoped by (id, project_id).

    ``active_version`` is None only for a template that never published
    (legacy shapes) — unlike the tree read above, that is a renderable
    status here, not an error.
    """
    template = await _scoped_template(db, project_id=project_id, template_id=template_id)
    active = await ExtractionTemplateVersionRepository(db).get_active(template_id)
    has_pending_changes = template.config_draft_since is not None
    return TemplateConfigStatusRead(
        project_template_id=template.id,
        has_pending_changes=has_pending_changes,
        active_version=active.version if active is not None else None,
        pending_change_count=(
            await _pending_change_count(db, template_id=template_id, active=active)
            if has_pending_changes
            else None
        ),
        # B-9c1 D12: the Discard button must know before the click. Same
        # shared gate the endpoint refuses on, so the two cannot disagree —
        # and unlike the count, it is answered for a clean template too
        # (a drifted marker-NULL template is discardable).
        discard_available=active is not None and baseline_is_restorable(active.schema_),
    )


async def _pending_change_count(
    db: AsyncSession, *, template_id: UUID, active: ExtractionTemplateVersion | None
) -> int | None:
    """How many changes the open draft carries, or None when unknowable.

    Only ever called for a template whose marker is set — a clean one must
    not pay for the extra snapshot build (B-9a D7). ``None`` is not zero:
    it means the question has no answer here, either because nothing was
    ever published (D8) or because the stored baseline predates the wide
    snapshot builder and would manufacture phantom changes (D5). Both of
    those are :func:`_resolve_template_diff`'s non-``AVAILABLE`` statuses.

    A count consumes no tiers, so it needs no value lookup — B-9b's diff
    endpoint resolves the real set for the Publish sheet's warnings (D3).
    """
    outcome = await _resolve_template_diff(
        db, template_id=template_id, active=active, resolve_values=False
    )
    return outcome.diff.total if outcome.status is DiffStatus.AVAILABLE else None


async def get_template_config_diff(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateConfigDiffRead:
    """What the open draft would publish (B-9b2a), BOLA-scoped by (id, project_id).

    Every :class:`DiffStatus` is a 200 — an un-diffable template is a state
    the Publish sheet explains, never an error (D9), and only ``available``
    carries rows. The gate behind the other two lives in
    :func:`_resolve_template_diff`.

    Unlike the chip's count, this read resolves the REAL recorded set (D3):
    the tiers it buckets by depend on it (a ``field_type`` change is
    semantic on an empty field and destructive on one holding answers), and
    every row carries ``affects_recorded_data``. Takes no locks — it is a
    read, and a stale row is a re-fetch, not a corruption.
    """
    await _scoped_template(db, project_id=project_id, template_id=template_id)
    active = await ExtractionTemplateVersionRepository(db).get_active(template_id)
    outcome = await _resolve_template_diff(
        db, template_id=template_id, active=active, resolve_values=True
    )
    buckets = _buckets(outcome)
    return TemplateConfigDiffRead(
        project_template_id=template_id,
        status=outcome.status,
        changes=buckets,
        # Hashed over the SAME rows the client is about to see, plus the
        # baseline's identity — the publish path recomputes both under its
        # locks and refuses on a mismatch (B-9b2b). The non-available
        # statuses carry no rows to acknowledge, so they carry no
        # fingerprint either: a drift check over an empty projection would
        # refuse on nothing.
        fingerprint=(
            fingerprint(
                active.id if active is not None else None,
                [
                    row
                    for tier_rows in (
                        buckets.additive,
                        buckets.cosmetic,
                        buckets.semantic,
                        buckets.destructive,
                    )
                    for row in tier_rows
                ],
            )
            if outcome.status is DiffStatus.AVAILABLE
            else None
        ),
    )


def _field_ids_by_parent(snapshot: dict[str, Any]) -> dict[UUID, frozenset[UUID]]:
    """Each CURRENT entity type → the field ids it owns.

    The post-pass needs this because a section add/remove absorbs its child
    rows, so the change list alone cannot say which fields a section-level
    row is about.
    """
    return {
        UUID(str(entity["id"])): frozenset(
            UUID(str(raw["id"])) for raw in entity.get("fields") or []
        )
        for entity in snapshot.get("entity_types") or []
    }


def _buckets(outcome: _DiffOutcome) -> TemplateConfigDiffBuckets:
    """The engine's own tier partition, projected onto wire rows.

    ``TemplateDiff.by_tier`` already ships every tier — empty ones included —
    in the engine's emission order, so there is no second partition here to
    drift from it.
    """
    rows = {
        tier: list(with_recorded_data(changes, outcome.children, outcome.recorded))
        for tier, changes in outcome.diff.by_tier.items()
    }
    return TemplateConfigDiffBuckets(
        additive=rows[ChangeTier.ADDITIVE],
        cosmetic=rows[ChangeTier.COSMETIC],
        semantic=rows[ChangeTier.SEMANTIC],
        destructive=rows[ChangeTier.DESTRUCTIVE],
    )


async def get_active_version_tree(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateActiveVersionRead:
    """Active-version tree, BOLA-scoped by (id, project_id).

    Raises ``ProjectTemplateNotFoundError`` (-> 404) for a foreign or
    missing template and ``NoActiveTemplateVersionError`` (-> 404) when
    no active version exists — NEVER an empty tree, which the worklist
    would compute as 100 % complete.
    """
    await _scoped_template(db, project_id=project_id, template_id=template_id)
    active = await ExtractionTemplateVersionRepository(db).get_active(template_id)
    if active is None:
        raise NoActiveTemplateVersionError(
            f"Project template {template_id} has no active version. "
            "Publish the template configuration first."
        )

    entity_types = await entity_types_for_version(db, version_id=active.id, template_id=template_id)
    return TemplateActiveVersionRead(
        version_id=active.id,
        version=active.version,
        entity_types=entity_types,
    )
