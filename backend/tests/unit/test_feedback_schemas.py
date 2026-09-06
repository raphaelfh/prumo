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


@pytest.mark.parametrize(
    "kind,content_type",
    [
        ("image", "image/png"),
        ("image", "image/jpeg"),
        ("image", "image/gif"),
        ("video", "video/mp4"),
        ("video", "video/webm"),
        ("video", "video/quicktime"),
    ],
)
def test_attachment_accepts_every_pickable_format(kind: str, content_type: str) -> None:
    """The dialog attaches a file from disk, so the ordinary camera and
    screen-recorder formats must pass — not just what getDisplayMedia used to
    produce. Mirrors frontend/lib/feedback-media.ts and the bucket allow-list.
    """
    att = FeedbackAttachmentIn(kind=kind, storage_key="k", content_type=content_type)
    assert att.content_type == content_type


def test_too_many_attachments_rejected() -> None:
    att = {"kind": "image", "storage_key": "k", "content_type": "image/png"}
    with pytest.raises(ValidationError):
        FeedbackCreate(**_payload(attachments=[att] * 6))


def test_blank_description_rejected() -> None:
    with pytest.raises(ValidationError):
        FeedbackCreate(**_payload(description="          "))  # 10 spaces -> trims to empty
