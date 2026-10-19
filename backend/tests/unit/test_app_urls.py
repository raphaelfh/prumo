"""editor_url: the template editor link both MCP tools and services hand out."""

from __future__ import annotations

from uuid import UUID

import pytest

from app.core.config import settings
from app.utils.app_urls import editor_url

_P = UUID("00000000-0000-0000-0000-0000000000aa")


@pytest.mark.parametrize(
    ("kind", "query"),
    [
        ("extraction", "tab=extraction&extractionTab=configuration"),
        ("quality_assessment", "tab=quality&qaTab=configuration"),
    ],
    ids=["extraction", "quality_assessment"],
)
def test_editor_url_opens_the_kind_tab(monkeypatch, kind: str, query: str) -> None:
    monkeypatch.setattr(settings, "PUBLIC_APP_URL", "https://app.example/")
    assert editor_url(_P, kind) == f"https://app.example/projects/{_P}?{query}"
