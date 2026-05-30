import pytest
from pydantic import ValidationError

from app.schemas.feedback import FeedbackAttachmentIn, FeedbackCreate


def _payload(**kw):
    base = {
        "type": "bug",
        "severity": "high",
        "description": "The PDF viewer renders blank on the extraction screen.",
        "context": {"url": "https://app/x", "route": "/projects/p/extraction"},
        "attachments": [],
    }
    base.update(kw)
    return base


def test_valid_payload_parses() -> None:
    model = FeedbackCreate(**_payload())
    assert model.type == "bug"
    assert model.context.url == "https://app/x"


def test_short_description_rejected() -> None:
    with pytest.raises(ValidationError):
        FeedbackCreate(**_payload(description="too short"))


def test_bad_type_rejected() -> None:
    with pytest.raises(ValidationError):
        FeedbackCreate(**_payload(type="rant"))


def test_attachment_mime_allowlist() -> None:
    ok = FeedbackAttachmentIn(kind="image", storage_key="k", content_type="image/webp")
    assert ok.content_type == "image/webp"
    with pytest.raises(ValidationError):
        FeedbackAttachmentIn(kind="image", storage_key="k", content_type="application/pdf")


def test_too_many_attachments_rejected() -> None:
    att = {"kind": "image", "storage_key": "k", "content_type": "image/png"}
    with pytest.raises(ValidationError):
        FeedbackCreate(**_payload(attachments=[att] * 6))
