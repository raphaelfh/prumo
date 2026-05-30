"""Unit tests for the feedback ORM models (no DB I/O)."""

from app.models.feedback import FeedbackAttachment, FeedbackReport


def test_feedback_report_tablename_is_plural() -> None:
    # BaseModel auto-derives a SINGULAR name; we must override to match
    # the existing `feedback_reports` table.
    assert FeedbackReport.__tablename__ == "feedback_reports"
    assert FeedbackReport.__table__.schema == "public"


def test_feedback_attachment_tablename() -> None:
    # BaseModel auto-derives a SINGULAR name (feedback_attachment); the
    # model overrides __tablename__ to match the migration's table.
    assert FeedbackAttachment.__tablename__ == "feedback_attachments"
    assert FeedbackAttachment.__table__.schema == "public"


def test_feedback_report_has_outbox_columns() -> None:
    cols = set(FeedbackReport.__table__.columns.keys())
    assert {
        "id", "user_id", "type", "severity", "summary", "description",
        "url", "route", "user_agent", "viewport_size", "project_id",
        "article_id", "app_version", "linear_issue_id", "linear_identifier",
        "linear_url", "forward_status", "forward_error", "forwarded_at",
        "created_at", "updated_at",
    }.issubset(cols)
    # Dead triage columns must be gone from the model.
    assert "status" not in cols
    assert "admin_notes" not in cols
    assert "screenshot_url" not in cols


def test_feedback_attachment_columns() -> None:
    cols = set(FeedbackAttachment.__table__.columns.keys())
    assert {
        "id", "feedback_report_id", "kind", "storage_key",
        "content_type", "size_bytes", "linear_asset_url", "forward_status",
    }.issubset(cols)
