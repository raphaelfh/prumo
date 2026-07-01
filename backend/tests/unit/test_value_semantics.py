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
    AbsentReason,
    disposition_to_marker,
    is_value_empty,
    is_value_filled,
    unwrap_value_envelope,
    value_absent_reason,
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


# --- absent_reason marker (ADR-0016 / spec Phase 0) ------------------------
#
# A coordinate can now carry a coded disposition sibling
# ``{"value": None, "absent_reason": <code>}`` meaning the answer is *resolved*
# (the source is silent / not applicable / not evaluated) even though the typed
# value stays ``None``. A resolved marker counts as FILLED; a bare ``{value:null}``
# (no marker) stays empty. The reason is validated against the closed enum, so an
# out-of-vocabulary string can never sneak a required field past the finalize gate.


@pytest.mark.parametrize(
    ("raw", "empty"),
    [
        # every valid disposition code resolves the coordinate → filled
        ({"value": None, "absent_reason": "no_information"}, False),
        ({"value": None, "absent_reason": "not_applicable"}, False),
        ({"value": None, "absent_reason": "not_evaluated"}, False),
        # a real value alongside a marker still counts as filled
        ({"value": "x", "absent_reason": "no_information"}, False),
        # an empty / missing reason is NOT a resolution → still empty
        ({"value": None, "absent_reason": ""}, True),
        ({"value": None, "absent_reason": None}, True),
        ({"value": None}, True),  # bare null, no marker
        # an out-of-vocabulary code is not a resolution → still empty (gate-safe)
        ({"value": None, "absent_reason": "garbage"}, True),
        # a legacy disposition carried IN-BAND as a select value is a non-empty
        # scalar → filled today and still filled (untouched until Phase 3)
        ({"value": "No information"}, False),
        ("No information", False),
    ],
    ids=[
        "marker-no-information",
        "marker-not-applicable",
        "marker-not-evaluated",
        "marker-with-real-value",
        "marker-empty-reason",
        "marker-none-reason",
        "bare-null-no-marker",
        "marker-unknown-code",
        "legacy-string-envelope",
        "legacy-string-scalar",
    ],
)
def test_marker_emptiness(raw, empty):
    assert is_value_empty(raw) is empty
    assert is_value_filled(raw) is (not empty)


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        ({"value": None, "absent_reason": "no_information"}, "no_information"),
        ({"value": None, "absent_reason": "not_applicable"}, "not_applicable"),
        ({"value": None, "absent_reason": "not_evaluated"}, "not_evaluated"),
        ({"value": None, "absent_reason": ""}, None),  # empty reason
        ({"value": None, "absent_reason": None}, None),
        ({"value": None, "absent_reason": "garbage"}, None),  # out of vocabulary
        ({"value": None}, None),  # no marker
        ({"value": "x"}, None),  # a real value carries no reason
        (None, None),
        ("x", None),
    ],
)
def test_value_absent_reason_returns_only_valid_codes(raw, code):
    assert value_absent_reason(raw) == code


def test_absent_reason_enum_is_the_closed_three_code_vocabulary():
    assert {r.value for r in AbsentReason} == {
        "no_information",
        "not_applicable",
        "not_evaluated",
    }


# --- disposition_to_marker: the single write-time normalizer (ADR-0016 P2) ---

_YN_NI = ["Yes", "No", "No information"]
_PROBAST = ["Y", "PY", "PN", "N", "NI", "NA"]
_YN_UNCLEAR = ["Yes", "No", "Unclear"]


@pytest.mark.parametrize(
    ("raw", "allowed", "expected"),
    [
        # full-word codes, in-domain → marker (unit sibling is dropped)
        ({"value": "No information"}, _YN_NI, {"value": None, "absent_reason": "no_information"}),
        (
            {"value": "No information", "unit": None},
            _YN_NI,
            {"value": None, "absent_reason": "no_information"},
        ),
        (
            {"value": "Not applicable"},
            ["Yes", "No", "Not applicable"],
            {"value": None, "absent_reason": "not_applicable"},
        ),
        (
            {"value": "Not evaluated"},
            ["Yes", "No", "Not evaluated"],
            {"value": None, "absent_reason": "not_evaluated"},
        ),
        # PROBAST abbreviations, in-domain → marker
        ({"value": "NI"}, _PROBAST, {"value": None, "absent_reason": "no_information"}),
        ({"value": "NA"}, _PROBAST, {"value": None, "absent_reason": "not_applicable"}),
        # bare (unenveloped) disposition string, in-domain → marker
        ("No information", _YN_NI, {"value": None, "absent_reason": "no_information"}),
    ],
)
def test_disposition_to_marker_converts_in_domain(raw, allowed, expected):
    assert disposition_to_marker(raw, allowed) == expected


@pytest.mark.parametrize(
    ("raw", "allowed"),
    [
        # substantive values are never rewritten
        ({"value": "Unclear"}, _YN_UNCLEAR),
        ({"value": "Retrospective cohort"}, None),
        # already-resolved marker is left as-is
        ({"value": None, "absent_reason": "no_information"}, _YN_NI),
        # multiselect list carrying the code → left untouched (dispositions are scalar)
        ({"value": ["No information"]}, _YN_NI),
        # SECURITY: coincidental free-text "NA" (no domain) is NOT corrupted
        ({"value": "NA"}, None),
        # out-of-domain match (a field whose domain lacks the string) is untouched
        ({"value": "NA"}, ["cohort", "rct"]),
    ],
)
def test_disposition_to_marker_leaves_untouched(raw, allowed):
    assert disposition_to_marker(raw, allowed) == raw
