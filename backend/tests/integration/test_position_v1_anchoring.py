"""Integration tests for PositionV1 evidence anchoring (Task 2.2).

Verifies the full write path:
  build_anchor(quote, blocks) → PositionV1 → ExtractionEvidence.position (JSONB)

Four cases:
  1. prose quote  → TextCitationAnchor  (kind="text")
  2. table_cell quote → HybridCitationAnchor (kind="hybrid", rect present)
  3. unmatched quote / no blocks → position == {} (safe fallback, run continues)
  4. citation_read_service emits the stored anchor camelCase for an anchored row

Uses db_session_real because ExtractionEvidence is inserted inside
_create_suggestions, which calls flush() (not commit()); we commit at
the end of each test body and clean up in finally blocks.
"""

from __future__ import annotations

import uuid
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEvidence
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from app.schemas.extraction import (
    HybridCitationAnchor,
    PositionV1,
    TextCitationAnchor,
    parse_position,
)
from app.services.citation_read_service import list_article_citations
from app.services.evidence_anchor_service import build_anchor
from tests.integration.conftest import SEED

# ---------------------------------------------------------------------------
# Shared helpers  (mirror the pattern from test_article_text_block_repository)
# ---------------------------------------------------------------------------


async def _insert_article_file(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
) -> UUID:
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
            "key": f"test-anchor/{file_id}.pdf",
        },
    )
    await db.commit()
    return file_id


async def _cleanup_file(db: AsyncSession, *, file_id: UUID) -> None:
    """Cascade-delete the article_file and everything under it."""
    await db.execute(
        text("DELETE FROM public.article_files WHERE id = :id"),
        {"id": str(file_id)},
    )
    await db.commit()


async def _cleanup_evidence(db: AsyncSession, *, article_id: UUID) -> None:
    """Remove evidence rows inserted by the test."""
    await db.execute(
        text("DELETE FROM public.extraction_evidence WHERE article_id = :aid"),
        {"aid": str(article_id)},
    )
    await db.commit()


