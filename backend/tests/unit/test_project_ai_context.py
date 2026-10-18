"""Unit tests for the project review-question renderer (protocol -> prompt block).

Assertions here compare WHOLE rendered strings, never ``in``-membership: slot
ORDER is part of the contract (the instrument's P-I-C-O-T-S sequence) and a
membership check would not guard it.
"""

from __future__ import annotations

import pytest

from app.services.project_ai_context import (
    MAX_REVIEW_CONTEXT_CHARS,
    render_review_question,
)

_EMPTY_ELIGIBILITY = {"inclusion": [], "exclusion": [], "notes": ""}
_EMPTY_DESIGN = {"types": [], "notes": ""}


def _picots_only(picots, review_type):
    """The PICOTS half alone, proven identical with empty eligibility/designs.

    Every PICOTS fixture below predates eligibility in the prompt; rendering it
    with absent AND with empty eligibility/design must give the same bytes, so a
    project that never filled those keeps a byte-identical prompt.
    """
    absent = render_review_question(picots, review_type, None, None)
    empty = render_review_question(picots, review_type, _EMPTY_ELIGIBILITY, _EMPTY_DESIGN)
    assert absent == empty
    return absent


def _item(description: str = "", inclusion=None, exclusion=None) -> dict:
    return {
        "description": description,
        "inclusion": inclusion or [],
        "exclusion": exclusion or [],
    }


FULL_PICOTS = {
    "population": _item(
        "Adults hospitalised with acute heart failure, EF <= 40%",
        inclusion=["NYHA II-IV"],
        exclusion=["paediatric cohorts"],
    ),
    "index_models": _item("Multimodal ML models combining imaging and EHR"),
    "comparator_models": _item("EHR-only models; established clinical risk scores"),
    "outcomes": _item("30-day all-cause readmission"),
    "timing": _item("Predicted at discharge (T0); 30-day prediction horizon"),
    "setting_and_intended_use": _item("Tertiary hospital discharge planning"),
}


def test_renders_the_six_slots_with_predictive_model_labels() -> None:
    """The spec §2 sample output, byte for byte.

    ``Index model(s)`` / ``Comparator model(s)`` are the instrument's own
    wording — PROBAST+AI's applicability items are phrased against them, so a
    generic "Intervention" here would silently decouple the prompt from the
    tool it is grading with.
    """
    assert _picots_only(FULL_PICOTS, "predictive_model") == (
        "- Population: Adults hospitalised with acute heart failure, EF <= 40%\n"
        "  Include: NYHA II-IV\n"
        "  Exclude: paediatric cohorts\n"
        "- Index model(s): Multimodal ML models combining imaging and EHR\n"
        "- Comparator model(s): EHR-only models; established clinical risk scores\n"
        "- Outcome(s): 30-day all-cause readmission\n"
        "- Timing: Predicted at discharge (T0); 30-day prediction horizon\n"
        "- Setting and intended use: Tertiary hospital discharge planning"
    )


def test_empty_slots_are_omitted_not_padded() -> None:
    """A slot with nothing in it contributes NO line.

    Padding it with "(not specified)" would read to the model as a fact about
    the review rather than an unfilled form.
    """
    assert _picots_only(
        {"population": _item("Adults"), "outcomes": _item("Mortality")},
        "interventional",
    ) == ("- Population: Adults\n- Outcome(s): Mortality")


@pytest.mark.parametrize(
    "picots",
    [
        pytest.param(None, id="column-null"),
        pytest.param({}, id="empty-object"),
        pytest.param(
            {
                "population": "",
                "index_models": "",
                "comparator_models": "",
                "outcomes": "",
                "timing": {"prediction_moment": "", "prediction_horizon": ""},
                "setting_and_intended_use": "",
            },
            id="declared-orm-default-strings",
        ),
        pytest.param(
            {k: _item() for k in FULL_PICOTS},
            id="six-empty-items",
        ),
        pytest.param({"population": {"inclusion": [], "exclusion": []}}, id="arrays-empty"),
    ],
)
def test_nothing_to_say_renders_nothing(picots) -> None:
    """Every shape an untouched project can hold renders ``None``.

    This is the no-regression proof for shipping the block ON by default: if
    it returns None, ``render_review_context_section`` emits "" and the prompt
    is byte-identical to today's.
    """
    assert _picots_only(picots, "predictive_model") is None


