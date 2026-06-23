"""Full-chain integration test (spec item #10): persisted blocks → assemble
(no 15k cut) → anchor → citation read.

Proves the A1 win on REAL persisted blocks read through the production repository:
content that lies *past* the legacy 15,000-char truncation survives assembly, and
the model's verbatim quote from that post-15k block anchors back to the correct
block and reads back through ``citation_read_service``.

The anchor write/read primitives (TextCitationAnchor, camelCase round-trip,
verified flag) are exhaustively covered in ``test_position_v1_anchoring.py``;
this test reuses its helpers and focuses on the new ``assemble → anchor`` seam.
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.parsing.base import ParsedBlock
from app.llm.assembler import assemble_for_model
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from app.schemas.extraction import PositionV1, TextCitationAnchor
from app.services.citation_read_service import list_article_citations
from app.services.evidence_anchor_service import build_anchor
from tests.integration.conftest import SEED
from tests.integration.test_position_v1_anchoring import (
    _cleanup_file,
    _insert_article_file,
    _insert_run_and_proposal,
)

_BBOX = {"x": 0.0, "y": 0.0, "width": 400.0, "height": 12.0}


@pytest.mark.asyncio
async def test_post_15k_block_assembles_and_anchors_and_reads_back(
    db_session_real: AsyncSession,
) -> None:
    # Fresh article so evidence/run cleanup never collides with seed or sibling tests.
    article_id = uuid.uuid4()
    await db_session_real.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, :title, 1)"
        ),
        {"id": str(article_id), "pid": str(SEED.primary_project), "title": "A1 block-chain test"},
    )
    await db_session_real.commit()

    file_id = await _insert_article_file(
        db_session_real, project_id=SEED.primary_project, article_id=article_id
    )
    quote = "The C-index was 0.81 (95% CI 0.78-0.84) in the validation cohort."
    try:
        # Page 1: ~17k chars of filler (heading + long paragraph). Page 2: the
        # quotable target — content that lies PAST the legacy 15k prefix cut.
        filler = "Background and prior work. " * 640  # ~17,280 chars
        repo = ArticleTextBlockRepository(db_session_real)
        await repo.replace_for_file(
            file_id,
            [
                ParsedBlock(1, 0, "Introduction", 0, len("Introduction"), _BBOX, "heading"),
                ParsedBlock(1, 1, filler, 0, len(filler), _BBOX, "paragraph"),
                ParsedBlock(2, 0, "Results", 0, len("Results"), _BBOX, "heading"),
                ParsedBlock(2, 1, quote, 0, len(quote), _BBOX, "paragraph"),
            ],
        )
        await db_session_real.commit()

        blocks = await repo.list_ordered_for_file(file_id)
        assert len(blocks) == 4

        # 1. Assemble: the post-15k quote MUST survive (the 15k truncation is gone).
        markdown, info = assemble_for_model(blocks, model_name="gpt-4o-mini", budget_tokens=96_000)
        assert quote in markdown, "post-15k content must survive assembly (no truncation)"
        assert info.truncated is False
        assert info.total_blocks == 4

        # 2. Anchor: the verbatim quote maps back to the correct (page-2) block.
        pos = build_anchor(quote, blocks)
        assert pos is not None and isinstance(pos, PositionV1)
        assert isinstance(pos.anchor, TextCitationAnchor)
        assert pos.anchor.range.page == 2
        assert pos.anchor.quote == quote
        # The anchored char range slices back to the quote in page-2's concatenated text.
        page2 = "\n".join(b.text for b in blocks if b.page_number == 2)
        assert page2[pos.anchor.range.char_start : pos.anchor.range.char_end] == quote

        # 3. Persist evidence and read it back through citation_read_service.
        run_id, proposal_id = await _insert_run_and_proposal(
            db_session_real, project_id=SEED.primary_project, article_id=article_id
        )
        dumped = pos.model_dump(by_alias=True, mode="json")
        evidence_id = uuid.uuid4()
        await db_session_real.execute(
            text(
                "INSERT INTO public.extraction_evidence "
                "(id, project_id, article_id, article_file_id, run_id, proposal_record_id, "
                " page_number, text_content, position, created_by) "
                "VALUES (:id, :pid, :aid, :fid, :rid, :propid, :pg, :tc, CAST(:pos AS jsonb), :cb)"
            ),
            {
                "id": str(evidence_id),
                "pid": str(SEED.primary_project),
                "aid": str(article_id),
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

        citations = await list_article_citations(db_session_real, article_id)
        assert len(citations) == 1
        c = citations[0]
        assert c["id"] == str(evidence_id)
        assert c["verified"] is True
        assert c["anchorKind"] == "text"
        assert c["anchor"]["range"]["charStart"] == pos.anchor.range.char_start
        assert c["anchor"]["range"]["charEnd"] == pos.anchor.range.char_end
        assert c["metadata"]["textContent"] == quote
    finally:
        await db_session_real.execute(
            text("DELETE FROM public.extraction_evidence WHERE article_id = :aid"),
            {"aid": str(article_id)},
        )
        await db_session_real.commit()
        await db_session_real.execute(
            text("DELETE FROM public.extraction_runs WHERE article_id = :aid"),
            {"aid": str(article_id)},
        )
        await db_session_real.commit()
        await _cleanup_file(db_session_real, file_id=file_id)
        await db_session_real.execute(
            text("DELETE FROM public.articles WHERE id = :id"),
            {"id": str(article_id)},
        )
        await db_session_real.commit()
