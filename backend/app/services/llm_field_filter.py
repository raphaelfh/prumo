"""What the model is allowed to see for ONE run.

Two exclusions, resolved together because every LLM call needs both and
neither is worth a second round trip:

* **Assessor-owned coordinates** — the derived spec's target/rationale/summary
  pointers. A judgment the reviewer is supposed to make is never handed to the
  model to pre-fill.
* **Out-of-scope sections** — PROBAST+AI 2.1.0's scope rules. A development-only
  study has no evaluation part to assess, so the model is not asked about one.
  The client hides those sections too, but that is a courtesy: THIS is the
  enforcement, and it covers the per-section button and the extract-all pass
  from a single place.

Both are declared data on the template's live ``schema``. A template that
declares neither yields an empty filter and every field list passes through
untouched — no ``kind ==`` branch anywhere.

Lives outside ``section_extraction_service`` deliberately: that module is at
its file-size ratchet cap, and construction (which needs the DB) has no reason
to sit next to consumption (which does not).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionInstance,
    ProjectExtractionTemplate,
)
from app.models.extraction_workflow import ExtractionProposalRecord
from app.services.derived_judgment_service import (
    derived_spec,
    excluded_field_coordinates,
    out_of_scope_sections,
    scope_classifier_coordinate,
)
from app.services.extraction_snapshot import entity_types_for_version

logger = get_logger(__name__)


@dataclass(frozen=True)
class LlmFieldFilter:
    """The two exclusion sets, empty when the template declares no rules."""

    excluded_coordinates: frozenset[tuple[str, str]] = frozenset()
    out_of_scope_sections: frozenset[str] = frozenset()


async def build_llm_field_filter(db: AsyncSession, run: Any) -> LlmFieldFilter:
    """Resolve both exclusion sets for *run* from its template's live schema."""
    # `template_id` is Mapped[UUID], NOT NULL, FK ON DELETE RESTRICT — it
    # cannot be None and cannot dangle. The getattr default still covers the
    # row being absent, which only a hand-deleted template could produce.
    template = await db.get(ProjectExtractionTemplate, run.template_id)
    schema = getattr(template, "schema_", None)
    excluded = frozenset(excluded_field_coordinates(derived_spec(schema)))
    if excluded:
        await _warn_orphaned_exclusions(db, run, excluded)
    return LlmFieldFilter(
        excluded_coordinates=excluded,
        out_of_scope_sections=await _out_of_scope_for_run(db, run, schema),
    )


async def _warn_orphaned_exclusions(
    db: AsyncSession, run: Any, excluded: frozenset[tuple[str, str]]
) -> None:
    """Warn for an exclusion coordinate that no LIVE field answers to.

    A live rename orphans the spec's pointer, which would quietly re-open an
    assessor-owned field to the model — fail open (the spec is advisory data)
    but never silently. Asked ONCE per run against the whole live tree, which
    is the only place the question has an answer: the consumer sees one
    section at a time, already narrowed by scope and by the human-proposal
    skip, so there it read every legitimately absent field as a rename.
    """
    rows = (
        await db.execute(
            select(ExtractionEntityType.name, ExtractionField.name)
            .join(ExtractionField, ExtractionField.entity_type_id == ExtractionEntityType.id)
            .where(ExtractionEntityType.project_template_id == run.template_id)
        )
    ).all()
    dangling = sorted(excluded - {(str(s), str(f)) for s, f in rows})
    if dangling:
        logger.warning("qa_derived_spec_dangling_ref", run_id=str(run.id), coordinates=dangling)


async def _out_of_scope_for_run(db: AsyncSession, run: Any, schema: Any) -> frozenset[str]:
    """The scope rules applied to this run's own classification answer.

    Resolves the classifier's ``(section, field)`` names against the run's
    PINNED tree — never live rows, matching every other structure read on the
    AI path — then reads the newest proposal on that coordinate, which is the
    same source the QA form hydrates from. An unanswered or undecidable
    classifier excludes nothing, so an unclassified run still gets the whole
    instrument.
    """
    coordinate = scope_classifier_coordinate(schema)
    if coordinate is None:
        return frozenset()
    section_name, field_name = coordinate

    entity_types = await entity_types_for_version(
        db, version_id=run.version_id, template_id=run.template_id
    )
    section = next((et for et in entity_types if et.name == section_name), None)
    if section is None:
        return frozenset()
    field = next((f for f in section.fields if f.name == field_name), None)
    if field is None:
        return frozenset()

    value = await _newest_proposal_value(db, run.id, section.id, field.id)
    return out_of_scope_sections(schema, {coordinate: value})


async def _newest_proposal_value(
    db: AsyncSession, run_id: UUID, entity_type_id: UUID, field_id: UUID
) -> Any:
    """The latest proposed value on one coordinate of *run*, or None.

    Same shape as ``_fields_with_recent_human_proposal``: order by created_at
    descending and take the first row. The instance is resolved through the
    run's own article so a second article's answer can never decide this run's
    scope.
    """
    stmt = (
        select(ExtractionProposalRecord.proposed_value)
        .join(
            ExtractionInstance,
            ExtractionInstance.id == ExtractionProposalRecord.instance_id,
        )
        .where(
            ExtractionProposalRecord.run_id == run_id,
            ExtractionProposalRecord.field_id == field_id,
            ExtractionInstance.entity_type_id == entity_type_id,
        )
        .order_by(ExtractionProposalRecord.created_at.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()
