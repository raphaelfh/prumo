"""What the model is allowed to see for ONE run.

One exclusion: **assessor-owned coordinates** — the derived spec's
target/rationale/summary pointers. A judgment the reviewer is supposed to make
is never handed to the model to pre-fill.

It is declared data frozen in the run's pinned template version. A version
that declares no derived spec yields an empty filter and every field list passes through
untouched — no ``kind ==`` branch anywhere.

A PROBAST+AI study-type classification does not narrow what the model is
asked: the AI fills the whole instrument, and the layers that decide what a
value counts for (the QA form, the derived judgments, the export) evaluate the
template's rules on their own.

Construction (which needs the DB) lives here; consumption is the model-call
step of ``app.services.ai_extraction`` and its ``ProposalLanding`` re-read.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionRun,
)
from app.services.derived_judgment_service import derived_spec, excluded_field_coordinates
from app.services.extraction_snapshot import pinned_template_rules

logger = get_logger(__name__)


@dataclass(frozen=True)
class LlmFieldFilter:
    """The assessor-owned coordinates, empty when the template declares no spec."""

    excluded_coordinates: frozenset[tuple[str, str]] = frozenset()


def llm_field_filter_of(template_schema: dict[str, Any] | None) -> LlmFieldFilter:
    """The excluded coordinates a template-schema-shaped rules dict declares — no I/O.

    ``ProposalLanding`` reads the pinned rules under the run lock and filters
    through this; the orphaned-exclusion warning stays with
    :func:`build_llm_field_filter`, asked once per run.
    """
    return LlmFieldFilter(frozenset(excluded_field_coordinates(derived_spec(template_schema))))


async def build_llm_field_filter(db: AsyncSession, run: ExtractionRun) -> LlmFieldFilter:
    """Resolve the excluded coordinates for *run* from its pinned version's rules."""
    rules = (await pinned_template_rules(db, [run.version_id])).get(run.version_id, {})
    field_filter = llm_field_filter_of(rules)
    if field_filter.excluded_coordinates:
        await _warn_orphaned_exclusions(db, run, field_filter.excluded_coordinates)
    return field_filter


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