async def _insert_run_and_proposal(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
) -> tuple[UUID, UUID]:
    """Create a minimal extraction_run + proposal_record so evidence rows
    satisfy the ``workflow_target_present`` CHECK constraint.

    Returns (run_id, proposal_record_id).
    """
    # Resolve template + active version + instance + field from seed rows.
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

    # Auto-create an instance for this article if one doesn't exist yet.
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
                "VALUES (:id, :pid, :tid, :etid, :aid, 'anchor-test', :cb)"
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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_anchor_prose_block_returns_text_citation(
    db_session_real: AsyncSession,
) -> None:
    """A quote from a prose block produces a TextCitationAnchor written to the DB."""
    from app.infrastructure.parsing.base import ParsedBlock

    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        prose_text = "The sample consisted of one hundred adult participants."
        repo = ArticleTextBlockRepository(db_session_real)
        await repo.replace_for_file(
            file_id,
            [
                ParsedBlock(
                    page_number=1,
                    block_index=0,
                    text=prose_text,
                    char_start=0,
                    char_end=len(prose_text),
                    bbox={"x": 10.0, "y": 100.0, "width": 400.0, "height": 12.0},
                    block_type="paragraph",
                )
            ],
        )
        await db_session_real.commit()

        blocks = await repo.list_ordered_for_file(file_id)
        pos = build_anchor(prose_text, blocks)
        assert pos is not None, "Expected a PositionV1 for a prose quote"
        assert isinstance(pos, PositionV1)
        assert pos.version == 1
        assert isinstance(pos.anchor, TextCitationAnchor)
        assert pos.anchor.kind == "text"
        assert pos.anchor.range.page == 1
        assert pos.anchor.range.char_start == 0
        assert pos.anchor.range.char_end == len(prose_text)
        assert pos.anchor.quote == prose_text

        # Round-trip: model_dump (camelCase) → parse_position
        dumped = pos.model_dump(by_alias=True, mode="json")
        assert "charStart" in dumped["anchor"]["range"]
        assert "charEnd" in dumped["anchor"]["range"]
        reparsed = parse_position(dumped)
        assert reparsed is not None
        assert isinstance(reparsed.anchor, TextCitationAnchor)

        # Create a run + proposal so the workflow_target_present CHECK passes.
        run_id, proposal_id = await _insert_run_and_proposal(
            db_session_real,
            project_id=SEED.primary_project,
            article_id=SEED.primary_article,
        )

        # Write a real evidence row and verify the JSONB round-trip from the DB
        evidence_id = uuid.uuid4()
        await db_session_real.execute(
            text(
                "INSERT INTO public.extraction_evidence "
                "(id, project_id, article_id, article_file_id, "
                " run_id, proposal_record_id, "
                " page_number, text_content, position, created_by) "
                "VALUES (:id, :pid, :aid, :fid, :rid, :propid, :pg, :tc, CAST(:pos AS jsonb), :cb)"
            ),
            {
                "id": str(evidence_id),
                "pid": str(SEED.primary_project),
                "aid": str(SEED.primary_article),
                "fid": str(file_id),
                "rid": str(run_id),
                "propid": str(proposal_id),
                "pg": 1,
                "tc": prose_text,
                "pos": __import__("json").dumps(dumped),
                "cb": str(SEED.primary_profile),
            },
        )
        await db_session_real.commit()

        row = (
            await db_session_real.execute(
                select(ExtractionEvidence).where(ExtractionEvidence.id == evidence_id)
            )
        ).scalar_one()
        db_pos = parse_position(row.position)
        assert db_pos is not None
        assert isinstance(db_pos.anchor, TextCitationAnchor)
        assert db_pos.anchor.range.char_start == 0
    finally:
        # Clean up evidence, run (CASCADE handles evidence + proposal), and file.
        await db_session_real.execute(
            text("DELETE FROM public.extraction_evidence WHERE id = :id"),
            {"id": str(evidence_id)},
        )
        await db_session_real.commit()
        await db_session_real.execute(
            text("DELETE FROM public.extraction_runs WHERE id = :id"),
            {"id": str(run_id)},
        )
        await db_session_real.commit()
        await _cleanup_file(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_build_anchor_table_cell_block_returns_hybrid_citation(
    db_session_real: AsyncSession,
) -> None:
    """A quote from a table_cell block produces a HybridCitationAnchor with rect."""
    from app.infrastructure.parsing.base import ParsedBlock

    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        table_text = "RR 0.72 (95% CI 0.55-0.94)"
        repo = ArticleTextBlockRepository(db_session_real)
        await repo.replace_for_file(
            file_id,
            [
                ParsedBlock(
                    page_number=2,
                    block_index=0,
                    text=table_text,
                    char_start=0,
                    char_end=len(table_text),
                    bbox={"x": 50.0, "y": 200.0, "width": 150.0, "height": 10.0},
                    block_type="table_cell",
                )
            ],
        )
        await db_session_real.commit()

        blocks = await repo.list_ordered_for_file(file_id)
        pos = build_anchor(table_text, blocks)
        assert pos is not None, "Expected a PositionV1 for a table_cell quote"
        assert isinstance(pos, PositionV1)
        assert isinstance(pos.anchor, HybridCitationAnchor)
        assert pos.anchor.kind == "hybrid"
        assert pos.anchor.range.page == 2
        assert pos.anchor.rect.x == 50.0
        assert pos.anchor.rect.width == 150.0
        assert pos.anchor.quote == table_text

        # camelCase round-trip
        dumped = pos.model_dump(by_alias=True, mode="json")
        assert "rect" in dumped["anchor"]
        reparsed = parse_position(dumped)
        assert reparsed is not None
        assert isinstance(reparsed.anchor, HybridCitationAnchor)
    finally:
        await _cleanup_file(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_build_anchor_no_match_returns_none() -> None:
    """build_anchor returns None when the quote is not found in the blocks."""
    from app.infrastructure.parsing.base import ParsedBlock

    blocks = [
        ParsedBlock(
            page_number=1,
            block_index=0,
            text="Completely different text that shares nothing with the query.",
            char_start=0,
            char_end=59,
            bbox={"x": 0.0, "y": 0.0, "width": 400.0, "height": 12.0},
            block_type="paragraph",
        )
    ]
    pos = build_anchor("The sky is green and pigs can fly over rainbows.", blocks)
    assert pos is None


@pytest.mark.asyncio
async def test_build_anchor_empty_blocks_returns_none() -> None:
    """build_anchor returns None when the block list is empty (no PDF ingested)."""
    pos = build_anchor("Any quote at all", [])
    assert pos is None


@pytest.mark.asyncio
async def test_citation_read_service_verified_true_for_anchored_row(
    db_session_real: AsyncSession,
) -> None:
    """An evidence row with a valid PositionV1 is returned with verified=True, anchorKind='text'."""
    import json

    from app.infrastructure.parsing.base import ParsedBlock

    fresh_article_id = uuid.uuid4()
    await db_session_real.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, :title, 1)"
        ),
        {
            "id": str(fresh_article_id),
            "pid": str(SEED.primary_project),
            "title": "Verified True Test Article",
        },
    )
    await db_session_real.commit()

    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=fresh_article_id,
    )

    try:
        quote = "Beta-blocker therapy reduced all-cause mortality by 34%."
        repo = ArticleTextBlockRepository(db_session_real)
        await repo.replace_for_file(
            file_id,
            [
                ParsedBlock(
                    page_number=5,
                    block_index=0,
                    text=quote,
                    char_start=0,
                    char_end=len(quote),
                    bbox={"x": 72.0, "y": 400.0, "width": 380.0, "height": 12.0},
                    block_type="paragraph",
                )
            ],
        )
        await db_session_real.commit()

        blocks = await repo.list_ordered_for_file(file_id)
        pos = build_anchor(quote, blocks)
        assert pos is not None

        run_id, proposal_id = await _insert_run_and_proposal(
            db_session_real,
            project_id=SEED.primary_project,
            article_id=fresh_article_id,
        )

        dumped = pos.model_dump(by_alias=True, mode="json")
        evidence_id = uuid.uuid4()
        await db_session_real.execute(
            text(
                "INSERT INTO public.extraction_evidence "
                "(id, project_id, article_id, article_file_id, "
                " run_id, proposal_record_id, "
                " page_number, text_content, position, created_by) "
                "VALUES (:id, :pid, :aid, :fid, :rid, :propid, :pg, :tc, CAST(:pos AS jsonb), :cb)"
            ),
            {
                "id": str(evidence_id),
                "pid": str(SEED.primary_project),
                "aid": str(fresh_article_id),
                "fid": str(file_id),
                "rid": str(run_id),
                "propid": str(proposal_id),
                "pg": pos.anchor.range.page,
                "tc": quote,
                "pos": json.dumps(dumped),
                "cb": str(SEED.primary_profile),
            },
        )
        await db_session_real.commit()

        citations = await list_article_citations(db_session_real, fresh_article_id)
        assert len(citations) == 1
        c = citations[0]
        assert c["id"] == str(evidence_id)
        # verified / anchorKind presence (Task 2.3)
        assert c["verified"] is True
        assert c["anchorKind"] == "text"
        assert "anchor" in c
        assert c["anchor"]["kind"] == "text"
    finally:
        await db_session_real.execute(
            text("DELETE FROM public.extraction_evidence WHERE article_id = :aid"),
            {"aid": str(fresh_article_id)},
        )
        await db_session_real.commit()
        await db_session_real.execute(
            text("DELETE FROM public.extraction_runs WHERE id = :id"),
            {"id": str(run_id)},
        )
        await db_session_real.commit()
        await _cleanup_file(db_session_real, file_id=file_id)
        await db_session_real.execute(
            text("DELETE FROM public.articles WHERE id = :id"),
            {"id": str(fresh_article_id)},
        )
        await db_session_real.commit()


