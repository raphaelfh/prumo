"""Integration tests for DocumentParsingService.

Tests:
- Success path: downloads bytes, runs parser, persists blocks (exact fields),
  sets extraction_status to 'parsed', returns correct DocumentParsingResult.
- Failure path: parser raises -> extraction_status becomes 'parse_failed',
  exception propagates.

Uses db_session_real (deferred triggers). Fakes a StorageAdapter and a
DocumentParser — the storage fake returns dummy bytes; the parser fake
returns a fixed list of ParsedBlock spanning >=2 pages.
"""

from __future__ import annotations

import uuid
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.parsing.base import DocumentParser, ParsedBlock, concat_page_text
from app.infrastructure.storage.base import StorageAdapter
from app.models.article import ArticleFile
from app.models.extraction import ExtractionEvidence
from app.models.extraction_workflow import ExtractionReviewerDecision
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from app.services.document_parsing_service import DocumentParsingResult, DocumentParsingService
from app.services.evidence_anchor_service import build_anchor
from tests.integration.conftest import SEED, make_ai_proposal, make_proposal
from tests.integration.helpers.ai_extraction import run_in_extract

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeStorageAdapter(StorageAdapter):
    """Minimal StorageAdapter that returns a fixed bytes payload."""

    def __init__(self, payload: bytes = b"%PDF-1.4 fake") -> None:
        self._payload = payload
        self.downloaded: list[tuple[str, str]] = []

    async def download(self, bucket: str, path: str) -> bytes:
        self.downloaded.append((bucket, path))
        return self._payload

    # --- unused abstract methods ---
    async def upload(
        self, bucket: str, path: str, data: bytes, content_type: str = "application/octet-stream"
    ) -> str:
        raise NotImplementedError

    async def delete(self, bucket: str, path: str) -> bool:
        raise NotImplementedError

    async def exists(self, bucket: str, path: str) -> bool:
        raise NotImplementedError

    async def get_public_url(self, bucket: str, path: str) -> str:
        raise NotImplementedError

    async def get_signed_url(self, bucket: str, path: str, expires_in: int = 3600) -> str:
        raise NotImplementedError


class FakeParser(DocumentParser):
    """Returns a fixed list of 3 ParsedBlock objects spanning 2 pages.

    Offsets are intentionally left as 0 so the service's
    assign_char_offsets_to_blocks call is what sets correct values.
    """

    FIXED_BLOCKS: list[ParsedBlock] = [
        ParsedBlock(
            page_number=1,
            block_index=0,
            text="Hello world",
            char_start=0,
            char_end=0,  # service must normalise
            bbox={"x": 0.0, "y": 0.0, "width": 100.0, "height": 12.0},
            block_type="paragraph",
        ),
        ParsedBlock(
            page_number=1,
            block_index=1,
            text="Second block",
            char_start=0,
            char_end=0,
            bbox={"x": 0.0, "y": 20.0, "width": 100.0, "height": 12.0},
            block_type="heading",
        ),
        ParsedBlock(
            page_number=2,
            block_index=0,
            text="Page two content",
            char_start=0,
            char_end=0,
            bbox={"x": 0.0, "y": 0.0, "width": 100.0, "height": 12.0},
            block_type="paragraph",
        ),
    ]

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:  # noqa: ARG002
        # Return fresh copies so tests don't mutate the class-level defaults.
        import copy

        return copy.deepcopy(self.FIXED_BLOCKS)


class ZeroWidthParser(DocumentParser):
    """Returns blocks carrying zero-width characters, one of them nothing else."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:  # noqa: ARG002
        def block(page: int, idx: int, text: str) -> ParsedBlock:
            return ParsedBlock(
                page_number=page,
                block_index=idx,
                text=text,
                char_start=0,
                char_end=0,
                bbox={"x": 0.0, "y": float(idx * 20), "width": 100.0, "height": 12.0},
                block_type="paragraph",
            )

        return [
            block(1, 0, "doi:10.1000/\u200bxyz"),
            block(1, 1, "\u200b"),
            block(1, 2, "Age ...... 54 years\u200b"),
            block(2, 0, "\ufeffPage two"),
        ]


class BrokenParser(DocumentParser):
    """Always raises ValueError to test the failure path."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:  # noqa: ARG002
        raise ValueError("Simulated parser failure")


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


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
            "key": f"articles/{file_id}.pdf",
        },
    )
    await db.commit()
    return file_id


