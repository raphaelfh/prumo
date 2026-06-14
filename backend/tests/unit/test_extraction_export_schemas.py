"""Unit tests for app.schemas.extraction_export.

Pure Pydantic validation tests: no DB, no async, no fixtures.
Covers the two StrEnums, the request model's defaults / min_length /
model_config, and the three response payloads.
"""

from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from app.schemas.extraction_export import (
    ExtractionArticleScope,
    ExtractionExportCancelResponse,
    ExtractionExportMode,
    ExtractionExportRequest,
    ExtractionExportStartedResponse,
    ExtractionExportStatusResponse,
)


class TestExtractionExportMode:
    def test_members_and_values(self) -> None:
        assert ExtractionExportMode.CONSENSUS == "consensus"
        assert ExtractionExportMode.SINGLE_USER == "single_user"
        assert ExtractionExportMode.ALL_USERS == "all_users"

    def test_member_set(self) -> None:
        assert {m.value for m in ExtractionExportMode} == {
            "consensus",
            "single_user",
            "all_users",
        }


class TestExtractionArticleScope:
    def test_members_and_values(self) -> None:
        assert ExtractionArticleScope.CURRENT_LIST == "current_list"
        assert ExtractionArticleScope.SELECTED_ONLY == "selected_only"

    def test_member_set(self) -> None:
        assert {m.value for m in ExtractionArticleScope} == {
            "current_list",
            "selected_only",
        }


class TestExtractionExportRequestDefaults:
    def test_minimal_construction_applies_defaults(self) -> None:
        req = ExtractionExportRequest(
            template_id=uuid4(),
            article_ids=[uuid4()],
        )
        assert req.mode == ExtractionExportMode.CONSENSUS
        assert req.article_scope == ExtractionArticleScope.CURRENT_LIST
        assert req.reviewer_id is None
        assert req.include_ai_metadata is False
        assert req.anonymize_reviewer_names is False

    def test_full_construction(self) -> None:
        tid = uuid4()
        rid = uuid4()
        aid = uuid4()
        req = ExtractionExportRequest(
            template_id=tid,
            mode=ExtractionExportMode.SINGLE_USER,
            reviewer_id=rid,
            article_scope=ExtractionArticleScope.SELECTED_ONLY,
            article_ids=[aid],
            include_ai_metadata=True,
            anonymize_reviewer_names=True,
        )
        assert req.template_id == tid
        assert req.reviewer_id == rid
        assert req.article_ids == [aid]
        assert req.mode == ExtractionExportMode.SINGLE_USER
        assert req.article_scope == ExtractionArticleScope.SELECTED_ONLY