@pytest.mark.asyncio
async def test_citation_read_service_verified_false_for_unanchored_row(
    db_session_real: AsyncSession,
) -> None:
    """An evidence row with position={} is returned verified=False, anchorKind=None, not skipped."""
    fresh_article_id = uuid.uuid4()
    await db_session_real.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, :title, 1)"
        ),
        {
            "id": str(fresh_article_id),
            "pid": str(SEED.primary_project),
            "title": "Verified False Test Article",
        },
    )
    await db_session_real.commit()

    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=fresh_article_id,
    )

    try:
        run_id, proposal_id = await _insert_run_and_proposal(
            db_session_real,
            project_id=SEED.primary_project,
            article_id=fresh_article_id,
        )

        evidence_id = uuid.uuid4()
        # Insert with position={} — the hallucinated / no-blocks-yet case.
        await db_session_real.execute(
            text(
                "INSERT INTO public.extraction_evidence "
                "(id, project_id, article_id, article_file_id, "
                " run_id, proposal_record_id, "
                " page_number, text_content, position, created_by) "
                "VALUES (:id, :pid, :aid, :fid, :rid, :propid, NULL, :tc, '{}'::jsonb, :cb)"
            ),
            {
                "id": str(evidence_id),
                "pid": str(SEED.primary_project),
                "aid": str(fresh_article_id),
                "fid": str(file_id),
                "rid": str(run_id),
                "propid": str(proposal_id),
                "tc": "This quote was hallucinated by the AI.",
                "cb": str(SEED.primary_profile),
            },
        )
        await db_session_real.commit()

        citations = await list_article_citations(db_session_real, fresh_article_id)
        # Must NOT be skipped — the row should be present
        assert len(citations) == 1, f"Expected 1 citation (not skipped), got {len(citations)}"
        c = citations[0]
        assert c["id"] == str(evidence_id)
        # verified=False, anchorKind=None (unanchored)
        assert c["verified"] is False
        assert c["anchorKind"] is None
        # anchor is absent or None for unanchored rows
        assert c.get("anchor") is None
        # metadata still present
        assert c["metadata"]["textContent"] == "This quote was hallucinated by the AI."
        # nothing raised — we got here
    finally:
        await db_session_real.execute(
            text("DELETE FROM public.extraction_evidence WHERE article_id = :aid"),
            {"aid": str(fresh_article_id)},
        )
        await db_session_real.commit()
        await db_session_real.execute(
            text("DELETE FROM public.extraction_runs WHERE id = :id"),
            {"id": str(run_id)},
        )
        await db_session_real.commit()
        await _cleanup_file(db_session_real, file_id=file_id)
        await db_session_real.execute(
            text("DELETE FROM public.articles WHERE id = :id"),
            {"id": str(fresh_article_id)},
        )
        await db_session_real.commit()


