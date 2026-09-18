"""What the model is allowed to see for ONE run.

One exclusion: **assessor-owned coordinates** — the derived spec's
target/rationale/summary pointers. A judgment the reviewer is supposed to make
is never handed to the model to pre-fill.

It is declared data on the template's live ``schema``. A template that declares
no derived spec yields an empty filter and every field list passes through
untouched — no ``kind ==`` branch anywhere.

A PROBAST+AI study-type classification does not narrow what the model is
asked: the AI fills the whole instrument, and the layers that decide what a
value counts for (the QA form, the derived judgments, the export) evaluate the
template's rules on their own.

Lives outside ``section_extraction_service`` deliberately: that module is at
its file-size ratchet cap, and construction (which needs the DB) has no reason
to sit next to consumption (which does not).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionRun,
    ProjectExtractionTemplate,
)
from app.services.derived_judgment_service import derived_spec, excluded_field_coordinates

logger = get_logger(__name__)


@dataclass(frozen=True)
class LlmFieldFilter:
    """The assessor-owned coordinates, empty when the template declares no spec."""

    excluded_coordinates: frozenset[tuple[str, str]] = frozenset()


async def build_llm_field_filter(db: AsyncSession, run: ExtractionRun) -> LlmFieldFilter:
    """Resolve the excluded coordinates for *run* from its template's live schema."""
    # `template_id` is Mapped[UUID], NOT NULL, FK ON DELETE RESTRICT — it
    # cannot be None and cannot dangle. The getattr default still covers the
    # row being absent, which only a hand-deleted template could produce.
    template = await db.get(ProjectExtractionTemplate, run.template_id)
    schema = getattr(template, "schema_", None)
    excluded = frozenset(excluded_field_coordinates(derived_spec(schema)))
    if excluded:
        await _warn_orphaned_exclusions(db, run, excluded)
    return LlmFieldFilter(excluded_coordinates=excluded)


async def _warn_orphaned_exclusions(
    db: AsyncSession, run: ExtractionRun, excluded: frozenset[tuple[str, str]]
) -> None:
    """Warn for an exclusion coordinate that no LIVE field answers to.

    A live rename orphans the spec's pointer, which would quietly re-open an
    assessor-owned field to the model — fail open (the spec is advisory data)
    but never silently. Asked ONCE per run against the whole live tree, which
    is the only place the question has an answer: the consumer sees one
    section at a time, already narrowed by the human-proposal skip, so there it
    read every legitimately absent field as a rename.
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
