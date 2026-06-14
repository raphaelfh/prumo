"""Validation tests for ``app.schemas.article``.

Pure Pydantic v2 validation: no DB, no async, no fixtures. These pin
numeric bounds, Literal members, and the camelCase wire shape — the
alias drift class that has caused production incidents in this repo.
"""

from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.article import (
    ArticleCreate,
    ArticleFileCreate,
    ArticleFileResponse,
    ArticleListItem,
    ArticleListResponse,
    ArticleResponse,
    ArticleSearchRequest,
    ArticleUpdate,
    ConfirmUploadRequest,
    ExtractTextRequest,
    ExtractTextResponse,
    UploadUrlRequest,
    UploadUrlResponse,
)

PROJECT_ID = uuid4()
ARTICLE_ID = uuid4()
FILE_ID = uuid4()


# =================== ArticleCreate ===================


class TestArticleCreate:
    def test_minimal_valid_construction(self) -> None:
        model = ArticleCreate(projectId=str(PROJECT_ID), title="A Study")
        assert model.project_id == PROJECT_ID
        assert model.title == "A Study"

    def test_accepts_snake_case_field_names(self) -> None:
        """populate_by_name=True allows the Python field names too."""
        model = ArticleCreate(project_id=str(PROJECT_ID), title="X", publication_year=2020)
        assert model.publication_year == 2020

    def test_accepts_camel_case_aliases(self) -> None:
        model = ArticleCreate(
            projectId=str(PROJECT_ID),
            title="X",
            publicationYear=2020,
            journalTitle="Nature",
            arxivId="2401.00001",
            meshTerms=["m1"],
            urlPdf="https://x/p.pdf",
        )
        assert model.publication_year == 2020
        assert model.journal_title == "Nature"
        assert model.arxiv_id == "2401.00001"
        assert model.mesh_terms == ["m1"]
        assert model.url_pdf == "https://x/p.pdf"

    def test_dump_by_alias_emits_camel_case(self) -> None:
        model = ArticleCreate(
            project_id=str(PROJECT_ID),
            title="X",
            publication_year=2020,
            journal_issn="1234-5678",
            open_access=True,
            source_payload={"k": "v"},
        )
        wire = model.model_dump(by_alias=True)
        assert "projectId" in wire
        assert "publicationYear" in wire
        assert "journalIssn" in wire
        assert "openAccess" in wire
        assert "sourcePayload" in wire
        # Python names must NOT leak onto the wire.
        assert "project_id" not in wire
        assert "publication_year" not in wire

    def test_title_required(self) -> None:
        with pytest.raises(ValidationError):
            ArticleCreate(projectId=str(PROJECT_ID))

    def test_empty_title_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ArticleCreate(projectId=str(PROJECT_ID), title="")

    def test_single_char_title_accepted(self) -> None:
        assert ArticleCreate(projectId=str(PROJECT_ID), title="X").title == "X"

    def test_project_id_required(self) -> None:
        with pytest.raises(ValidationError):
            ArticleCreate(title="X")

    # publication_year bounds (ge=1600, le=2500)
    def test_year_lower_bound_inside(self) -> None:
        assert ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationYear=1600)

    def test_year_lower_bound_outside(self) -> None:
        with pytest.raises(ValidationError):
            ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationYear=1599)

    def test_year_upper_bound_inside(self) -> None:
        assert ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationYear=2500)

    def test_year_upper_bound_outside(self) -> None:
        with pytest.raises(ValidationError):
            ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationYear=2501)

    # publication_month bounds (ge=1, le=12)
    def test_month_lower_bound_inside(self) -> None:
        assert ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationMonth=1)

    def test_month_lower_bound_outside(self) -> None:
        with pytest.raises(ValidationError):
            ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationMonth=0)

    def test_month_upper_bound_inside(self) -> None:
        assert ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationMonth=12)

    def test_month_upper_bound_outside(self) -> None:
        with pytest.raises(ValidationError):
            ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationMonth=13)

    # publication_day bounds (ge=1, le=31)
    def test_day_lower_bound_inside(self) -> None:
        assert ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationDay=1)

    def test_day_lower_bound_outside(self) -> None:
        with pytest.raises(ValidationError):
            ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationDay=0)

    def test_day_upper_bound_inside(self) -> None:
        assert ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationDay=31)

    def test_day_upper_bound_outside(self) -> None:
        with pytest.raises(ValidationError):
            ArticleCreate(projectId=str(PROJECT_ID), title="X", publicationDay=32)

    def test_optional_fields_default_to_none(self) -> None:
        model = ArticleCreate(projectId=str(PROJECT_ID), title="X")
        assert model.abstract is None
        assert model.publication_year is None
        assert model.doi is None
        assert model.keywords is None

    def test_collection_defaults(self) -> None:
        model = ArticleCreate(projectId=str(PROJECT_ID), title="X")
        assert model.registration == {}
        assert model.funding == []
        assert model.source_payload == {}


