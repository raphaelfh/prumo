"""Determinism regression for the AI-metadata 'superseded' outcome.

Two ``source='ai'`` proposals for the same ``(run, instance, field)`` that
share ``created_at`` must resolve to a stable latest-vs-superseded
labelling. The export's proposal query
(``ExtractionExportService._load_ai_proposal_rows``) orders newest-first
and treats the first-seen row per coord as the latest; ``id`` is the
deterministic tiebreaker on equal ``created_at`` (same-transaction inserts
share PostgreSQL's transaction-start ``now()``), matching the canonical
``ExtractionProposalRepository.get_latest_for_coord`` ordering.

Without the ``id`` tiebreak the FR-037 ``reviewer_outcome`` flips between
export builds. The existing unit determinism test
(``test_extraction_export_determinism``) only exercises pre-built
``AIProposalRow`` objects, so the DB query ordering is otherwise uncovered.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionFieldType,
    ExtractionRun,
    ExtractionRunStage,
    TemplateKind,
)
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
)
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    ExtractionExportService,
    FieldDescriptor,
    SectionDescriptor,
)
from app.services.hitl_session_service import HITLSessionService

# Same created_at on both proposals → forces the equal-timestamp tie the
# ``id`` ordering must break. Distinct, hand-picked ids make "latest"
# unambiguous: ``id_high`` sorts after ``id_low`` so ``id.desc()`` must
# surface it first.
_SHARED_TS = datetime(2026, 1, 1, tzinfo=UTC)
_ID_LOW = UUID("00000000-0000-4000-8000-000000000000")
_ID_HIGH = UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")


async def _coord(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID, UUID, UUID, UUID] | None:
    """Resolve a coherent (project, article, template, profile, entity_type,
    instance, field) tuple from one seeded extraction instance. Returns
    None when the dev DB is not seeded (test skips). All columns are
    non-null by the JOIN."""
    profile = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    row = (
        await db.execute(
            text(
                """
                SELECT i.article_id, i.template_id, i.entity_type_id, i.id, f.id, t.project_id
                FROM public.extraction_instances i
                JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
                JOIN public.extraction_fields f ON f.entity_type_id = et.id
                JOIN public.project_extraction_templates t ON t.id = i.template_id
                WHERE t.kind = 'extraction'
                LIMIT 1
                """
            )
        )
    ).first()
    if profile is None or row is None:
        return None
    article_id, template_id, entity_type_id, instance_id, field_id, project_id = row
    return (
        UUID(str(project_id)),
        UUID(str(article_id)),
        UUID(str(template_id)),
        UUID(str(profile)),
        UUID(str(entity_type_id)),
        UUID(str(instance_id)),
        UUID(str(field_id)),
    )


async def _make_run(
    db: AsyncSession, *, project_id, article_id, template_id, profile_id
) -> ExtractionRun:
    """Create a fresh PROPOSAL run for the coord (clearing leaked runs first;
    the test's rolled-back session undoes both)."""
    await db.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )
    session = await HITLSessionService(db).open_or_resume(
        kind=TemplateKind.EXTRACTION,
        project_id=project_id,
        article_id=article_id,
        user_id=profile_id,
        project_template_id=template_id,
    )
    run = await db.get(ExtractionRun, session.run_id)
    assert run is not None
    return run


def _ai_proposal(*, proposal_id, run_id, instance_id, field_id, value) -> ExtractionProposalRecord:
    return ExtractionProposalRecord(
        id=proposal_id,
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI.value,
        proposed_value={"value": value},
        created_at=_SHARED_TS,
    )


async def test_ai_superseded_outcome_is_deterministic_on_equal_created_at(
    db_session: AsyncSession,
) -> None:
    """Higher-id proposal is 'latest' (→ 'pending', no decisions); lower-id is
    'superseded' — stable across repeated export builds."""

    coord = await _coord(db_session)
    if coord is None:
        pytest.skip("dev DB not seeded with an extraction instance")
    project_id, article_id, template_id, profile_id, entity_type_id, instance_id, field_id = coord

    run = await _make_run(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        profile_id=profile_id,
    )

    db_session.add_all(
        [
            _ai_proposal(
                proposal_id=_ID_LOW,
                run_id=run.id,
                instance_id=instance_id,
                field_id=field_id,
                value="LOW",
            ),
            _ai_proposal(
                proposal_id=_ID_HIGH,
                run_id=run.id,
                instance_id=instance_id,
                field_id=field_id,
                value="HIGH",
            ),
        ]
    )
    await db_session.flush()

    service = ExtractionExportService(
        db=db_session, user_id=str(profile_id), storage=MagicMock(), trace_id="t"
    )
    article = ArticleDescriptor(
        article_id=article_id,
        header_label="Article",
        run_id=run.id,
        run_stage=ExtractionRunStage(run.stage),
        model_instances=(),
        study_instances={entity_type_id: instance_id},
    )
    section = SectionDescriptor(
        entity_type_id=entity_type_id,
        label="Section",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(
            FieldDescriptor(
                field_id=field_id,
                label="Field",
                type=ExtractionFieldType.TEXT,
                allowed_values=(),
                parent_section_id=entity_type_id,
            ),
        ),
    )

    async def build() -> dict[object, str]:
        rows = await service._load_ai_proposal_rows(
            articles=(article,), sections=(section,), value_map={}, mode=ExportMode.CONSENSUS
        )
        return {r.ai_proposed_value: r.reviewer_outcome for r in rows}

    first = await build()
    assert first == {"HIGH": "pending", "LOW": "superseded"}
    # Determinism: a second build yields the identical labelling.
    assert await build() == first
