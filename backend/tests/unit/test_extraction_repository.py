"""Unit tests for app.repositories.extraction_repository.

Pure-mock — no database hit. Tests all repository classes:
ExtractionTemplateRepository, GlobalTemplateRepository,
ExtractionEntityTypeRepository, ExtractionInstanceRepository.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionInstance,
)
from app.repositories.extraction_repository import (
    ExtractionEntityTypeRepository,
    ExtractionInstanceRepository,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PROJECT_ID = uuid.uuid4()
TEMPLATE_ID = uuid.uuid4()
ENTITY_TYPE_ID = uuid.uuid4()
INSTANCE_ID = uuid.uuid4()
ARTICLE_ID = uuid.uuid4()


def make_scalars_result(items: list) -> MagicMock:
    scalars = MagicMock()
    scalars.all.return_value = items
    result = MagicMock()
    result.scalars.return_value = scalars
    return result


def make_scalar_one_or_none(item) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = item
    return result


def make_db() -> AsyncMock:
    db = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


def make_entity_type(
    *,
    id: uuid.UUID | None = None,
    parent: uuid.UUID | None = None,
    sort_order: int = 0,
) -> MagicMock:
    et = MagicMock(spec=ExtractionEntityType)
    et.id = id or uuid.uuid4()
    et.parent_entity_type_id = parent
    et.sort_order = sort_order
    et.fields = []
    return et


def make_instance(
    *,
    id: uuid.UUID | None = None,
    article_id: uuid.UUID | None = None,
    entity_type_id: uuid.UUID | None = None,
    parent_instance_id: uuid.UUID | None = None,
) -> MagicMock:
    inst = MagicMock(spec=ExtractionInstance)
    inst.id = id or uuid.uuid4()
    inst.article_id = article_id or ARTICLE_ID
    inst.entity_type_id = entity_type_id or ENTITY_TYPE_ID
    inst.parent_instance_id = parent_instance_id
    inst.sort_order = 0
    return inst


# ---------------------------------------------------------------------------
# ExtractionTemplateRepository
# ---------------------------------------------------------------------------


class TestExtractionEntityTypeRepository:
    @pytest.mark.asyncio
    async def test_get_with_fields_returns_entity_type(self) -> None:
        db = make_db()
        et = make_entity_type()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(et))
        repo = ExtractionEntityTypeRepository(db)

        result = await repo.get_with_fields(ENTITY_TYPE_ID)

        assert result is et

    @pytest.mark.asyncio
    async def test_get_with_fields_returns_none(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = ExtractionEntityTypeRepository(db)

        result = await repo.get_with_fields(ENTITY_TYPE_ID)

        assert result is None


class TestExtractionInstanceRepository:
    @pytest.mark.asyncio
    async def test_get_by_article_returns_all(self) -> None:
        db = make_db()
        instances = [make_instance()]
        db.execute = AsyncMock(return_value=make_scalars_result(instances))
        repo = ExtractionInstanceRepository(db)

        result = await repo.get_by_article(ARTICLE_ID)

        assert result == instances

    @pytest.mark.asyncio
    async def test_get_by_article_with_entity_type_filter(self) -> None:
        db = make_db()
        inst = make_instance(entity_type_id=ENTITY_TYPE_ID)
        db.execute = AsyncMock(return_value=make_scalars_result([inst]))
        repo = ExtractionInstanceRepository(db)

        result = await repo.get_by_article(ARTICLE_ID, entity_type_id=ENTITY_TYPE_ID)

        assert result == [inst]

    @pytest.mark.asyncio
    async def test_get_by_article_accepts_string_ids(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = ExtractionInstanceRepository(db)

        result = await repo.get_by_article(str(ARTICLE_ID))

        assert result == []

    @pytest.mark.asyncio
    async def test_get_by_article_with_string_entity_type_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = ExtractionInstanceRepository(db)

        result = await repo.get_by_article(ARTICLE_ID, entity_type_id=str(ENTITY_TYPE_ID))

        assert result == []