# =================== ArticleUpdate ===================


class TestArticleUpdate:
    def test_empty_update_is_valid(self) -> None:
        """All fields optional, so an empty update validates."""
        model = ArticleUpdate()
        assert model.title is None

    def test_partial_update(self) -> None:
        model = ArticleUpdate(title="New", studyDesign="RCT")
        assert model.title == "New"
        assert model.study_design == "RCT"

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ArticleUpdate(study_design="RCT", journal_title="Cell").model_dump(by_alias=True)
        assert "studyDesign" in wire
        assert "journalTitle" in wire
        assert "study_design" not in wire

    def test_empty_title_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ArticleUpdate(title="")

    def test_single_char_title_accepted(self) -> None:
        assert ArticleUpdate(title="X").title == "X"

    def test_year_bounds(self) -> None:
        assert ArticleUpdate(publicationYear=1600)
        assert ArticleUpdate(publicationYear=2500)
        with pytest.raises(ValidationError):
            ArticleUpdate(publicationYear=1599)
        with pytest.raises(ValidationError):
            ArticleUpdate(publicationYear=2501)

    def test_month_bounds(self) -> None:
        assert ArticleUpdate(publicationMonth=1)
        assert ArticleUpdate(publicationMonth=12)
        with pytest.raises(ValidationError):
            ArticleUpdate(publicationMonth=0)
        with pytest.raises(ValidationError):
            ArticleUpdate(publicationMonth=13)

    def test_day_bounds(self) -> None:
        assert ArticleUpdate(publicationDay=1)
        assert ArticleUpdate(publicationDay=31)
        with pytest.raises(ValidationError):
            ArticleUpdate(publicationDay=0)
        with pytest.raises(ValidationError):
            ArticleUpdate(publicationDay=32)


# =================== ArticleResponse ===================


def _article_response_attrs() -> SimpleNamespace:
    """Attribute object mirroring an ORM row for from_attributes=True."""
    return SimpleNamespace(
        id=ARTICLE_ID,
        project_id=PROJECT_ID,
        title="A Study",
        abstract=None,
        language=None,
        publication_year=2020,
        publication_month=None,
        publication_day=None,
        journal_title="Nature",
        journal_issn=None,
        journal_publisher=None,
        volume=None,
        issue=None,
        pages=None,
        article_type=None,
        publication_status=None,
        open_access=None,
        doi=None,
        pmid=None,
        pmcid=None,
        arxiv_id=None,
        keywords=None,
        authors=None,
        mesh_terms=None,
        url_landing=None,
        url_pdf=None,
        study_design=None,
        registration={},
        funding=[],
        ingestion_source=None,
        zotero_item_key=None,
        zotero_collection_key=None,
        created_at=datetime(2026, 1, 1, 12, 0, 0),
        updated_at=datetime(2026, 1, 2, 12, 0, 0),
        files_count=2,
        has_pdf=True,
    )


class TestArticleResponse:
    def test_from_attributes(self) -> None:
        model = ArticleResponse.model_validate(_article_response_attrs())
        assert model.id == ARTICLE_ID
        assert model.project_id == PROJECT_ID
        assert model.files_count == 2
        assert model.has_pdf is True

    def test_dump_by_alias_emits_camel_case(self) -> None:
        model = ArticleResponse.model_validate(_article_response_attrs())
        wire = model.model_dump(by_alias=True)
        assert "projectId" in wire
        assert "publicationYear" in wire
        assert "createdAt" in wire
        assert "filesCount" in wire
        assert "hasPdf" in wire
        assert "project_id" not in wire

    def test_optional_relationship_fields_default_none(self) -> None:
        attrs = _article_response_attrs()
        attrs.files_count = None
        attrs.has_pdf = None
        model = ArticleResponse.model_validate(attrs)
        assert model.files_count is None
        assert model.has_pdf is None

    def test_missing_required_field_rejected(self) -> None:
        attrs = _article_response_attrs()
        del attrs.created_at
        with pytest.raises(ValidationError):
            ArticleResponse.model_validate(attrs)


