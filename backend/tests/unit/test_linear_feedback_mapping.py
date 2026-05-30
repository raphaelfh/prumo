from types import SimpleNamespace

from app.services.linear.feedback_mapping import (
    area_label_for,
    attachments_markdown,
    issue_body,
    issue_title,
    label_names_for,
    priority_for,
)


def _report(**kw):
    base = {
        "id": "11111111-1111-1111-1111-111111111111",
        "type": "bug",
        "severity": "high",
        "summary": None,
        "description": "PDF viewer blank on extraction.",
        "url": "https://app/x",
        "route": "/projects/p/extraction",
        "project_id": None,
        "article_id": None,
        "user_agent": "UA",
        "viewport_size": {"width": 1280, "height": 800},
        "app_version": "abc123",
    }
    base.update(kw)
    return SimpleNamespace(**base)


def test_priority_mapping() -> None:
    assert priority_for("critical") == 1
    assert priority_for("high") == 2
    assert priority_for("medium") == 3
    assert priority_for("low") == 4
    assert priority_for(None) == 0


def test_label_names_include_source_and_type_and_area() -> None:
    names = label_names_for(_report(type="bug", route="/projects/p/extraction"))
    assert "source:in-app" in names
    assert "Bug" in names
    assert "area:extraction" in names


def test_label_names_other_has_no_type_label() -> None:
    names = label_names_for(_report(type="other", route="/settings"))
    assert "source:in-app" in names
    assert "Bug" not in names and "Feature" not in names and "Question" not in names


def test_area_label_for_pdf_and_unknown() -> None:
    assert area_label_for("/projects/p/articles/a/pdf") == "area:pdf"
    assert area_label_for("/totally/unknown") is None


def test_issue_title_prefers_summary_then_derives() -> None:
    assert issue_title(_report(summary="Crash on save")) == "Crash on save"
    derived = issue_title(_report(summary=None, type="bug", description="X" * 200))
    assert derived.startswith("[Bug] ") and len(derived) <= 90


def test_issue_body_contains_context() -> None:
    body = issue_body(_report())
    assert "PDF viewer blank" in body
    assert "/projects/p/extraction" in body
    assert "abc123" in body


def test_attachments_markdown_image_vs_video() -> None:
    atts = [
        SimpleNamespace(kind="image", linear_asset_url="https://a/img.webp", forward_status="sent"),
        SimpleNamespace(kind="video", linear_asset_url="https://a/clip.webm", forward_status="sent"),
        SimpleNamespace(kind="image", linear_asset_url=None, forward_status="pending"),
    ]
    md = attachments_markdown(atts)
    assert "![](https://a/img.webp)" in md
    assert "[Screen recording](https://a/clip.webm)" in md
    assert md.count("http") == 2  # the pending/no-url one is skipped
