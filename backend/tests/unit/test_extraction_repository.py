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
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
)
from app.repositories.extraction_repository import (
    ExtractionEntityTypeRepository,
    ExtractionInstanceRepository,
    ExtractionTemplateRepository,
    GlobalTemplateRepository,
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
    role: str = "study_section",
    parent: uuid.UUID | None = None,
    sort_order: int = 0,
) -> MagicMock:
    et = MagicMock(spec=ExtractionEntityType)
    et.id = id or uuid.uuid4()
    et.role = role
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
    inst.values = []
    return inst


# ---------------------------------------------------------------------------
# ExtractionTemplateRepository
# ---------------------------------------------------------------------------


class TestExtractionTemplateRepository:
    @pytest.mark.asyncio
    async def test_get_by_project_returns_templates(self) -> None:
        db = make_db()
        templates = [MagicMock(spec=ProjectExtractionTemplate)]
        db.execute = AsyncMock(return_value=make_scalars_result(templates))
        repo = ExtractionTemplateRepository(db)

        result = await repo.get_by_project(PROJECT_ID)

        assert result == templates

    @pytest.mark.asyncio
    async def test_get_by_project_accepts_string_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = ExtractionTemplateRepository(db)

        result = await repo.get_by_project(str(PROJECT_ID))

        assert result == []

    @pytest.mark.asyncio
    async def test_get_with_entity_types_returns_template(self) -> None:
        db = make_db()
        tmpl = MagicMock(spec=ProjectExtractionTemplate)
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(tmpl))
        repo = ExtractionTemplateRepository(db)

        result = await repo.get_with_entity_types(TEMPLATE_ID)

        assert result is tmpl

    @pytest.mark.asyncio
    async def test_get_with_entity_types_returns_none(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = ExtractionTemplateRepository(db)

        result = await repo.get_with_entity_types(TEMPLATE_ID)

        assert result is None

    @pytest.mark.asyncio
    async def test_get_with_entity_types_accepts_string_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = ExtractionTemplateRepository(db)

        result = await repo.get_with_entity_types(str(TEMPLATE_ID))

        assert result is None


# ---------------------------------------------------------------------------
# GlobalTemplateRepository
# ---------------------------------------------------------------------------


class TestGlobalTemplateRepository:
    # NOTE: ExtractionTemplateGlobal.is_active does not exist on the ORM model.
    # GlobalTemplateRepository.get_active() references this missing column, which
    # makes the WHERE clause raise AttributeError at query-build time.
    # Bug documented in DONE_WITH_CONCERNS. Tests are xfail to capture intent.

    @pytest.mark.xfail(
        reason=(
            "BUG: ExtractionTemplateGlobal has no is_active column; "
            "get_active() raises AttributeError — see DONE_WITH_CONCERNS"
        ),
        strict=True,
    )
    @pytest.mark.asyncio
    async def test_get_active_returns_active_templates(self) -> None:
        db = make_db()
        tmpl = MagicMock(spec=ExtractionTemplateGlobal)
        db.execute = AsyncMock(return_value=make_scalars_result([tmpl]))
        repo = GlobalTemplateRepository(db)
        result = await repo.get_active()
        assert result == [tmpl]

    @pytest.mark.xfail(
        reason=(
            "BUG: ExtractionTemplateGlobal has no is_active column; "
            "get_active() raises AttributeError — see DONE_WITH_CONCERNS"
        ),
        strict=True,
    )
    @pytest.mark.asyncio
    async def test_get_active_returns_empty_when_none(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = GlobalTemplateRepository(db)
        result = await repo.get_active()
        assert result == []


# ---------------------------------------------------------------------------
# ExtractionEntityTypeRepository
# ---------------------------------------------------------------------------


class TestExtractionEntityTypeRepository:
    @pytest.mark.asyncio
    async def test_get_by_template_project(self) -> None:
        db = make_db()
        types = [make_entity_type()]
        db.execute = AsyncMock(return_value=make_scalars_result(types))
        repo = ExtractionEntityTypeRepository(db)

        result = await repo.get_by_template(TEMPLATE_ID, is_project_template=True)

        assert result == types

    @pytest.mark.asyncio
    async def test_get_by_template_global(self) -> None:
        db = make_db()
        types = [make_entity_type()]
        db.execute = AsyncMock(return_value=make_scalars_result(types))
        repo = ExtractionEntityTypeRepository(db)

        result = await repo.get_by_template(TEMPLATE_ID, is_project_template=False)

        assert result == types

    @pytest.mark.asyncio
    async def test_get_by_template_accepts_string_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = ExtractionEntityTypeRepository(db)

        result = await repo.get_by_template(str(TEMPLATE_ID))

        assert result == []

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

    @pytest.mark.asyncio
    async def test_get_by_role_project_template(self) -> None:
        db = make_db()
        et = make_entity_type(role="model_container")
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(et))
        repo = ExtractionEntityTypeRepository(db)

        result = await repo.get_by_role("model_container", TEMPLATE_ID)

        assert result is et

    @pytest.mark.asyncio
    async def test_get_by_role_global_template(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = ExtractionEntityTypeRepository(db)

        result = await repo.get_by_role("study_section", TEMPLATE_ID, is_project_template=False)

        assert result is None

    @pytest.mark.asyncio
    async def test_get_by_role_accepts_string_template_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = ExtractionEntityTypeRepository(db)

        result = await repo.get_by_role("model_container", str(TEMPLATE_ID))

        assert result is None

    @pytest.mark.asyncio
    async def test_get_children_without_cardinality(self) -> None:
        db = make_db()
        children = [make_entity_type(), make_entity_type()]
        db.execute = AsyncMock(return_value=make_scalars_result(children))
        repo = ExtractionEntityTypeRepository(db)

        result = await repo.get_children(ENTITY_TYPE_ID)

        assert result == children

    @pytest.mark.asyncio
    async def test_get_children_with_cardinality_filter(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = ExtractionEntityTypeRepository(db)

        result = await repo.get_children(ENTITY_TYPE_ID, cardinality="many")

        assert result == []

    @pytest.mark.asyncio
    async def test_get_children_accepts_string_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = ExtractionEntityTypeRepository(db)

        result = await repo.get_children(str(ENTITY_TYPE_ID))

        assert result == []


# ---------------------------------------------------------------------------
# ExtractionInstanceRepository
# ---------------------------------------------------------------------------


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

    @pytest.mark.asyncio
    async def test_get_children_returns_list(self) -> None:
        db = make_db()
        children = [make_instance(), make_instance()]
        db.execute = AsyncMock(return_value=make_scalars_result(children))
        repo = ExtractionInstanceRepository(db)

        result = await repo.get_children(INSTANCE_ID)

        assert result == children

    @pytest.mark.asyncio
    async def test_get_children_accepts_string_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalars_result([]))
        repo = ExtractionInstanceRepository(db)

        result = await repo.get_children(str(INSTANCE_ID))

        assert result == []

    # NOTE: ExtractionInstance.values relationship does not exist on the ORM model.
    # ExtractionInstanceRepository.get_with_values() calls selectinload(ExtractionInstance.values)
    # which raises AttributeError at query-build time. Bug documented in DONE_WITH_CONCERNS.

    @pytest.mark.xfail(
        reason=(
            "BUG: ExtractionInstance has no 'values' relationship; "
            "get_with_values() raises AttributeError — see DONE_WITH_CONCERNS"
        ),
        strict=True,
    )
    @pytest.mark.asyncio
    async def test_get_with_values_returns_instance(self) -> None:
        db = make_db()
        inst = make_instance()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(inst))
        repo = ExtractionInstanceRepository(db)
        result = await repo.get_with_values(INSTANCE_ID)
        assert result is inst

    @pytest.mark.xfail(
        reason=(
            "BUG: ExtractionInstance has no 'values' relationship; "
            "get_with_values() raises AttributeError — see DONE_WITH_CONCERNS"
        ),
        strict=True,
    )
    @pytest.mark.asyncio
    async def test_get_with_values_returns_none(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = ExtractionInstanceRepository(db)
        result = await repo.get_with_values(INSTANCE_ID)
        assert result is None

    @pytest.mark.xfail(
        reason=(
            "BUG: ExtractionInstance has no 'values' relationship; "
            "get_with_values() raises AttributeError — see DONE_WITH_CONCERNS"
        ),
        strict=True,
    )
    @pytest.mark.asyncio
    async def test_get_with_values_accepts_string_id(self) -> None:
        db = make_db()
        db.execute = AsyncMock(return_value=make_scalar_one_or_none(None))
        repo = ExtractionInstanceRepository(db)
        result = await repo.get_with_values(str(INSTANCE_ID))
        assert result is None
