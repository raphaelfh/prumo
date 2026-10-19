"""The batch section summary the next sections' prompts read: empty and
absent answers are skipped, so it never prints "None"."""

from __future__ import annotations

from types import SimpleNamespace

from app.services.ai_extraction._batch import _summary

_ET = SimpleNamespace(label="Participants", name="p")


def test_summary_of_only_empty_or_absent_answers_says_no_data():
    out = _summary(
        _ET, {"a": {"value": None}, "b": {"value": None, "absent_reason": "no_information"}}
    )
    assert out == "Participants: No data extracted"


def test_summary_skips_empty_answers():
    out = _summary(_ET, {"a": {"value": None}, "b": {"value": "x"}})
    assert out == "Participants: b: x"


def test_summary_counts_more_only_over_populated_answers():
    extracted = {
        "a": {"value": None},
        "b": {"value": "1"},
        "c": {"value": "2"},
        "d": {"value": "3"},
    }
    assert _summary(_ET, extracted) == "Participants: b: 1, c: 2, d: 3"


def test_summary_never_prints_none():
    cases = [
        {"a": {"value": None}},
        {"a": {"value": "n", "absent_reason": "not_applicable"}, "b": {"value": 0}},
        {},
    ]
    for extracted in cases:
        assert "None" not in _summary(_ET, extracted)
