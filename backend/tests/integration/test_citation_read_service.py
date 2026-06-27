"""Integration tests for citation_read_service — Task 7.

Verifies:
  - ``verified`` means "entailed" (label == "entailed" → True; "weak" → False)
  - ``anchored`` is decoupled from ``verified``: a weak/unsupported-but-anchored
    row still carries its anchor payload (highlight preserved)
  - ``attributionLabel`` is exposed in each citation dict
  - Legacy rows (attribution_label IS NULL) fall back to evidence_is_grounded(position)

Seeding pattern mirrors test_position_v1_anchoring.py (db_session_real +
raw SQL inserts; a fresh article per test to avoid cross-contamination).
"""

from __future__ import annotations

import json
import uuid
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.citation_read_service import list_article_citations
from tests.integration.conftest import SEED

# ---------------------------------------------------------------------------
# Shared helpers (copied from test_position_v1_anchoring for clarity)
# ---------------------------------------------------------------------------

_VALID_POSITION_V1 = {
    "version": 1,
    "anchor": {
        "kind": "text",
        "range": {
            "page": 1,
            "charStart": 0,
            "charEnd": 40,
        },
        "quote": "Sample anchored quote for attribution test.",
    },
}


async def _insert_article(db: AsyncSession, *, project_id: UUID, title: str) -> UUID:
    article_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, :title, 1)"
        ),
        {"id": str(article_id), "pid": str(project_id), "title": title},
    )
    await db.commit()
    return article_id


async def _delete_article(db: AsyncSession, *, article_id: UUID) -> None:
    await db.execute(text("DELETE FROM public.articles WHERE id = :id"), {"id": str(article_id)})
    await db.commit()


async def _insert_article_file(db: AsyncSession, *, project_id: UUID, article_id: UUID) -> UUID:
    file_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.article_files "
            "(id, project_id, article_id, file_type, storage_key, file_role) "
            "VALUES (:id, :pid, :aid, 'pdf', :key, 'MAIN')"
        ),
        {
            "id": str(file_id),
            "pid": str(project_id),
            "aid": str(article_id),
            "key": f"test-attribution/{file_id}.pdf",
        },
    )
    await db.commit()
    return file_id


async def _cleanup_file(db: AsyncSession, *, file_id: UUID) -> None:
    await db.execute(text("DELETE FROM public.article_files WHERE id = :id"), {"id": str(file_id)})
    await db.commit()


async def _insert_run_and_proposal(
    db: AsyncSession, *, project_id: UUID, article_id: UUID
) -> tuple[UUID, UUID]:
    """Create a minimal extraction_run + proposal_record (mirrors test_position_v1_anchoring)."""
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND kind='extraction' LIMIT 1"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    version_id = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active LIMIT 1"
            ),
            {"tid": str(template_id)},
        )
    ).scalar()
    entity_type_id = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid LIMIT 1"
            ),
            {"tid": str(template_id)},
        )
    ).scalar()
    field_id = (
        await db.execute(
            text("SELECT id FROM public.extraction_fields WHERE entity_type_id = :etid LIMIT 1"),
            {"etid": str(entity_type_id)},
        )
    ).scalar()

    instance_id = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_instances "
                "WHERE article_id = :aid AND entity_type_id = :etid LIMIT 1"
            ),
            {"aid": str(article_id), "etid": str(entity_type_id)},
        )
    ).scalar()
    if instance_id is None:
        instance_id = uuid.uuid4()
        await db.execute(
            text(
                "INSERT INTO public.extraction_instances "
                "(id, project_id, template_id, entity_type_id, article_id, "
                " label, created_by) "
                "VALUES (:id, :pid, :tid, :etid, :aid, 'attribution-test', :cb)"
            ),
            {
                "id": str(instance_id),
                "pid": str(project_id),
                "tid": str(template_id),
                "etid": str(entity_type_id),
                "aid": str(article_id),
                "cb": str(SEED.primary_profile),
            },
        )

    run_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_runs "
            "(id, project_id, article_id, template_id, version_id, kind, stage, "
            " status, created_by) "
            "VALUES (:id, :pid, :aid, :tid, :vid, 'extraction', 'pending', "
            " 'pending', :cb)"
        ),
        {
            "id": str(run_id),
            "pid": str(project_id),
            "aid": str(article_id),
            "tid": str(template_id),
            "vid": str(version_id),
            "cb": str(SEED.primary_profile),
        },
    )
    proposal_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_proposal_records "
            "(id, run_id, instance_id, field_id, source, proposed_value) "
            "VALUES (:id, :rid, :inst, :fid, 'ai', '{}'::jsonb)"
        ),
        {
            "id": str(proposal_id),
            "rid": str(run_id),
            "inst": str(instance_id),
            "fid": str(field_id),
        },
    )
    await db.commit()
    return run_id, proposal_id