# =================== ArticleFileCreate ===================


class TestArticleFileCreate:
    def _kw(self, **kw: object) -> dict[str, object]:
        base: dict[str, object] = {
            "articleId": str(ARTICLE_ID),
            "fileType": "pdf",
            "storageKey": "key/abc.pdf",
        }
        base.update(kw)
        return base

    def test_valid_construction_default_role(self) -> None:
        model = ArticleFileCreate(**self._kw())
        assert model.file_role == "MAIN"
        assert model.article_id == ARTICLE_ID

    @pytest.mark.parametrize(
        "role",
        ["MAIN", "SUPPLEMENT", "PROTOCOL", "DATASET", "APPENDIX", "FIGURE", "OTHER"],
    )
    def test_all_valid_roles_accepted(self, role: str) -> None:
        assert ArticleFileCreate(**self._kw(fileRole=role)).file_role == role

    def test_invalid_role_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ArticleFileCreate(**self._kw(fileRole="THUMBNAIL"))

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ArticleFileCreate(**self._kw()).model_dump(by_alias=True)
        assert "articleId" in wire
        assert "fileType" in wire
        assert "storageKey" in wire
        assert "fileRole" in wire
        assert "article_id" not in wire

    def test_accepts_snake_case(self) -> None:
        model = ArticleFileCreate(
            article_id=str(ARTICLE_ID), file_type="pdf", storage_key="k", file_role="MAIN"
        )
        assert model.storage_key == "k"

    def test_missing_required_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ArticleFileCreate(fileType="pdf", storageKey="k")


# =================== ArticleFileResponse ===================


def _file_response_attrs() -> SimpleNamespace:
    return SimpleNamespace(
        id=FILE_ID,
        project_id=PROJECT_ID,
        article_id=ARTICLE_ID,
        file_type="pdf",
        storage_key="key/abc.pdf",
        original_filename="abc.pdf",
        bytes=1024,
        file_role="MAIN",
        extraction_status="pending",
        extraction_error=None,
        extracted_at=None,
        has_text=False,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 2),
    )


class TestArticleFileResponse:
    def test_from_attributes(self) -> None:
        model = ArticleFileResponse.model_validate(_file_response_attrs())
        assert model.id == FILE_ID
        assert model.file_role == "MAIN"

    def test_defaults(self) -> None:
        attrs = _file_response_attrs()
        del attrs.extraction_status
        del attrs.has_text
        model = ArticleFileResponse.model_validate(attrs)
        assert model.extraction_status == "pending"
        assert model.has_text is False

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ArticleFileResponse.model_validate(_file_response_attrs()).model_dump(by_alias=True)
        assert "projectId" in wire
        assert "articleId" in wire
        assert "fileRole" in wire
        assert "extractionStatus" in wire
        assert "hasText" in wire
        assert "createdAt" in wire


# =================== UploadUrlRequest / UploadUrlResponse ===================


class TestUploadUrlRequest:
    def _kw(self, **kw: object) -> dict[str, object]:
        base: dict[str, object] = {
            "articleId": str(ARTICLE_ID),
            "filename": "paper.pdf",
            "contentType": "application/pdf",
        }
        base.update(kw)
        return base

    def test_valid_default_role(self) -> None:
        model = UploadUrlRequest(**self._kw())
        assert model.file_role == "MAIN"
        assert model.content_type == "application/pdf"

    @pytest.mark.parametrize(
        "role",
        ["MAIN", "SUPPLEMENT", "PROTOCOL", "DATASET", "APPENDIX", "FIGURE", "OTHER"],
    )
    def test_all_roles_accepted(self, role: str) -> None:
        assert UploadUrlRequest(**self._kw(fileRole=role)).file_role == role

    def test_invalid_role_rejected(self) -> None:
        with pytest.raises(ValidationError):
            UploadUrlRequest(**self._kw(fileRole="BOGUS"))

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = UploadUrlRequest(**self._kw()).model_dump(by_alias=True)
        assert "articleId" in wire
        assert "contentType" in wire
        assert "fileRole" in wire


