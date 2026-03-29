from unittest.mock import AsyncMock, MagicMock

import pytest

from app.repositories.article_author_repository import (
    ArticleAuthorRepository,
    normalize_author_name,
)


def test_normalize_author_name_compacts_spacing() -> None:
    assert normalize_author_name("  Jane   Doe  ") == "jane doe"


@pytest.mark.asyncio
async def test_get_or_create_returns_existing_author() -> None:
    db = AsyncMock()
    repo = ArticleAuthorRepository(db)
    existing = MagicMock()
    existing.source_hint = None
    repo.get_by_identity = AsyncMock(return_value=existing)  # type: ignore[method-assign]

    result = await repo.get_or_create("Jane Doe")
    assert result is existing