@pytest.mark.parametrize(
    ("review_type", "index_label", "comparator_label"),
    [
        ("interventional", "Intervention", "Comparator"),
        ("predictive_model", "Index model(s)", "Comparator model(s)"),
        ("diagnostic", "Index test", "Reference standard"),
        ("prognostic", "Prognostic factor", "Comparator"),
        ("qualitative", "Phenomenon", "Comparator"),
        ("other", "Intervention", "Comparator"),
        (None, "Intervention", "Comparator"),
        ("something_new_from_a_future_enum", "Intervention", "Comparator"),
    ],
)
def test_the_i_and_c_labels_follow_the_review_type(
    review_type, index_label, comparator_label
) -> None:
    picots = {"index_models": _item("I text"), "comparator_models": _item("C text")}
    assert _picots_only(picots, review_type) == (
        f"- {index_label}: I text\n- {comparator_label}: C text"
    )


def test_legacy_nested_timing_is_merged_into_one_line() -> None:
    """``timing`` is stored nested and IS written by the settings UI today.

    ``ReviewDetailsSection`` renders a hardcoded accordion writing
    ``timing.prediction_moment`` / ``timing.prediction_horizon`` through
    ``updatePICOTSField``'s dotted-path branch. The renderer therefore reads
    that shape; flattening the column is a separate slice that lands with the
    editor rewrite.
    """
    picots = {
        "timing": {
            "prediction_moment": _item("Predicted at discharge (T0)"),
            "prediction_horizon": _item("30-day prediction horizon"),
        }
    }
    assert _picots_only(picots, "predictive_model") == (
        "- Timing: Predicted at discharge (T0); 30-day prediction horizon"
    )


def test_nested_timing_survives_a_half_filled_mixed_shape() -> None:
    """Editing only the moment leaves the horizon as the string ``""``.

    ``updatePICOTSField`` spreads the parent and replaces one child, so a dict
    beside a string is the REALISTIC stored shape — not "both are dicts".
    A naive merge drops the filled half.
    """
    picots = {
        "timing": {
            "prediction_moment": _item("At discharge", inclusion=["index admission"]),
            "prediction_horizon": "",
        }
    }
    assert _picots_only(picots, "predictive_model") == (
        "- Timing: At discharge\n  Include: index admission"
    )


def test_a_hybrid_timing_keeps_BOTH_the_flat_and_the_nested_text() -> None:
    """Flat and nested keys can coexist on one row, and both are real input.

    Migration 0063 flattens the slot, but Railway and Vercel deploy
    independently: a browser still holding the pre-0063 bundle edits one timing
    box, ``updatePICOTSField`` SPREADS the parent, and the nested key lands back
    beside the migrated flat one. Treating the shapes as either/or drops
    whichever half the branch does not take — here, everything a manager typed
    through the new editor.
    """
    picots = {
        "timing": {
            "description": "At discharge (T0)",
            "inclusion": ["index admission"],
            "exclusion": [],
            "prediction_horizon": {"description": "30-day horizon", "exclusion": ["death"]},
        }
    }
    assert _picots_only(picots, "predictive_model") == (
        "- Timing: At discharge (T0); 30-day horizon\n  Include: index admission\n  Exclude: death"
    )


def test_a_slot_with_only_criteria_still_renders() -> None:
    """Emptiness is description OR arrays — never description alone.

    Spec §2 says "a slot with no description contributes no line", which would
    silently drop real inclusion/exclusion criteria a manager typed.
    """
    assert _picots_only(
        {"population": _item("", inclusion=["adults"], exclusion=["children"])},
        "interventional",
    ) == ("- Population:\n  Include: adults\n  Exclude: children")


def test_multiple_criteria_join_on_one_line() -> None:
    assert _picots_only(
        {"population": _item("Adults", inclusion=["a", "b", "c"])},
        "interventional",
    ) == ("- Population: Adults\n  Include: a; b; c")


def test_a_string_shaped_slot_is_read_as_its_description() -> None:
    """The ORM declares string-shaped slots (``"population": ""``).

    No backend code constructs ``Project(...)`` and the column has no server
    default, so this shape is unreachable today — but the declaration is one
    ``Project(...)`` away from firing, and tolerating it costs two lines.
    """
    assert _picots_only({"population": "Adults only"}, "interventional") == (
        "- Population: Adults only"
    )


