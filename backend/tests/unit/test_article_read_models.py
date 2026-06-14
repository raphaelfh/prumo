"""Validation tests for ``app.schemas.read_models.article``.

Pure Pydantic v2 validation: no DB, no async, no fixtures. Covers the
from_attributes read models plus the two classmethods on
``ArticleDetailReadModel`` that compute extraction progress/status.
"""

from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.read_models.article import (
    ArticleDetailReadModel,
    ArticleFileReadModel,
    ArticleListReadModel,
)

ARTICLE_ID = uuid4()
PROJECT_ID = uuid4()
FILE_ID = uuid4()


# =================== ArticleFileReadModel ===================


class TestArticleFileReadModel:
    def test_from_attributes(self) -> None:
        attrs = SimpleNamespace(
            id=FILE_ID, file_type="pdf", storage_key="key/abc.pdf", size_bytes=1024
        )
        model = ArticleFileReadModel.model_validate(attrs)
        assert model.id == FILE_ID
        assert model.size_bytes == 1024

    def test_size_bytes_defaults_none(self) -> None:
        attrs = SimpleNamespace(id=FILE_ID, file_type="pdf", storage_key="k")
        model = ArticleFileReadModel.model_validate(attrs)
        assert model.size_bytes is None

    def test_missing_required_rejected(self) -> None:
        attrs = SimpleNamespace(id=FILE_ID, storage_key="k")
        with pytest.raises(ValidationError):
            ArticleFileReadModel.model_validate(attrs)


# =================== ArticleListReadModel ===================


def _list_attrs() -> SimpleNamespace:
    return SimpleNamespace(
        id=ARTICLE_ID,
        title="A Study",
        authors="Doe J; Smith A",
        publication_year=2020,
        project_id=PROJECT_ID,
        project_name="Review X",
        files_count=2,
        extractions_count=3,
        has_pdf=True,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 2),
    )


class TestArticleListReadModel:
    def test_from_attributes(self) -> None:
        model = ArticleListReadModel.model_validate(_list_attrs())
        assert model.title == "A Study"
        assert model.files_count == 2
        assert model.has_pdf is True

    def test_count_and_status_defaults(self) -> None:
        attrs = _list_attrs()
        del attrs.files_count
        del attrs.extractions_count
        del attrs.has_pdf
        del attrs.updated_at
        model = ArticleListReadModel.model_validate(attrs)
        assert model.files_count == 0
        assert model.extractions_count == 0
        assert model.has_pdf is False
        assert model.updated_at is None

    def test_missing_required_rejected(self) -> None:
        attrs = _list_attrs()
        del attrs.created_at
        with pytest.raises(ValidationError):
            ArticleListReadModel.model_validate(attrs)


# =================== ArticleDetailReadModel ===================


def _detail_attrs() -> SimpleNamespace:
    return SimpleNamespace(
        id=ARTICLE_ID,
        title="A Study",
        authors="Doe J",
        publication_year=2020,
        abstract=None,
        doi=None,
        journal=None,
        volume=None,
        issue=None,
        pages=None,
        project_id=PROJECT_ID,
        project_name="Review X",
        review_title=None,
        files=[],
        extractions_total=4,
        extractions_completed=2,
        models_extracted=1,
        has_pdf=True,
        extraction_progress=50.0,
        overall_status="in_progress",
        zotero_key=None,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 2),
    )


class TestArticleDetailReadModel:
    def test_from_attributes_with_nested_files(self) -> None:
        attrs = _detail_attrs()
        attrs.files = [SimpleNamespace(id=FILE_ID, file_type="pdf", storage_key="k", size_bytes=10)]
        model = ArticleDetailReadModel.model_validate(attrs)
        assert model.id == ARTICLE_ID
        assert len(model.files) == 1
        assert isinstance(model.files[0], ArticleFileReadModel)
        assert model.extraction_progress == 50.0

    def test_status_and_progress_defaults(self) -> None:
        attrs = _detail_attrs()
        del attrs.extractions_total
        del attrs.extractions_completed
        del attrs.models_extracted
        del attrs.has_pdf
        del attrs.extraction_progress
        del attrs.overall_status
        del attrs.updated_at
        model = ArticleDetailReadModel.model_validate(attrs)
        assert model.extractions_total == 0
        assert model.extractions_completed == 0
        assert model.models_extracted == 0
        assert model.has_pdf is False
        assert model.extraction_progress == 0.0
        assert model.overall_status == "pending"
        assert model.files == []
        assert model.updated_at is None

    def test_missing_required_rejected(self) -> None:
        attrs = _detail_attrs()
        del attrs.title
        with pytest.raises(ValidationError):
            ArticleDetailReadModel.model_validate(attrs)

    # --- compute_progress ---

    def test_compute_progress_zero_total_returns_zero(self) -> None:
        assert ArticleDetailReadModel.compute_progress(completed=0, total=0) == 0.0

    def test_compute_progress_half(self) -> None:
        assert ArticleDetailReadModel.compute_progress(completed=1, total=2) == 50.0

    def test_compute_progress_full(self) -> None:
        assert ArticleDetailReadModel.compute_progress(completed=4, total=4) == 100.0

    def test_compute_progress_rounds_to_one_decimal(self) -> None:
        # 1/3 -> 33.333... rounds to 33.3
        assert ArticleDetailReadModel.compute_progress(completed=1, total=3) == 33.3

    # --- compute_overall_status ---

    def test_compute_overall_status_pending_at_zero(self) -> None:
        assert ArticleDetailReadModel.compute_overall_status(0.0) == "pending"

    def test_compute_overall_status_in_progress(self) -> None:
        assert ArticleDetailReadModel.compute_overall_status(50.0) == "in_progress"

    def test_compute_overall_status_completed_at_hundred(self) -> None:
        assert ArticleDetailReadModel.compute_overall_status(100.0) == "completed"

    def test_compute_overall_status_completed_above_hundred(self) -> None:
        assert ArticleDetailReadModel.compute_overall_status(150.0) == "completed"

    def test_compute_overall_status_just_below_hundred(self) -> None:
        assert ArticleDetailReadModel.compute_overall_status(99.9) == "in_progress"
