import pytest

from app.models.article import ArticleFile, ArticleTextBlock
from tests.integration.conftest import SEED


@pytest.mark.asyncio
async def test_figure_block_type_accepted_by_check(db_session_real):
    af = ArticleFile(
        article_id=SEED.primary_article,
        project_id=SEED.primary_project,
        storage_key="t/fig.pdf",
        file_type="pdf",
        file_role="MAIN",
    )
    db_session_real.add(af)
    await db_session_real.flush()

    block = ArticleTextBlock(
        article_file_id=af.id,
        page_number=1,
        block_index=0,
        text="",
        char_start=0,
        char_end=0,
        bbox={"x": 10.0, "y": 20.0, "width": 100.0, "height": 80.0},
        block_type="figure",
    )
    db_session_real.add(block)
    await db_session_real.flush()  # CHECK would reject 'figure' before 0037
    assert block.id is not None
