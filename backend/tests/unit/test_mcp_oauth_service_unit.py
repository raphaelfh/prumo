"""Pure helpers of the OAuth service (ADR 0022)."""

from __future__ import annotations

import pytest

from app.services.mcp_oauth_service import granted_scopes


@pytest.mark.parametrize(
    ("scope", "ai_run", "expected"),
    [
        ("read", False, ["read"]),
        ("read_write", False, ["read", "write"]),
        ("read", True, ["read", "ai_run"]),
        ("read_write", True, ["read", "write", "ai_run"]),
    ],
    ids=["read", "read_write", "read+ai_run", "read_write+ai_run"],
)
def test_granted_scopes(scope: str, ai_run: bool, expected: list[str]) -> None:
    assert granted_scopes(scope, ai_run) == expected
