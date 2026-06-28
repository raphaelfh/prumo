import pytest
from sqlalchemy import select

from app.models.article import ArticleFile, ArticleTextBlock
from tests.integration.conftest import SEED


@pytest.mark.asyncio
async def test_article_text_block_persists_cell_grid(db_session_real):
    af = ArticleFile(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        storage_key="t/cellgrid.pdf",
        file_type="pdf",
        file_role="MAIN",
    )
    db_session_real.add(af)
    await db_session_real.flush()

    block = ArticleTextBlock(
        article_file_id=af.id,
        page_number=1,
        block_index=0,
        text="11.8",
        char_start=0,
        char_end=4,
        bbox={"x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0},
        block_type="table_cell",
        row_index=1,
        col_index=2,
        row_span=1,
        col_span=1,
        is_header=False,
    )
    db_session_real.add(block)
    await db_session_real.flush()

    got = (
        await db_session_real.execute(
            select(ArticleTextBlock).where(ArticleTextBlock.id == block.id)
        )
    ).scalar_one()
    assert (got.row_index, got.col_index, got.row_span, got.col_span, got.is_header) == (
        1,
        2,
        1,
        1,
        False,
    )
