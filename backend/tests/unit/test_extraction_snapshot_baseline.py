"""``baseline_isolated_for_agent``: may the agent edit the draft over this snapshot?"""

from typing import Any

import pytest

from app.services.extraction_snapshot import baseline_isolated_for_agent

_WIDE: list[dict[str, Any]] = [
    {"cardinality": "one", "fields": [{"llm_description": None, "allow_other": False}]}
]
_LEGACY: list[dict[str, Any]] = [{"fields": []}]


def test_empty_snapshot_with_no_run_pinned_is_isolated() -> None:
    assert baseline_isolated_for_agent([], pinned_run_exists=False) is True


def test_empty_snapshot_with_a_run_pinned_is_not_isolated() -> None:
    assert baseline_isolated_for_agent([], pinned_run_exists=True) is False


@pytest.mark.parametrize("pinned", [False, True], ids=["unpinned", "pinned"])
def test_wide_snapshot_is_isolated_either_way(pinned: bool) -> None:
    assert baseline_isolated_for_agent(_WIDE, pinned_run_exists=pinned) is True


@pytest.mark.parametrize("pinned", [False, True], ids=["unpinned", "pinned"])
def test_legacy_snapshot_is_never_isolated(pinned: bool) -> None:
    assert baseline_isolated_for_agent(_LEGACY, pinned_run_exists=pinned) is False
