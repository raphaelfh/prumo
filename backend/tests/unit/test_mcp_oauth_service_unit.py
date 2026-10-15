"""Pure helpers of the OAuth service (ADR 0022)."""

from __future__ import annotations

import pytest

from app.services.mcp_oauth_service import granted_scopes


@pytest.mark.parametrize(
    ("scope", "expected"), [("read", ["read"]), ("read_write", ["read", "write"])]
)
def test_granted_scopes(scope: str, expected: list[str]) -> None:
    assert granted_scopes(scope) == expected