def test_non_string_junk_in_a_slot_is_ignored_rather_than_rendered() -> None:
    """The column is client-written over PostgREST — it can hold anything."""
    assert _picots_only({"population": 42, "outcomes": _item("Mortality")}, "other") == (
        "- Outcome(s): Mortality"
    )


def test_a_json_null_criteria_list_is_read_as_empty() -> None:
    """``jsonb_build_object`` with a SQL NULL emits JSON null, not ``[]``.

    Any write path that builds the slot in SQL can therefore store
    ``"inclusion": null``, which is not a list and must not blow up the
    join — nor count as content that keeps an otherwise-empty slot alive.
    """
    assert _picots_only(
        {"population": {"description": "Adults", "inclusion": None, "exclusion": None}},
        "interventional",
    ) == ("- Population: Adults")
    assert (
        _picots_only({"population": {"description": "", "inclusion": None}}, "interventional")
        is None
    )


def test_the_block_is_capped_so_one_paste_cannot_dominate_every_prompt() -> None:
    """PICOT is written over PostgREST with no length cap anywhere.

    ``llm_template_instruction`` — the surface this replaces — is capped at
    4000 chars server-side. The cap belongs in the RENDERER because that is
    what reaches the model, and it holds no matter who writes the column.
    """
    rendered = _picots_only({"population": _item("x" * 50_000)}, "interventional")
    assert rendered is not None
    assert len(rendered) <= MAX_REVIEW_CONTEXT_CHARS
    assert rendered.endswith("…")


# --- Eligibility and eligible study designs (after PICOTS) -------------------


def test_eligibility_and_designs_follow_the_picots_lines_in_fixed_order() -> None:
    assert render_review_question(
        {"population": _item("Adults")},
        "interventional",
        {"inclusion": ["English", "2010 onwards"], "exclusion": ["conference abstracts"]},
        {"types": ["cohort", "RCT"]},
    ) == (
        "- Population: Adults\n"
        "Eligibility:\n"
        "  Include: English; 2010 onwards\n"
        "  Exclude: conference abstracts\n"
        "Eligible study designs: cohort; RCT"
    )


def test_notes_never_render() -> None:
    rendered = render_review_question(
        None,
        None,
        {"inclusion": ["English"], "exclusion": [], "notes": "ELIGIBILITY-NOTE"},
        {"types": ["cohort"], "notes": "DESIGN-NOTE"},
    )
    assert rendered == "Eligibility:\n  Include: English\nEligible study designs: cohort"


def test_eligibility_alone_renders_only_the_eligibility_lines() -> None:
    assert (
        render_review_question({}, "predictive_model", {"exclusion": ["animal studies"]}, None)
        == "Eligibility:\n  Exclude: animal studies"
    )


def test_designs_alone_render_without_an_eligibility_heading() -> None:
    assert (
        render_review_question(None, None, {"inclusion": []}, {"types": ["case-control"]})
        == "Eligible study designs: case-control"
    )


@pytest.mark.parametrize(
    ("eligibility", "design"),
    [
        pytest.param({"legacy": 1}, {"legacy": 1}, id="legacy-dicts"),
        pytest.param("free text", ["cohort"], id="non-mapping"),
        pytest.param({"inclusion": "English"}, {"types": "cohort"}, id="non-list"),
        pytest.param({"inclusion": [1, None, "  "]}, {"types": [2, {"x": 1}, ""]}, id="junk-items"),
    ],
)
def test_legacy_or_junk_eligibility_is_ignored(eligibility, design) -> None:
    assert render_review_question(None, None, eligibility, design) is None
    assert (
        render_review_question({"population": _item("Adults")}, None, eligibility, design)
        == "- Population: Adults"
    )


def test_items_are_stripped_and_non_strings_skipped() -> None:
    assert render_review_question(
        None, None, {"inclusion": [" English ", 7, "", "Peer reviewed"]}, {"types": [" RCT "]}
    ) == ("Eligibility:\n  Include: English; Peer reviewed\nEligible study designs: RCT")


def test_one_cap_governs_the_whole_block() -> None:
    rendered = render_review_question(
        {"population": _item("p" * 3000)},
        "interventional",
        {"inclusion": ["e" * 3000]},
        {"types": ["cohort"]},
    )
    assert rendered is not None
    assert len(rendered) == MAX_REVIEW_CONTEXT_CHARS
    assert rendered.endswith("…")
    assert rendered.startswith("- Population: ppp")
    assert "\nEligibility:\n  Include: eee" in rendered
