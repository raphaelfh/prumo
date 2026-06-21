"""Unit tests for pure settings validators (no .env / DB required)."""

import pytest

from app.core.config_validators import validate_linear_team_id


def test_accepts_a_valid_team_uuid() -> None:
    uuid = "23d83039-4f9a-444f-905a-9a4cb9fea2b6"
    assert validate_linear_team_id(uuid) == uuid


def test_strips_surrounding_whitespace() -> None:
    assert (
        validate_linear_team_id("  23d83039-4f9a-444f-905a-9a4cb9fea2b6  ")
        == "23d83039-4f9a-444f-905a-9a4cb9fea2b6"
    )


def test_none_and_empty_are_allowed_integration_disabled() -> None:
    assert validate_linear_team_id(None) is None
    assert validate_linear_team_id("") is None
    assert validate_linear_team_id("   ") is None


def test_rejects_the_team_slug() -> None:
    with pytest.raises(ValueError, match="must be the Linear team UUID"):
        validate_linear_team_id("FEE")


def test_rejects_a_malformed_uuid() -> None:
    with pytest.raises(ValueError):
        validate_linear_team_id("9b86c9ed-ede9-4f36-99d1")  # truncated