async def _cleanup(db: AsyncSession, *, file_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.article_files WHERE id = :id"),
        {"id": str(file_id)},
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_parse_article_file_success(
    db_session_real: AsyncSession,
) -> None:
    """Service downloads bytes, persists blocks, sets status='parsed', returns correct result."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        storage = FakeStorageAdapter()
        parser = FakeParser()
        service = DocumentParsingService(
            db=db_session_real,
            user_id=str(SEED.primary_profile),
            storage=storage,
            parser=parser,
            trace_id="test-trace-1",
        )

        result = await service.parse_article_file(file_id)
        await db_session_real.commit()

        # --- storage was called with the right bucket + key ---
        assert len(storage.downloaded) == 1
        bucket, path = storage.downloaded[0]
        assert bucket == "articles"
        assert path.endswith(".pdf")

        # --- result shape ---
        assert isinstance(result, DocumentParsingResult)
        assert result.block_count == 3
        assert result.page_count == 2  # pages 1 and 2
        assert result.status == "parsed"

        # --- blocks persisted in reading order ---
        repo = ArticleTextBlockRepository(db_session_real)
        blocks = await repo.list_ordered_for_file(file_id)
        assert len(blocks) == 3

        b0 = blocks[0]
        assert b0.page_number == 1
        assert b0.block_index == 0
        assert b0.text == "Hello world"
        # char offsets must be normalised by assign_char_offsets_to_blocks
        assert b0.char_start == 0
        assert b0.char_end == len("Hello world")

        b1 = blocks[1]
        assert b1.page_number == 1
        assert b1.block_index == 1
        assert b1.text == "Second block"
        # offset: len("Hello world") + 1 separator
        assert b1.char_start == len("Hello world") + 1
        assert b1.char_end == len("Hello world") + 1 + len("Second block")

        b2 = blocks[2]
        assert b2.page_number == 2
        assert b2.block_index == 0
        assert b2.text == "Page two content"
        # page 2 starts its own cursor at 0
        assert b2.char_start == 0
        assert b2.char_end == len("Page two content")

        # --- extraction_status flipped ---
        article_file = (
            await db_session_real.execute(select(ArticleFile).where(ArticleFile.id == file_id))
        ).scalar_one()
        assert article_file.extraction_status == "parsed"

    finally:
        await _cleanup(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_parse_article_file_parser_error_sets_parse_failed_and_reraises(
    db_session_real: AsyncSession,
) -> None:
    """When the parser raises, extraction_status becomes 'parse_failed' and the exception propagates."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        storage = FakeStorageAdapter()
        parser = BrokenParser()
        service = DocumentParsingService(
            db=db_session_real,
            user_id=str(SEED.primary_profile),
            storage=storage,
            parser=parser,
            trace_id="test-trace-2",
        )

        with pytest.raises(ValueError, match="Simulated parser failure"):
            await service.parse_article_file(file_id)

        # Flush happened inside the service; check the status in the same session.
        # (No commit; we are checking the in-flight flushed state.)
        article_file = (
            await db_session_real.execute(select(ArticleFile).where(ArticleFile.id == file_id))
        ).scalar_one()
        assert article_file.extraction_status == "parse_failed"

        # Commit what the service flushed so cleanup can see it.
        await db_session_real.commit()
    finally:
        await _cleanup(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_parse_persists_content_markdown_and_bumps_version(
    db_session_real: AsyncSession,
) -> None:
    """After a successful parse, content_markdown == render_blocks_to_markdown(blocks)
    and content_version is incremented by one, in the same transaction as the blocks."""
    from app.infrastructure.parsing.base import render_blocks_to_markdown

    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        storage = FakeStorageAdapter()
        parser = FakeParser()
        service = DocumentParsingService(
            db=db_session_real,
            user_id=str(SEED.primary_profile),
            storage=storage,
            parser=parser,
            trace_id="test-trace-md",
        )

        article_file = (
            await db_session_real.execute(select(ArticleFile).where(ArticleFile.id == file_id))
        ).scalar_one()
        before = article_file.content_version

        await service.parse_article_file(file_id)
        await db_session_real.refresh(article_file)

        expected_md = render_blocks_to_markdown(FakeParser.FIXED_BLOCKS)
        assert article_file.content_markdown == expected_md
        assert article_file.content_version == before + 1

        await db_session_real.commit()
    finally:
        await _cleanup(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_blocks_normalized_before_offsets(
    db_session_real: AsyncSession,
) -> None:
    """Every parser's blocks are normalized before offsets: no U+200B is stored and
    each stored block's offsets index its own text in the concatenated page."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        service = DocumentParsingService(
            db=db_session_real,
            user_id=str(SEED.primary_profile),
            storage=FakeStorageAdapter(),
            parser=ZeroWidthParser(),
            trace_id="test-trace-normalize",
        )
        result = await service.parse_article_file(file_id)
        await db_session_real.commit()

        stored = await ArticleTextBlockRepository(db_session_real).list_ordered_for_file(file_id)
        assert result.block_count == 3
        assert [(b.page_number, b.block_index, b.text) for b in stored] == [
            (1, 0, "doi:10.1000/xyz"),
            (1, 1, "Age 54 years"),
            (2, 0, "Page two"),
        ]
        assert not any("\u200b" in b.text or "\ufeff" in b.text for b in stored)
        pages = concat_page_text(stored)  # type: ignore[arg-type]
        for b in stored:
            assert pages[b.page_number][b.char_start : b.char_end] == b.text
    finally:
        await _cleanup(db_session_real, file_id=file_id)


# ---------------------------------------------------------------------------
# Reparse re-anchoring (evidence follows the new blocks or reads stale)
# ---------------------------------------------------------------------------

QUOTE = "The trial enrolled 142 participants."
INTRO = "Introduction to the trial."
OTHER = "Methods are described below."

#: First parse: the quote on page 1. Shifted: the quote moves to page 2.
#: Removed: the quote is gone.
LAYOUT_V1 = [(1, INTRO), (1, QUOTE), (2, OTHER)]
LAYOUT_SHIFTED = [(1, INTRO), (2, OTHER), (2, QUOTE)]
LAYOUT_REMOVED = [(1, INTRO), (2, OTHER)]


class ScriptedParser(DocumentParser):
    """Answers each parse with the next ``(page, text)`` layout."""

    def __init__(self, *layouts: list[tuple[int, str]]) -> None:
        self._layouts = list(layouts)

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:  # noqa: ARG002
        layout = self._layouts.pop(0)
        per_page: dict[int, int] = {}
        blocks = []
        for page, body in layout:
            index = per_page.get(page, 0)
            per_page[page] = index + 1
            blocks.append(
                ParsedBlock(
                    page_number=page,
                    block_index=index,
                    text=body,
                    char_start=0,
                    char_end=0,
                    bbox={"x": 0.0, "y": float(index * 20), "width": 100.0, "height": 12.0},
                    block_type="paragraph",
                )
            )
        return blocks


async def _parsed_file(
    db: AsyncSession, parser: ScriptedParser
) -> tuple[UUID, DocumentParsingService]:
    """A file parsed once with ``parser``'s first layout (content_version 1)."""
    file_id = await _insert_article_file(
        db, project_id=SEED.primary_project, article_id=SEED.primary_article
    )
    service = DocumentParsingService(
        db=db,
        user_id=str(SEED.primary_profile),
        storage=FakeStorageAdapter(),
        parser=parser,
        trace_id="test-trace-reanchor",
    )
    await service.parse_article_file(file_id)
    return file_id, service


async def _add_evidence(
    db: AsyncSession,
    *,
    run_id: UUID,
    file_id: UUID,
    text_content: str = QUOTE,
    grounded: bool = True,
    content_version: int | None = 1,
    proposal_record_id: UUID | None = None,
    reviewer_decision_id: UUID | None = None,
    stored_quote: str | None = None,
) -> UUID:
    """One evidence row anchored against the file's CURRENT blocks."""
    position: dict = {}
    page: int | None = None
    if grounded:
        blocks = await ArticleTextBlockRepository(db).list_ordered_for_file(file_id)
        pos = build_anchor(text_content, blocks)
        assert pos is not None
        position = pos.model_dump(by_alias=True, mode="json")
        if stored_quote is not None:
            position["anchor"]["quote"] = stored_quote
        page = pos.anchor.range.page  # type: ignore[union-attr]
    row = ExtractionEvidence(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        article_file_id=file_id,
        run_id=run_id,
        proposal_record_id=proposal_record_id,
        reviewer_decision_id=reviewer_decision_id,
        page_number=page,
        text_content=text_content,
        position=position,
        content_version=content_version,
        rank=0,
        created_by=SEED.primary_profile,
    )
    db.add(row)
    await db.flush()
    return row.id


async def _ai_record(db: AsyncSession) -> tuple[UUID, UUID]:
    run = await run_in_extract(db)
    record = await make_ai_proposal(
        db, run_id=run.id, instance_id=SEED.primary_instance, field_id=SEED.primary_field
    )
    return run.id, record


async def _row(db: AsyncSession, evidence_id: UUID) -> dict:
    return dict(
        (
            await db.execute(
                text(
                    "SELECT article_file_id, page_number, position, content_version,"
                    " text_content, attribution_label, rank, proposal_record_id,"
                    " reviewer_decision_id FROM public.extraction_evidence WHERE id = :id"
                ),
                {"id": evidence_id},
            )
        )
        .mappings()
        .one()
    )


async def _file_version(db: AsyncSession, file_id: UUID) -> int:
    return (
        await db.execute(
            text("SELECT content_version FROM public.article_files WHERE id = :id"),
            {"id": file_id},
        )
    ).scalar_one()


async def test_reparse_reanchors_shifted_blocks(db_session: AsyncSession) -> None:
    file_id, service = await _parsed_file(db_session, ScriptedParser(LAYOUT_V1, LAYOUT_SHIFTED))
    run_id, record = await _ai_record(db_session)
    evidence_id = await _add_evidence(
        db_session,
        run_id=run_id,
        file_id=file_id,
        proposal_record_id=record,
        stored_quote="the quote as the model recorded it",
    )
    before = await _row(db_session, evidence_id)
    assert before["page_number"] == 1

    await service.parse_article_file(file_id)

    after = await _row(db_session, evidence_id)
    assert await _file_version(db_session, file_id) == 2
    assert after["page_number"] == 2
    assert after["position"]["anchor"]["range"] == {
        "page": 2,
        "charStart": len(OTHER) + 1,
        "charEnd": len(OTHER) + 1 + len(QUOTE),
    }
    assert after["content_version"] == 2
    # The quote is history: neither the text nor the anchor quote moves.
    assert after["text_content"] == before["text_content"] == QUOTE
    assert after["position"]["anchor"]["quote"] == "the quote as the model recorded it"


async def test_reparse_with_removed_text_leaves_evidence_stale(db_session: AsyncSession) -> None:
    file_id, service = await _parsed_file(db_session, ScriptedParser(LAYOUT_V1, LAYOUT_REMOVED))
    run_id, record = await _ai_record(db_session)
    evidence_id = await _add_evidence(
        db_session, run_id=run_id, file_id=file_id, proposal_record_id=record
    )
    before = await _row(db_session, evidence_id)

    await service.parse_article_file(file_id)

    after = await _row(db_session, evidence_id)
    assert await _file_version(db_session, file_id) == 2
    assert after == before
    assert after["content_version"] == 1


async def test_reparse_reanchors_unversioned_legacy_rows(db_session: AsyncSession) -> None:
    file_id, service = await _parsed_file(db_session, ScriptedParser(LAYOUT_V1, LAYOUT_SHIFTED))
    run_id, record = await _ai_record(db_session)
    evidence_id = await _add_evidence(
        db_session, run_id=run_id, file_id=file_id, proposal_record_id=record, content_version=None
    )

    await service.parse_article_file(file_id)

    after = await _row(db_session, evidence_id)
    assert (after["page_number"], after["content_version"]) == (2, 2)
    assert after["position"]["anchor"]["range"]["page"] == 2


async def test_failed_reanchor_of_unversioned_row_reads_stale(db_session: AsyncSession) -> None:
    file_id, service = await _parsed_file(db_session, ScriptedParser(LAYOUT_V1, LAYOUT_REMOVED))
    run_id, record = await _ai_record(db_session)
    evidence_id = await _add_evidence(
        db_session, run_id=run_id, file_id=file_id, proposal_record_id=record, content_version=None
    )
    before = await _row(db_session, evidence_id)

    await service.parse_article_file(file_id)

    after = await _row(db_session, evidence_id)
    assert after["content_version"] == 1
    assert await _file_version(db_session, file_id) == 2
    assert {k: v for k, v in after.items() if k != "content_version"} == {
        k: v for k, v in before.items() if k != "content_version"
    }


async def test_other_files_evidence_untouched(db_session: AsyncSession) -> None:
    file_id, service = await _parsed_file(db_session, ScriptedParser(LAYOUT_V1, LAYOUT_SHIFTED))
    other_file, _ = await _parsed_file(db_session, ScriptedParser(LAYOUT_V1))
    run_id, record = await _ai_record(db_session)
    foreign = await _add_evidence(
        db_session, run_id=run_id, file_id=other_file, proposal_record_id=record
    )
    ungrounded = await _add_evidence(
        db_session, run_id=run_id, file_id=file_id, proposal_record_id=record, grounded=False
    )
    before = {i: await _row(db_session, i) for i in (foreign, ungrounded)}
    assert before[ungrounded]["position"] == {}

    await service.parse_article_file(file_id)

    assert {i: await _row(db_session, i) for i in (foreign, ungrounded)} == before


async def test_human_and_decision_evidence_does_not_follow_reparse(
    db_session: AsyncSession,
) -> None:
    file_id, service = await _parsed_file(db_session, ScriptedParser(LAYOUT_V1, LAYOUT_SHIFTED))
    run = await run_in_extract(db_session)
    human = await make_proposal(
        db_session,
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        user_id=SEED.primary_profile,
    )
    decision = ExtractionReviewerDecision(
        run_id=run.id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.primary_profile,
        decision="edit",
        value={"value": 142},
    )
    db_session.add(decision)
    await db_session.flush()
    on_human = await _add_evidence(
        db_session, run_id=run.id, file_id=file_id, proposal_record_id=human
    )
    on_decision = await _add_evidence(
        db_session, run_id=run.id, file_id=file_id, reviewer_decision_id=decision.id
    )
    before = {i: await _row(db_session, i) for i in (on_human, on_decision)}
    assert all(r["page_number"] == 1 for r in before.values())

    await service.parse_article_file(file_id)

    assert await _file_version(db_session, file_id) == 2
    assert {i: await _row(db_session, i) for i in (on_human, on_decision)} == before


async def test_malformed_position_is_skipped(db_session: AsyncSession) -> None:
    """A stored position that is not a valid v1 anchor is left alone."""
    file_id, service = await _parsed_file(db_session, ScriptedParser(LAYOUT_V1, LAYOUT_SHIFTED))
    run_id, record = await _ai_record(db_session)
    evidence_id = await _add_evidence(
        db_session, run_id=run_id, file_id=file_id, proposal_record_id=record, grounded=False
    )
    await db_session.execute(
        text(
            "UPDATE public.extraction_evidence"
            " SET position = CAST(:p AS jsonb), page_number = 1 WHERE id = :id"
        ),
        {"p": '{"version": 1, "anchor": {"kind": "bogus"}}', "id": evidence_id},
    )
    before = await _row(db_session, evidence_id)

    await service.parse_article_file(file_id)

    assert await _file_version(db_session, file_id) == 2
    assert await _row(db_session, evidence_id) == before
