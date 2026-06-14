"""Validation tests for ``app.schemas.read_models.project``.

Pure Pydantic-v2 validation: no DB, no async, no fixtures. Covers
``from_attributes`` construction, documented defaults, nested member
lists, and the two ``compute_*`` classmethods.
"""

import types
from datetime import UTC, datetime
from uuid import uuid4

from app.schemas.read_models.project import (
    ProjectDetailReadModel,
    ProjectListReadModel,
    ProjectMemberReadModel,
)

NOW = datetime(2026, 6, 13, tzinfo=UTC)


# =================== ProjectMemberReadModel ===================


class TestProjectMemberReadModel:
    def test_from_attributes(self) -> None:
        attrs = types.SimpleNamespace(
            user_id=uuid4(),
            role="reviewer",
            user_name="Alice",
            user_email="a@b.com",
            joined_at=NOW,
        )
        m = ProjectMemberReadModel.model_validate(attrs)
        assert m.user_id == attrs.user_id
        assert m.role == "reviewer"
        assert m.user_name == "Alice"
        assert m.user_email == "a@b.com"
        assert m.joined_at == NOW

    def test_optional_fields_default_none(self) -> None:
        m = ProjectMemberReadModel(user_id=uuid4(), role="viewer")
        assert m.user_name is None
        assert m.user_email is None
        assert m.joined_at is None


# =================== ProjectListReadModel ===================


def _list_attrs(**overrides: object) -> types.SimpleNamespace:
    base = {
        "id": uuid4(),
        "name": "Proj",
        "review_title": None,
        "description": None,
        "status": "active",
        "org_id": uuid4(),
        "org_name": "Org",
        "articles_count": 10,
        "members_count": 3,
        "instruments_count": 1,
        "templates_count": 2,
        "articles_completed": 4,
        "completion_percentage": 40.0,
        "created_at": NOW,
        "updated_at": NOW,
    }
    base.update(overrides)
    return types.SimpleNamespace(**base)


class TestProjectListReadModel:
    def test_from_attributes(self) -> None:
        attrs = _list_attrs()
        model = ProjectListReadModel.model_validate(attrs)
        assert model.id == attrs.id
        assert model.name == "Proj"
        assert model.org_name == "Org"
        assert model.articles_count == 10
        assert model.completion_percentage == 40.0

    def test_defaults(self) -> None:
        model = ProjectListReadModel(
            id=uuid4(),
            name="Proj",
            org_id=uuid4(),
            created_at=NOW,
        )
        assert model.status == "active"
        assert model.org_name is None
        assert model.articles_count == 0
        assert model.members_count == 0
        assert model.instruments_count == 0
        assert model.templates_count == 0
        assert model.articles_completed == 0
        assert model.completion_percentage == 0.0
        assert model.review_title is None
        assert model.updated_at is None

    def test_compute_completion_zero_total(self) -> None:
        # guards against ZeroDivisionError
        assert ProjectListReadModel.compute_completion(0, 0) == 0.0

    def test_compute_completion_partial(self) -> None:
        assert ProjectListReadModel.compute_completion(1, 3) == 33.3

    def test_compute_completion_full(self) -> None:
        assert ProjectListReadModel.compute_completion(5, 5) == 100.0

    def test_compute_completion_rounds_to_one_decimal(self) -> None:
        # 2/3 = 66.666... -> rounded to 1 decimal place
        assert ProjectListReadModel.compute_completion(2, 3) == 66.7


# =================== ProjectDetailReadModel ===================


def _detail_attrs(**overrides: object) -> types.SimpleNamespace:
    base = {
        "id": uuid4(),
        "name": "Proj",
        "review_title": "Title",
        "description": "Desc",
        "condition_studied": "Cond",
        "eligibility_criteria": "crit",
        "study_design": "design",
        "status": "active",
        "org_id": uuid4(),
        "org_name": "Org",
        "created_by_id": uuid4(),
        "created_by_name": "Alice",
        "members": [
            types.SimpleNamespace(
                user_id=uuid4(),
                role="manager",
                user_name="Alice",
                user_email="a@b.com",
                joined_at=NOW,
            )
        ],
        "articles_total": 10,
        "articles_pending": 2,
        "articles_in_progress": 3,
        "articles_completed": 5,
        "extractions_total": 8,
        "extractions_completed": 4,
        "models_extracted": 1,
        "extraction_progress": 50.0,
        "overall_progress": 50.0,
        "default_instrument_id": uuid4(),
        "default_template_id": uuid4(),
        "created_at": NOW,
        "updated_at": NOW,
    }
    base.update(overrides)
    return types.SimpleNamespace(**base)


class TestProjectDetailReadModel:
    def test_from_attributes_with_nested_members(self) -> None:
        attrs = _detail_attrs()
        model = ProjectDetailReadModel.model_validate(attrs)
        assert model.id == attrs.id
        assert model.review_title == "Title"
        assert model.condition_studied == "Cond"
        assert model.articles_total == 10
        assert model.extraction_progress == 50.0
        assert len(model.members) == 1
        assert isinstance(model.members[0], ProjectMemberReadModel)
        assert model.members[0].role == "manager"

    def test_defaults(self) -> None:
        model = ProjectDetailReadModel(
            id=uuid4(),
            name="Proj",
            org_id=uuid4(),
            created_at=NOW,
        )
        assert model.status == "active"
        assert model.members == []
        assert model.articles_total == 0
        assert model.articles_pending == 0
        assert model.articles_in_progress == 0
        assert model.articles_completed == 0
        assert model.extractions_total == 0
        assert model.extractions_completed == 0
        assert model.models_extracted == 0
        assert model.extraction_progress == 0.0
        assert model.overall_progress == 0.0
        assert model.created_by_id is None
        assert model.default_instrument_id is None
        assert model.default_template_id is None
        assert model.updated_at is None

    def test_compute_overall_progress_rounds_to_one_decimal(self) -> None:
        assert ProjectDetailReadModel.compute_overall_progress(66.666) == 66.7

    def test_compute_overall_progress_passthrough(self) -> None:
        assert ProjectDetailReadModel.compute_overall_progress(50.0) == 50.0

    def test_compute_overall_progress_zero(self) -> None:
        assert ProjectDetailReadModel.compute_overall_progress(0.0) == 0.0