async def _insert_evidence(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
    file_id: UUID,
    run_id: UUID,
    proposal_id: UUID,
    position: dict,
    attribution_label: str | None,
    text_content: str = "Test quote",
) -> UUID:
    evidence_id = uuid.uuid4()
    if attribution_label is not None:
        await db.execute(
            text(
                "INSERT INTO public.extraction_evidence "
                "(id, project_id, article_id, article_file_id, "
                " run_id, proposal_record_id, "
                " page_number, text_content, position, attribution_label, created_by) "
                "VALUES (:id, :pid, :aid, :fid, :rid, :propid, :pg, :tc, "
                " CAST(:pos AS jsonb), :label, :cb)"
            ),
            {
                "id": str(evidence_id),
                "pid": str(project_id),
                "aid": str(article_id),
                "fid": str(file_id),
                "rid": str(run_id),
                "propid": str(proposal_id),
                "pg": 1,
                "tc": text_content,
                "pos": json.dumps(position),
                "label": attribution_label,
                "cb": str(SEED.primary_profile),
            },
        )
    else:
        # NULL attribution_label (legacy row)
        await db.execute(
            text(
                "INSERT INTO public.extraction_evidence "
                "(id, project_id, article_id, article_file_id, "
                " run_id, proposal_record_id, "
                " page_number, text_content, position, created_by) "
                "VALUES (:id, :pid, :aid, :fid, :rid, :propid, :pg, :tc, "
                " CAST(:pos AS jsonb), :cb)"
            ),
            {
                "id": str(evidence_id),
                "pid": str(project_id),
                "aid": str(article_id),
                "fid": str(file_id),
                "rid": str(run_id),
                "propid": str(proposal_id),
                "pg": 1,
                "tc": text_content,
                "pos": json.dumps(position),
                "cb": str(SEED.primary_profile),
            },
        )
    await db.commit()
    return evidence_id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verified_follows_attribution_label(
    db_session_real: AsyncSession,
) -> None:
    """Seed entailed + weak + null-label anchored evidence; assert verified, attributionLabel, anchor."""
    article_id = await _insert_article(
        db_session_real,
        project_id=SEED.primary_project,
        title="Task-7 attribution label test",
    )
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=article_id,
    )
    run_id, proposal_id = await _insert_run_and_proposal(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=article_id,
    )

    try:
        # (1) Anchored + entailed
        await _insert_evidence(
            db_session_real,
            project_id=SEED.primary_project,
            article_id=article_id,
            file_id=file_id,
            run_id=run_id,
            proposal_id=proposal_id,
            position=_VALID_POSITION_V1,
            attribution_label="entailed",
            text_content="Entailed quote.",
        )
        # (2) Anchored + weak
        await _insert_evidence(
            db_session_real,
            project_id=SEED.primary_project,
            article_id=article_id,
            file_id=file_id,
            run_id=run_id,
            proposal_id=proposal_id,
            position=_VALID_POSITION_V1,
            attribution_label="weak",
            text_content="Weak quote.",
        )
        # (3) Anchored + null label (legacy row — verified should fall back to anchored=True)
        await _insert_evidence(
            db_session_real,
            project_id=SEED.primary_project,
            article_id=article_id,
            file_id=file_id,
            run_id=run_id,
            proposal_id=proposal_id,
            position=_VALID_POSITION_V1,
            attribution_label=None,
            text_content="Legacy quote.",
        )

        citations = await list_article_citations(db_session_real, article_id)
        assert len(citations) == 3

        by_label: dict[str | None, dict] = {c["attributionLabel"]: c for c in citations}

        # --- entailed row ---
        entailed = by_label["entailed"]
        assert entailed["verified"] is True, "entailed → verified must be True"
        assert entailed["attributionLabel"] == "entailed"
        assert entailed["anchor"] is not None, "entailed anchor must be present"

        # --- weak row ---
        weak = by_label["weak"]
        assert weak["verified"] is False, "weak → verified must be False"
        assert weak["attributionLabel"] == "weak"
        # Key assertion: weak-but-anchored row still carries its anchor payload
        assert weak["anchor"] is not None, "weak-but-anchored row must still have anchor"
        assert weak["anchorKind"] == "text"

        # --- legacy row (null label) ---
        legacy = by_label[None]
        assert legacy["verified"] is True, "null label + anchored → fallback verified=True"
        assert legacy["attributionLabel"] is None
        assert legacy["anchor"] is not None, "legacy anchored row must still have anchor"
        assert legacy["anchorKind"] == "text"

    finally:
        await db_session_real.execute(
            text("DELETE FROM public.extraction_evidence WHERE article_id = :aid"),
            {"aid": str(article_id)},
        )
        await db_session_real.commit()
        await db_session_real.execute(
            text("DELETE FROM public.extraction_runs WHERE id = :id"),
            {"id": str(run_id)},
        )
        await db_session_real.commit()
        await _cleanup_file(db_session_real, file_id=file_id)
        await _delete_article(db_session_real, article_id=article_id)
