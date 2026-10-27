"""The protocol's exclusion reasons a screening reviewer may cite."""

from __future__ import annotations

from typing import Any

import pytest

from app.services.project_ai_context import protocol_exclusion_reasons


def test_reasons_in_slot_order_then_eligibility_deduplicated() -> None:
    picots = {
        "population": {"exclusion": ["Children", " "]},
        "timing": {"prediction_moment": {"exclusion": ["After discharge"]}},
    }
    eligibility = {"exclusion": ["Not ML", "Children"]}

    assert protocol_exclusion_reasons(picots, eligibility) == [
        "Children",
        "After discharge",
        "Not ML",
    ]


@pytest.mark.parametrize(
    ("picots", "eligibility"),
    [(None, None), ("junk", 3), ({"population": 7}, {"exclusion": "Not a list"}), ({}, [])],
    ids=["none", "scalars", "junk-shapes", "empty"],
)
def test_no_or_junk_protocol_has_no_reasons(picots: Any, eligibility: Any) -> None:
    assert protocol_exclusion_reasons(picots, eligibility) == []