class TestUploadUrlResponse:
    def test_valid_construction_and_alias_dump(self) -> None:
        model = UploadUrlResponse(
            uploadUrl="https://x/upload",
            storageKey="key/abc.pdf",
            expiresAt=datetime(2026, 1, 1, 12, 0, 0),
        )
        assert model.upload_url == "https://x/upload"
        wire = model.model_dump(by_alias=True)
        assert "uploadUrl" in wire
        assert "storageKey" in wire
        assert "expiresAt" in wire

    def test_accepts_snake_case(self) -> None:
        model = UploadUrlResponse(upload_url="u", storage_key="k", expires_at=datetime(2026, 1, 1))
        assert model.storage_key == "k"

    def test_missing_required_rejected(self) -> None:
        with pytest.raises(ValidationError):
            UploadUrlResponse(uploadUrl="u", storageKey="k")


# =================== ConfirmUploadRequest ===================


class TestConfirmUploadRequest:
    def _kw(self, **kw: object) -> dict[str, object]:
        base: dict[str, object] = {
            "articleId": str(ARTICLE_ID),
            "storageKey": "key/abc.pdf",
            "originalFilename": "abc.pdf",
            "contentType": "application/pdf",
            "bytes": 2048,
        }
        base.update(kw)
        return base

    def test_valid_default_role(self) -> None:
        model = ConfirmUploadRequest(**self._kw())
        assert model.file_role == "MAIN"
        assert model.bytes == 2048

    def test_invalid_role_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ConfirmUploadRequest(**self._kw(fileRole="NOPE"))

    def test_bytes_required(self) -> None:
        kw = self._kw()
        del kw["bytes"]
        with pytest.raises(ValidationError):
            ConfirmUploadRequest(**kw)

    def test_bytes_coerced_from_int_string(self) -> None:
        model = ConfirmUploadRequest(**self._kw(bytes="2048"))
        assert model.bytes == 2048

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ConfirmUploadRequest(**self._kw()).model_dump(by_alias=True)
        assert "articleId" in wire
        assert "storageKey" in wire
        assert "originalFilename" in wire
        assert "contentType" in wire
        assert "fileRole" in wire
        assert "bytes" in wire


# =================== ExtractTextRequest / ExtractTextResponse ===================


class TestExtractTextRequest:
    def test_valid_with_default_force(self) -> None:
        model = ExtractTextRequest(fileId=str(FILE_ID))
        assert model.file_id == FILE_ID
        assert model.force is False

    def test_force_override(self) -> None:
        assert ExtractTextRequest(fileId=str(FILE_ID), force=True).force is True

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ExtractTextRequest(fileId=str(FILE_ID)).model_dump(by_alias=True)
        assert "fileId" in wire
        assert "file_id" not in wire

    def test_missing_file_id_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractTextRequest()


class TestExtractTextResponse:
    @pytest.mark.parametrize("status", ["pending", "completed", "failed"])
    def test_valid_statuses(self, status: str) -> None:
        model = ExtractTextResponse(fileId=str(FILE_ID), status=status)
        assert model.status == status

    def test_invalid_status_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractTextResponse(fileId=str(FILE_ID), status="running")

    def test_optional_fields_default_none(self) -> None:
        model = ExtractTextResponse(fileId=str(FILE_ID), status="pending")
        assert model.pages is None
        assert model.characters is None
        assert model.error is None

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ExtractTextResponse(fileId=str(FILE_ID), status="completed").model_dump(
            by_alias=True
        )
        assert "fileId" in wire


# =================== ArticleListItem / ArticleListResponse ===================


def _list_item_attrs() -> SimpleNamespace:
    return SimpleNamespace(
        id=ARTICLE_ID,
        title="A Study",
        authors=["Doe J"],
        publication_year=2020,
        journal_title="Nature",
        doi="10.1/x",
        has_pdf=True,
        extraction_status="completed",
        created_at=datetime(2026, 1, 1),
    )


