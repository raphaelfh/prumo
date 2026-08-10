"""Restore-vN: stage an older version's shape as the current draft (B-9e).

Spec section 1: *"'Restore vN' stages that version's shape as the current
draft and goes through the same Publish (history is append-only, never
rewritten)."*

Discard and Restore are the SAME reconcile with two differences, and this
module is only those two differences:

* **Where the baseline comes from.** Discard reads the ACTIVE version;
  Restore takes an arbitrary version id, scoped to the template so an id
  from another template cannot be used as a capability.
* **What happens to the draft marker.** Discard clears it when the tree
  matches published again. Restore deliberately leaves it stamped by the
  0048 triggers — staging an older shape IS a draft, and clearing it would
  leave the Draft chip dark and Publish disabled over a tree that no longer
  matches the active version.

Everything between those ends is :func:`reconcile_to_baseline`, and running
through it is not ceremony. The gates matter MORE for an old version than
for the active one: an old snapshot can omit sections that have since
accumulated ``extraction_instances``, and without the blocked-set analysis
those land in the delete set and abort the transaction on a RESTRICT FK as
an untyped 500 — or strand recorded work.

History is never rewritten. Restoring v1 does not resurrect v1; it makes
the live tree look like v1 so the manager publishes it forward as v_max+1,
through the same Publish contract (fingerprint + per-item acks) as any
other change.
"""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ProjectExtractionTemplate
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.services.extraction_snapshot import baseline_is_restorable
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_discard_service import NarrowBaselineError, reconcile_to_baseline
from app.services.template_version_service import TemplateVersionService

__all__ = ["RestoreVersionResult", "VersionNotFoundError", "restore_version"]

logger = structlog.get_logger(__name__)


class VersionNotFoundError(Exception):
    """The version id does not exist, or belongs to a different template.

    One error for both, deliberately: distinguishing them would confirm
    that a foreign version id exists.
    """


@dataclass(frozen=True, slots=True)
class RestoreVersionResult:
    """What the restore staged.

    ``changed`` is False when the version's shape already equalled the live
    tree. That is a real outcome, not a failure: the writer touches no rows,
    so no 0048 trigger fires, no marker is stamped, and Publish stays
    disabled. Reporting success without it would tell a manager their
    restore landed while the UI shows nothing to publish.
    """

    version: int
    changed: bool
    created_entity_types: int
    created_fields: int
    deleted_entity_types: int
    deleted_fields: int
    updated_entity_types: int
    updated_fields: int
    kept_count: int


async def restore_version(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    version_id: UUID,
    user_id: UUID,
) -> RestoreVersionResult:
    """Stage ``version_id``'s shape as the live tree. Flushes, never commits."""
    template = await db.get(ProjectExtractionTemplate, template_id)
    if template is None or template.project_id != project_id:
        # 404, never 403 — a foreign template id must not leak its existence.
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")

    # Same lock order as republish/discard, before any detection query.
    await TemplateVersionService(db).acquire_publish_locks(template_id)

    version = (
        await db.execute(
            select(ExtractionTemplateVersion).where(
                ExtractionTemplateVersion.id == version_id,
                # Scoped to the template: a version id from elsewhere is not
                # a capability to rewrite this template.
                ExtractionTemplateVersion.project_template_id == template_id,
            )
        )
    ).scalar_one_or_none()
    if version is None:
        raise VersionNotFoundError(f"Version {version_id} not found for template {template_id}")

    baseline: dict[str, Any] = version.schema_ or {}
    if not baseline_is_restorable(baseline):
        # Same gate as Discard, and for the same reason: a pre-0026 snapshot
        # would erase AI instructions and option settings project-wide.
        raise NarrowBaselineError(
            f"Version {version.version} predates the current snapshot format, so "
            "restoring it would erase AI instructions and option settings across "
            "the project."
        )

    reconciled = await reconcile_to_baseline(
        db,
        project_id=project_id,
        template_id=template_id,
        user_id=user_id,
        baseline=baseline,
        # An orphan warning belongs to Discard's two-step question. Restore
        # reaches the same information through the Publish sheet, which
        # already requires a per-item ack for every destructive row before
        # any of this touches published data.
        acknowledge_orphans=True,
    )
    outcome = reconciled.outcome
    changed = bool(
        outcome.created_entity_types
        or outcome.created_fields
        or outcome.deleted_entity_types
        or outcome.deleted_fields
        or outcome.updated_entity_types
        or outcome.updated_fields
        or outcome.instruction_reset
    )

    # The marker is deliberately NOT touched. The 0048 AFTER-ROW triggers
    # stamped it on every row the writer wrote, which is exactly "staged as
    # the current draft". A zero-row restore stamps nothing, and `changed`
    # is how the caller tells the difference.

    logger.info(
        "template_config_version_restored",
        project_id=str(project_id),
        template_id=str(template_id),
        version_id=str(version_id),
        version=version.version,
        changed=changed,
        kept=len(reconciled.kept),
    )

    return RestoreVersionResult(
        version=version.version,
        changed=changed,
        created_entity_types=outcome.created_entity_types,
        created_fields=outcome.created_fields,
        deleted_entity_types=outcome.deleted_entity_types,
        deleted_fields=outcome.deleted_fields,
        updated_entity_types=outcome.updated_entity_types,
        updated_fields=outcome.updated_fields,
        kept_count=len(reconciled.kept),
    )
