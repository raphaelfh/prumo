"""Integration test: ArticleTextBlockRepository persists native cell-grid fields.

Verifies that replace_for_file maps ParsedBlock.row_index / col_index /
row_span / col_span / is_header through to the ArticleTextBlock rows it writes.
"""

import pytest

from app.infrastructure.parsing.base import ParsedBlock
from app.models.article import ArticleFile
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from tests.integration.conftest import SEED


@pytest.mark.asyncio
async def test_replace_for_file_persists_cell_grid(db_session_real):
    af = ArticleFile(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        storage_key="t/repo-cellgrid.pdf",
        file_type="pdf",
        file_role="MAIN",
    )
    db_session_real.add(af)
    await db_session_real.flush()

    blocks = [
        ParsedBlock(
            page_number=1,
            block_index=0,
            text="Header",
            char_start=0,
            char_end=6,
            bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
            block_type="table_cell",
            row_index=0,
            col_index=0,
            row_span=1,
            col_span=1,
            is_header=True,
        ),
        ParsedBlock(
            page_number=1,
            block_index=1,
            text="11.8",
            char_start=7,
            char_end=11,
            bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
            block_type="table_cell",
            row_index=1,
            col_index=0,
            row_span=1,
            col_span=1,
            is_header=False,
        ),
    ]
    repo = ArticleTextBlockRepository(db_session_real)
    rows = await repo.replace_for_file(af.id, blocks)

    by_idx = {r.block_index: r for r in rows}
    assert by_idx[0].is_header is True and by_idx[0].row_index == 0
    assert by_idx[1].is_header is False and by_idx[1].row_index == 1 and by_idx[1].col_index == 0
