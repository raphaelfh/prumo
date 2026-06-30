"""Unit tests for the shared value-emptiness predicate.

``is_value_filled`` powers the finalize completeness gate (run_lifecycle_service)
and ``is_value_empty`` powers the AI-suggestion dedup "no information" rule
(extraction_suggestion_read_service). They are exact inverses of ONE rule,
mirroring the frontend ``isNoInfoValue`` (value === null | undefined | '').
The gate must never become stricter than the form the user just saw, so only
``None`` and the empty string count as empty — whitespace, 0, False and []
are filled.
"""

import pytest

from app.services.value_semantics import (
    is_value_empty,
    is_value_filled,
    unwrap_value_envelope,
)


@pytest.mark.parametrize(
    ("raw", "empty"),
    [
        (None, True),
        ("", True),
        ({"value": None}, True),
        ({"value": ""}, True),
        ("x", False),
        (0, False),
        (False, False),
        ([], False),
        ("  ", False),  # whitespace is filled — gate must not be stricter than the form
        ({"value": "x"}, False),
        ({"value": 0}, False),
        ({"value": {"value": "x", "unit": "mg"}}, False),  # double-wrapped unit value
    ],
    ids=[
        "none",
        "empty-string",
        "envelope-none",
        "envelope-empty-string",
        "scalar-string",
        "zero",
        "false",
        "empty-list",
        "whitespace",
        "envelope-value",
        "envelope-zero",
        "double-wrapped-unit",
    ],
)
def test_is_value_empty_and_filled_are_inverses(raw, empty):
    assert is_value_empty(raw) is empty
    assert is_value_filled(raw) is (not empty)


def test_unwrap_peels_one_value_level_only():
    assert unwrap_value_envelope({"value": "x"}) == "x"
    # A bare scalar or a dict WITHOUT a "value" key is returned untouched.
    assert unwrap_value_envelope("x") == "x"
    assert unwrap_value_envelope({"unit": "mg"}) == {"unit": "mg"}
    # Only one level is peeled.
    assert unwrap_value_envelope({"value": {"value": "x"}}) == {"value": "x"}


def test_dict_without_value_key_counts_as_filled():
    # A dict that is NOT a value envelope (no "value" key) is content, not empty —
    # this keeps the gate from blocking on structured data. (Proposals never carry
    # this shape, so the suggestion-dedup caller is unaffected in practice.)
    assert is_value_empty({"unit": "mg"}) is False
    assert is_value_filled({"unit": "mg"}) is True
