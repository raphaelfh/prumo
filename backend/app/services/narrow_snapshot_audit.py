"""Which templates carry a pre-0026 published baseline, and why (B-9x).

`snapshot_is_narrow` (`extraction_snapshot.py:145`) answers yes/no, and
three different eras can trigger it. That is exactly enough for the
product's gates — `baseline_is_restorable` only needs a boolean — and not
nearly enough for an operator, who gets told "this template's published
version predates the current snapshot format" and has no way to know what
to do about it.

This module names the era and the remedy. It does not fix anything, and
that is deliberate: the missing keys are genuinely UNKNOWN for these
snapshots, not defaulted. Backfilling `llm_description`/`allow_other` with
defaults would fabricate history, and writing that history back over live
rows is precisely the wipe `baseline_is_restorable` exists to prevent.

Run it with::

    cd backend && uv run python -m app.services.narrow_snapshot_audit

The classifier is pure so it can be tested without a database; only the
reporter touches one.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Any
from uuid import UUID

__all__ = ["NarrowEra", "BaselineClassification", "classify_baseline"]


class NarrowEra(Enum):
    """Which snapshot era a published baseline belongs to.

    Ordered worst-first for a mixed tree: a heterogeneous snapshot needs
    the most severe remedy, not a fourth one.
    """

    PRE_0017_NO_ROLE = (
        "pre-0017 (no role)",
        "Republish the current configuration. The stored baseline predates "
        "`role` entirely, so nothing can be restored from it — the live "
        "tree is the only trustworthy source.",
    )
    PRE_0026_NARROW_FIELDS = (
        "pre-0026 (narrow fields)",
        "Republish the current configuration. Migration 0026's backfill "
        "keyed on the role probe and skipped exactly these rows, so their "
        "fields never gained llm_description/allow_other. Restoring one "
        "would default those across the project.",
    )
    EMPTY = (
        "empty",
        "Nothing to do. An empty baseline is restorable — the restore is a "
        "plain delete-all — even though snapshot_is_narrow() calls it "
        "narrow so the run view falls back to live rows.",
    )
    WIDE = ("wide", "Nothing to do.")

    def __init__(self, label: str, remedy: str) -> None:
        self.label = label
        self.remedy = remedy


@dataclass(frozen=True, slots=True)
class BaselineClassification:
    era: NarrowEra
    restorable: bool
    """Mirrors ``baseline_is_restorable`` exactly — pinned by a test, so the
    audit can never tell an operator something the running gates disbelieve."""
    narrow_entity_type_ids: tuple[str, ...] = ()
    """The offending sections, so a big template does not have to be read
    whole to find them."""


def classify_baseline(schema_: dict[str, Any] | None) -> BaselineClassification:
    """Name the era of a published snapshot, and what it blocks."""
    entity_types = (schema_ or {}).get("entity_types") or []
    if not entity_types:
        # Empty is restorable, even though snapshot_is_narrow() says narrow.
        return BaselineClassification(era=NarrowEra.EMPTY, restorable=True)

    missing_role: list[str] = []
    narrow_fields: list[str] = []
    for entity_type in entity_types:
        node_id = str(entity_type.get("id", "?"))
        if "role" not in entity_type:
            missing_role.append(node_id)
            continue
        for field in entity_type.get("fields") or []:
            if "llm_description" not in field or "allow_other" not in field:
                narrow_fields.append(node_id)
                break

    if missing_role:
        return BaselineClassification(
            era=NarrowEra.PRE_0017_NO_ROLE,
            restorable=False,
            narrow_entity_type_ids=tuple(missing_role + narrow_fields),
        )
    if narrow_fields:
        return BaselineClassification(
            era=NarrowEra.PRE_0026_NARROW_FIELDS,
            restorable=False,
            narrow_entity_type_ids=tuple(narrow_fields),
        )
    return BaselineClassification(era=NarrowEra.WIDE, restorable=True)


async def _report() -> int:
    """Print one line per template with an unrestorable baseline.

    Imports live here rather than at module scope so the classifier stays
    importable — and testable — without a database or app settings.
    """
    from sqlalchemy import select

    from app.core.deps import AsyncSessionLocal
    from app.models.extraction import ProjectExtractionTemplate
    from app.models.extraction_versioning import ExtractionTemplateVersion

    affected = 0
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(
                    ProjectExtractionTemplate.id,
                    ProjectExtractionTemplate.project_id,
                    ExtractionTemplateVersion.version,
                    ExtractionTemplateVersion.schema_,
                )
                .join(
                    ExtractionTemplateVersion,
                    ExtractionTemplateVersion.project_template_id == ProjectExtractionTemplate.id,
                )
                .where(ExtractionTemplateVersion.is_active.is_(True))
            )
        ).all()

        for template_id, project_id, version, schema_ in rows:
            result = classify_baseline(schema_)
            if result.restorable:
                continue
            affected += 1
            _print_finding(template_id, project_id, version, result)

    print(f"\n{affected} template(s) of {len(rows)} carry an unrestorable baseline.")
    if affected:
        print(
            "Each one cannot diff, cannot Discard, and publishes without the "
            "B-9b2b acknowledgement gate (no diff is computable, so there are "
            "no rows to acknowledge). Publishing heals it: the new version is "
            "built from live rows."
        )
    return affected


def _print_finding(
    template_id: UUID, project_id: UUID, version: int, result: BaselineClassification
) -> None:
    print(f"\ntemplate {template_id}  (project {project_id}, active v{version})")
    print(f"  era:      {result.era.label}")
    print(f"  sections: {', '.join(result.narrow_entity_type_ids) or '(all)'}")
    print(f"  remedy:   {result.era.remedy}")


if __name__ == "__main__":  # pragma: no cover - operator entry point
    import asyncio

    raise SystemExit(0 if asyncio.run(_report()) == 0 else 1)
