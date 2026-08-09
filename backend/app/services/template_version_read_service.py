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

from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

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
    TemplateChangeRowRead,
    TemplateConfigDiffBuckets,
    TemplateConfigDiffRead,
    TemplateConfigStatusRead,
    TemplateDiffUnavailableReason,
)
from app.services.extraction_snapshot import (
    baseline_is_restorable,
    build_template_version_snapshot,
    entity_types_for_version,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_diff import ChangeTier, diff_snapshots
from app.services.template_diff_read import TemplateChangeRow, with_recorded_data


class NoActiveTemplateVersionError(Exception):
    """The template exists but has no active version to render from."""


async def get_template_config_status(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateConfigStatusRead:
    """Draft chip read model (B-4/B-9a), BOLA-scoped by (id, project_id).

    ``active_version`` is None only for a template that never published
    (legacy shapes) — unlike the tree read above, that is a renderable
    status here, not an error.
    """
    template = await db.get(ProjectExtractionTemplate, template_id)
    if template is None or template.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")

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
    snapshot builder and would manufacture phantom changes (D5).

    B-9c2 D2 — the gate is ``baseline_is_restorable``, the same one
    ``discard_available`` uses, and not ``snapshot_is_narrow`` directly.
    The two disagree on exactly one shape: an EMPTY published baseline,
    which ``snapshot_is_narrow`` calls narrow by design (so the run view
    falls back to live rows) but which is a perfectly honest diff baseline
    — every live node reads as added, because it was. Sharing the gate is
    what makes ``discard_available`` ⇒ an integer count, so the Discard
    dialog never has to render an "unknown count" variant.
    """
    if active is None:
        return None
    baseline: dict[str, Any] = active.schema_ or {}
    if not baseline_is_restorable(baseline):
        return None
    current = await build_template_version_snapshot(db, template_id)
    # A count consumes no tiers, so it needs no value lookup — B-9b's diff
    # endpoint resolves the real set for the Publish sheet's warnings (D3).
    return diff_snapshots(baseline, current, fields_with_values=frozenset()).total


async def get_template_config_diff(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateConfigDiffRead:
    """What the open draft would publish (B-9b2a), BOLA-scoped by (id, project_id).

    Three shapes, all 200 — an un-diffable template is a state the Publish
    sheet explains, never an error (D9):

    * no active version ⇒ ``initial_version``. Nothing published, so there
      is no baseline and every node is new by definition;
    * a baseline the diff engine cannot be trusted with ⇒
      ``baseline_too_old``, gated on ``baseline_is_restorable`` — the SAME
      predicate ``discard_available`` and the pending count already use.
      That gate is not a nicety: ``role`` defaults to ``None`` in the engine
      but is non-nullable live, so diffing a pre-0026 baseline manufactures
      at least one phantom SEMANTIC row per entity type, deterministically —
      a sheet full of changes beside a chip that shows no count at all;
    * otherwise the computed diff, bucketed by tier.

    Unlike the chip's count, this read resolves the REAL recorded set (D3):
    the tiers it buckets by depend on it (a ``field_type`` change is
    semantic on an empty field and destructive on one holding answers), and
    every row carries ``affects_recorded_data``. Takes no locks — it is a
    read, and a stale row is a re-fetch, not a corruption.
    """
    template = await db.get(ProjectExtractionTemplate, template_id)
    if template is None or template.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")

    active = await ExtractionTemplateVersionRepository(db).get_active(template_id)
    if active is None:
        return TemplateConfigDiffRead(
            project_template_id=template_id, diff_available=False, initial_version=True
        )
    baseline: dict[str, Any] = active.schema_ or {}
    if not baseline_is_restorable(baseline):
        return TemplateConfigDiffRead(
            project_template_id=template_id,
            diff_available=False,
            unavailable_reason=TemplateDiffUnavailableReason.BASELINE_TOO_OLD,
        )

    current = await build_template_version_snapshot(db, template_id)
    children = _field_ids_by_parent(current)
    # LIVE field ids only, and that is correct rather than lucky: every
    # workflow ``field_id`` FK is RESTRICT, so a field absent from the live
    # tree provably holds no recorded work.
    recorded = await ExtractionFieldReferenceRepository(db).fields_with_recorded_work(
        sorted({field_id for owned in children.values() for field_id in owned})
    )
    diff = diff_snapshots(baseline, current, fields_with_values=recorded)
    return TemplateConfigDiffRead(
        project_template_id=template_id,
        diff_available=True,
        changes=_bucket_by_tier(with_recorded_data(diff.changes, children, recorded)),
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


def _bucket_by_tier(rows: Sequence[TemplateChangeRow]) -> TemplateConfigDiffBuckets:
    """Group the rows by severity, preserving the engine's order within each."""
    by_tier: dict[ChangeTier, list[TemplateChangeRowRead]] = {tier: [] for tier in ChangeTier}
    for row in rows:
        by_tier[row.tier].append(TemplateChangeRowRead.model_validate(row))
    return TemplateConfigDiffBuckets(
        additive=by_tier[ChangeTier.ADDITIVE],
        cosmetic=by_tier[ChangeTier.COSMETIC],
        semantic=by_tier[ChangeTier.SEMANTIC],
        destructive=by_tier[ChangeTier.DESTRUCTIVE],
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
    template = await db.get(ProjectExtractionTemplate, template_id)
    if template is None or template.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")

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