@pytest.mark.asyncio
async def test_citation_read_service_emits_anchored_evidence_camelcase(
    db_session_real: AsyncSession,
) -> None:
    """citation_read_service returns the stored TextCitationAnchor camelCase for an anchored row."""
    import json

    from app.infrastructure.parsing.base import ParsedBlock

    # Use a fresh article so we don't collide with other test rows
    fresh_article_id = uuid.uuid4()
    await db_session_real.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, :title, 1)"
        ),
        {
            "id": str(fresh_article_id),
            "pid": str(SEED.primary_project),
            "title": "Anchor Read Service Test Article",
        },
    )
    await db_session_real.commit()

    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=fresh_article_id,
    )

    try:
        quote = "Patients were randomized in a 1:1 ratio."
        repo = ArticleTextBlockRepository(db_session_real)
        await repo.replace_for_file(
            file_id,
            [
                ParsedBlock(
                    page_number=3,
                    block_index=0,
                    text=quote,
                    char_start=0,
                    char_end=len(quote),
                    bbox={"x": 72.0, "y": 300.0, "width": 380.0, "height": 12.0},
                    block_type="paragraph",
                )
            ],
        )
        await db_session_real.commit()

        blocks = await repo.list_ordered_for_file(file_id)
        pos = build_anchor(quote, blocks)
        assert pos is not None

        # Create a run + proposal so the workflow_target_present CHECK passes.
        run_id, proposal_id = await _insert_run_and_proposal(
            db_session_real,
            project_id=SEED.primary_project,
            article_id=fresh_article_id,
        )

        dumped = pos.model_dump(by_alias=True, mode="json")
        evidence_id = uuid.uuid4()
        await db_session_real.execute(
            text(
                "INSERT INTO public.extraction_evidence "
                "(id, project_id, article_id, article_file_id, "
                " run_id, proposal_record_id, "
                " page_number, text_content, position, created_by) "
                "VALUES (:id, :pid, :aid, :fid, :rid, :propid, :pg, :tc, CAST(:pos AS jsonb), :cb)"
            ),
            {
                "id": str(evidence_id),
                "pid": str(SEED.primary_project),
                "aid": str(fresh_article_id),
                "fid": str(file_id),
                "rid": str(run_id),
                "propid": str(proposal_id),
                "pg": pos.anchor.range.page,
                "tc": quote,
                "pos": json.dumps(dumped),
                "cb": str(SEED.primary_profile),
            },
        )
        await db_session_real.commit()

        citations = await list_article_citations(db_session_real, fresh_article_id)
        assert len(citations) == 1
        c = citations[0]
        assert c["id"] == str(evidence_id)
        anchor = c["anchor"]
        assert anchor["kind"] == "text"
        assert "range" in anchor
        assert "charStart" in anchor["range"]
        assert "charEnd" in anchor["range"]
        assert anchor["range"]["charStart"] == 0
        assert anchor["range"]["charEnd"] == len(quote)
        meta = c["metadata"]
        assert meta["pageNumber"] == 3
        assert meta["textContent"] == quote
    finally:
        await db_session_real.execute(
            text("DELETE FROM public.extraction_evidence WHERE article_id = :aid"),
            {"aid": str(fresh_article_id)},
        )
        await db_session_real.commit()
        await db_session_real.execute(
            text("DELETE FROM public.extraction_runs WHERE id = :id"),
            {"id": str(run_id)},
        )
        await db_session_real.commit()
        await _cleanup_file(db_session_real, file_id=file_id)
        await db_session_real.execute(
            text("DELETE FROM public.articles WHERE id = :id"),
            {"id": str(fresh_article_id)},
        )
        await db_session_real.commit()