class TestArticleListItem:
    def test_from_attributes(self) -> None:
        model = ArticleListItem.model_validate(_list_item_attrs())
        assert model.title == "A Study"
        assert model.has_pdf is True

    def test_defaults(self) -> None:
        attrs = _list_item_attrs()
        del attrs.has_pdf
        del attrs.extraction_status
        model = ArticleListItem.model_validate(attrs)
        assert model.has_pdf is False
        assert model.extraction_status is None

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ArticleListItem.model_validate(_list_item_attrs()).model_dump(by_alias=True)
        assert "publicationYear" in wire
        assert "journalTitle" in wire
        assert "hasPdf" in wire
        assert "extractionStatus" in wire
        assert "createdAt" in wire


class TestArticleListResponse:
    def test_valid_construction(self) -> None:
        item = ArticleListItem.model_validate(_list_item_attrs())
        model = ArticleListResponse(items=[item], total=1, pageSize=20, hasMore=False)
        assert model.page == 1  # default
        assert model.page_size == 20
        assert model.has_more is False

    def test_dump_by_alias_emits_camel_case(self) -> None:
        item = ArticleListItem.model_validate(_list_item_attrs())
        wire = ArticleListResponse(items=[item], total=1, pageSize=20, hasMore=True).model_dump(
            by_alias=True
        )
        assert "pageSize" in wire
        assert "hasMore" in wire
        assert "page_size" not in wire

    def test_missing_required_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ArticleListResponse(items=[], total=0)


# =================== ArticleSearchRequest ===================


class TestArticleSearchRequest:
    def test_defaults(self) -> None:
        model = ArticleSearchRequest()
        assert model.page == 1
        assert model.page_size == 20
        assert model.sort_by == "created_at"
        assert model.sort_order == "desc"
        assert model.query is None

    # page bounds (ge=1)
    def test_page_lower_bound_inside(self) -> None:
        assert ArticleSearchRequest(page=1).page == 1

    def test_page_lower_bound_outside(self) -> None:
        with pytest.raises(ValidationError):
            ArticleSearchRequest(page=0)

    # page_size bounds (ge=1, le=100)
    def test_page_size_lower_bound_inside(self) -> None:
        assert ArticleSearchRequest(pageSize=1).page_size == 1

    def test_page_size_lower_bound_outside(self) -> None:
        with pytest.raises(ValidationError):
            ArticleSearchRequest(pageSize=0)

    def test_page_size_upper_bound_inside(self) -> None:
        assert ArticleSearchRequest(pageSize=100).page_size == 100

    def test_page_size_upper_bound_outside(self) -> None:
        with pytest.raises(ValidationError):
            ArticleSearchRequest(pageSize=101)

    @pytest.mark.parametrize("sort_by", ["created_at", "title", "publication_year"])
    def test_valid_sort_by(self, sort_by: str) -> None:
        assert ArticleSearchRequest(sortBy=sort_by).sort_by == sort_by

    def test_invalid_sort_by_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ArticleSearchRequest(sortBy="updated_at")

    @pytest.mark.parametrize("sort_order", ["asc", "desc"])
    def test_valid_sort_order(self, sort_order: str) -> None:
        assert ArticleSearchRequest(sortOrder=sort_order).sort_order == sort_order

    def test_invalid_sort_order_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ArticleSearchRequest(sortOrder="ascending")

    def test_accepts_camel_aliases(self) -> None:
        model = ArticleSearchRequest(
            projectId=str(PROJECT_ID),
            publicationYearMin=2000,
            publicationYearMax=2020,
            hasPdf=True,
            ingestionSource="zotero",
        )
        assert model.project_id == PROJECT_ID
        assert model.publication_year_min == 2000
        assert model.has_pdf is True

    def test_dump_by_alias_emits_camel_case(self) -> None:
        wire = ArticleSearchRequest(publicationYearMin=2000).model_dump(by_alias=True)
        assert "publicationYearMin" in wire
        assert "publicationYearMax" in wire
        assert "hasPdf" in wire
        assert "pageSize" in wire
        assert "sortBy" in wire
        assert "sortOrder" in wire
        assert "publication_year_min" not in wire