class TestExtractionExportRequestArticleIds:
    def test_empty_list_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionExportRequest(template_id=uuid4(), article_ids=[])

    def test_single_item_accepted(self) -> None:
        req = ExtractionExportRequest(template_id=uuid4(), article_ids=[uuid4()])
        assert len(req.article_ids) == 1

    def test_multiple_items_accepted(self) -> None:
        ids = [uuid4(), uuid4(), uuid4()]
        req = ExtractionExportRequest(template_id=uuid4(), article_ids=ids)
        assert req.article_ids == ids

    def test_article_ids_required(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionExportRequest(template_id=uuid4())  # type: ignore[call-arg]

    def test_template_id_required(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionExportRequest(article_ids=[uuid4()])  # type: ignore[call-arg]


class TestExtractionExportRequestEnums:
    def test_invalid_mode_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionExportRequest(
                template_id=uuid4(),
                article_ids=[uuid4()],
                mode="not_a_mode",
            )

    def test_invalid_article_scope_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionExportRequest(
                template_id=uuid4(),
                article_ids=[uuid4()],
                article_scope="everything",
            )

    def test_mode_accepts_raw_string_value(self) -> None:
        req = ExtractionExportRequest(
            template_id=uuid4(),
            article_ids=[uuid4()],
            mode="all_users",
        )
        assert req.mode is ExtractionExportMode.ALL_USERS


class TestExtractionExportRequestConfig:
    def test_str_strip_whitespace_does_not_extend_to_uuid_coercion(self) -> None:
        # str_strip_whitespace=True only trims fields validated *as* str.
        # ExtractionExportRequest has no plain-str field, and the flag does
        # NOT pre-trim before UUID parsing, so a padded UUID string is
        # rejected. Documents the (correct) Pydantic v2 behavior so a future
        # str field added to this model is the only place stripping kicks in.
        raw = "11111111-1111-1111-1111-111111111111"
        with pytest.raises(ValidationError):
            ExtractionExportRequest(
                template_id=f"  {raw}  ",  # type: ignore[arg-type]
                article_ids=[uuid4()],
            )

    def test_clean_uuid_string_parses(self) -> None:
        raw = "11111111-1111-1111-1111-111111111111"
        req = ExtractionExportRequest(
            template_id=raw,  # type: ignore[arg-type]
            article_ids=[uuid4()],
        )
        assert req.template_id == UUID(raw)

    def test_populate_by_name_does_not_break_snake_case_input(self) -> None:
        # No camelCase aliases are declared on this model, so snake_case
        # field names are the only accepted keys; populate_by_name=True is
        # a forward-compat flag here.
        req = ExtractionExportRequest.model_validate(
            {
                "template_id": str(uuid4()),
                "article_ids": [str(uuid4())],
                "include_ai_metadata": True,
            }
        )
        assert req.include_ai_metadata is True

    def test_model_dump_uses_snake_case_keys(self) -> None:
        req = ExtractionExportRequest(template_id=uuid4(), article_ids=[uuid4()])
        dumped = req.model_dump()
        assert set(dumped) == {
            "template_id",
            "mode",
            "reviewer_id",
            "article_scope",
            "article_ids",
            "include_ai_metadata",
            "anonymize_reviewer_names",
        }


class TestExtractionExportStartedResponse:
    def test_default_message(self) -> None:
        resp = ExtractionExportStartedResponse(job_id="job-1")
        assert resp.job_id == "job-1"
        assert resp.message == "Export started. Poll status for download link."

    def test_message_override(self) -> None:
        resp = ExtractionExportStartedResponse(job_id="job-1", message="custom")
        assert resp.message == "custom"

    def test_message_nullable(self) -> None:
        resp = ExtractionExportStartedResponse(job_id="job-1", message=None)
        assert resp.message is None

    def test_job_id_required(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionExportStartedResponse()  # type: ignore[call-arg]


class TestExtractionExportStatusResponse:
    def test_minimal_construction_defaults(self) -> None:
        resp = ExtractionExportStatusResponse(job_id="j", status="pending")
        assert resp.download_url is None
        assert resp.expires_at is None
        assert resp.error is None

    def test_full_construction(self) -> None:
        resp = ExtractionExportStatusResponse(
            job_id="j",
            status="completed",
            download_url="https://x/y.xlsx",
            expires_at="2026-06-13T00:00:00Z",
            error=None,
        )
        assert resp.status == "completed"
        assert resp.download_url == "https://x/y.xlsx"
        assert resp.expires_at == "2026-06-13T00:00:00Z"

    def test_status_required(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionExportStatusResponse(job_id="j")  # type: ignore[call-arg]


class TestExtractionExportCancelResponse:
    def test_construction(self) -> None:
        assert ExtractionExportCancelResponse(cancelled=True).cancelled is True
        assert ExtractionExportCancelResponse(cancelled=False).cancelled is False

    def test_cancelled_required(self) -> None:
        with pytest.raises(ValidationError):
            ExtractionExportCancelResponse()  # type: ignore[call-arg]

    def test_cancelled_coerces_truthy_int(self) -> None:
        # Pydantic v2 bool coercion accepts 1/0 ints.
        assert ExtractionExportCancelResponse(cancelled=1).cancelled is True  # type: ignore[arg-type]
