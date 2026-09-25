"""text_caps: length caps for unbounded article metadata (spec §5.1)."""

from __future__ import annotations

import pytest

from app.utils.compact_json import compact_json
from app.utils.text_caps import cap_json_weight


def test_cap_json_weight_keeps_a_value_that_fits() -> None:
    assert cap_json_weight("plain", 7) == ("plain", False)


@pytest.mark.parametrize(
    "value",
    ["x" * 500, "漢" * 500, '"\\' * 300, "\n" * 400, "😀" * 200, "a漢😀\x01" * 100],
    ids=["ascii", "cjk", "escapes", "newlines", "astral", "mixed"],
)
def test_cap_json_weight_cuts_to_the_longest_fitting_prefix(value: str) -> None:
    capped, truncated = cap_json_weight(value, 400)
    assert truncated is True
    assert value.startswith(capped)
    assert len(compact_json(capped)) <= 400
    assert len(compact_json(value[: len(capped) + 1])) > 400


def test_cap_json_weight_on_cjk_is_about_a_sixth_of_the_chars() -> None:
    capped, _ = cap_json_weight("漢" * 10_000, 12_000)
    assert len(capped) == (12_000 - 2) // 6
