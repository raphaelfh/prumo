"""Unit tests for app.schemas.articles_export.

Pure Pydantic validation tests: no DB, no async, no fixtures.
These models carry no aliases or enums (free-form str fields), so the
coverage focuses on construction, required vs optional fields, defaults,
nested-model parsing, and model_dump wire shape.
"""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.articles_export import (
    ExportCancelResponse,
    ExportProgress,
    ExportRequest,
    ExportStartedResponse,
    ExportStatusResponse,
    SkippedFileEntry,
)


class TestExportRequest:
    def test_valid_construction(self) -> None:
        pid = uuid4()
        aids = [uuid4(), uuid4()]
        req = ExportRequest(
            project_id=pid,
            article_ids=aids,
            formats=["csv", "ris"],
            file_scope="main_only",
        )
        assert req.project_id == pid
        assert req.article_ids == aids
        assert req.formats == ["csv", "ris"]
        assert req.file_scope == "main_only"

    def test_empty_article_ids_allowed(self) -> None:
        # No min_length constraint declared on article_ids.
        req = ExportRequest(
            project_id=uuid4(),
            article_ids=[],
            formats=["csv"],
            file_scope="none",
        )
        assert req.article_ids == []

    def test_empty_formats_allowed(self) -> None:
        # No min_length constraint declared on formats either.
        req = ExportRequest(
            project_id=uuid4(),
            article_ids=[uuid4()],
            formats=[],
            file_scope="all",
        )
        assert req.formats == []

    def test_project_id_required(self) -> None:
        with pytest.raises(ValidationError):
            ExportRequest(article_ids=[], formats=["csv"], file_scope="none")  # type: ignore[call-arg]

    def test_formats_required(self) -> None:
        with pytest.raises(ValidationError):
            ExportRequest(project_id=uuid4(), article_ids=[], file_scope="none")  # type: ignore[call-arg]

    def test_file_scope_required(self) -> None:
        with pytest.raises(ValidationError):
            ExportRequest(project_id=uuid4(), article_ids=[], formats=["csv"])  # type: ignore[call-arg]

    def test_invalid_uuid_in_article_ids_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExportRequest(
                project_id=uuid4(),
                article_ids=["not-a-uuid"],  # type: ignore[list-item]
                formats=["csv"],
                file_scope="all",
            )


class TestSkippedFileEntry:
    def test_construction(self) -> None:
        aid = uuid4()
        entry = SkippedFileEntry(
            article_id=aid,
            storage_key="bucket/key.pdf",
            reason="missing",
        )
        assert entry.article_id == aid
        assert entry.storage_key == "bucket/key.pdf"
        assert entry.reason == "missing"

    def test_all_fields_required(self) -> None:
        with pytest.raises(ValidationError):
            SkippedFileEntry(article_id=uuid4(), storage_key="k")  # type: ignore[call-arg]


class TestExportProgress:
    def test_construction(self) -> None:
        prog = ExportProgress(current=2, total=5, stage="files")
        assert prog.current == 2
        assert prog.total == 5
        assert prog.stage == "files"

    def test_all_fields_required(self) -> None:
        with pytest.raises(ValidationError):
            ExportProgress(current=1, total=2)  # type: ignore[call-arg]

    def test_non_int_current_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ExportProgress(current="two", total=5, stage="files")  # type: ignore[arg-type]


class TestExportStatusResponse:
    def test_minimal_construction_defaults(self) -> None:
        resp = ExportStatusResponse(job_id="j", status="pending")
        assert resp.progress is None
        assert resp.download_url is None
        assert resp.expires_at is None
        assert resp.skipped_files is None
        assert resp.error is None

    def test_full_construction_with_nested_models(self) -> None:
        resp = ExportStatusResponse(
            job_id="j",
            status="completed",
            progress=ExportProgress(current=5, total=5, stage="done"),
            download_url="https://x/out.zip",
            expires_at="2026-06-13T00:00:00Z",
            skipped_files=[
                SkippedFileEntry(
                    article_id=uuid4(),
                    storage_key="k",
                    reason="too_large",
                )
            ],
            error=None,
        )
        assert resp.progress is not None
        assert resp.progress.stage == "done"
        assert resp.skipped_files is not None
        assert resp.skipped_files[0].reason == "too_large"

    def test_nested_models_parsed_from_dicts(self) -> None:
        resp = ExportStatusResponse.model_validate(
            {
                "job_id": "j",
                "status": "running",
                "progress": {"current": 1, "total": 3, "stage": "metadata"},
                "skipped_files": [
                    {
                        "article_id": str(uuid4()),
                        "storage_key": "k",
                        "reason": "missing",
                    }
                ],
            }
        )
        assert isinstance(resp.progress, ExportProgress)
        assert resp.progress.current == 1
        assert isinstance(resp.skipped_files[0], SkippedFileEntry)  # type: ignore[index]

    def test_status_required(self) -> None:
        with pytest.raises(ValidationError):
            ExportStatusResponse(job_id="j")  # type: ignore[call-arg]


class TestExportStartedResponse:
    def test_default_message(self) -> None:
        resp = ExportStartedResponse(job_id="job-1")
        assert resp.message == "Export started. Poll status for download link."

    def test_message_override_and_null(self) -> None:
        assert ExportStartedResponse(job_id="j", message="x").message == "x"
        assert ExportStartedResponse(job_id="j", message=None).message is None

    def test_job_id_required(self) -> None:
        with pytest.raises(ValidationError):
            ExportStartedResponse()  # type: ignore[call-arg]


class TestExportCancelResponse:
    def test_construction(self) -> None:
        assert ExportCancelResponse(cancelled=True).cancelled is True
        assert ExportCancelResponse(cancelled=False).cancelled is False

    def test_cancelled_required(self) -> None:
        with pytest.raises(ValidationError):
            ExportCancelResponse()  # type: ignore[call-arg]
