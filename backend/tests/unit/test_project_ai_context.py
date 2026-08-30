"""Unit tests for the project review-context renderer (PICOT -> prompt block).

Assertions here compare WHOLE rendered strings, never ``in``-membership: slot
ORDER is part of the contract (the instrument's P-I-C-O-T-S sequence) and a
membership check would not guard it.
"""

from __future__ import annotations

import pytest

from app.services.project_ai_context import (
    MAX_REVIEW_CONTEXT_CHARS,
    render_picots_block,
)


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
    assert render_picots_block(FULL_PICOTS, "predictive_model") == (
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
    assert render_picots_block(
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
    assert render_picots_block(picots, "predictive_model") is None


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
    assert render_picots_block(picots, review_type) == (
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
    assert render_picots_block(picots, "predictive_model") == (
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
    assert render_picots_block(picots, "predictive_model") == (
        "- Timing: At discharge\n  Include: index admission"
    )


def test_a_slot_with_only_criteria_still_renders() -> None:
    """Emptiness is description OR arrays — never description alone.

    Spec §2 says "a slot with no description contributes no line", which would
    silently drop real inclusion/exclusion criteria a manager typed.
    """
    assert render_picots_block(
        {"population": _item("", inclusion=["adults"], exclusion=["children"])},
        "interventional",
    ) == ("- Population:\n  Include: adults\n  Exclude: children")


def test_multiple_criteria_join_on_one_line() -> None:
    assert render_picots_block(
        {"population": _item("Adults", inclusion=["a", "b", "c"])},
        "interventional",
    ) == ("- Population: Adults\n  Include: a; b; c")


def test_a_string_shaped_slot_is_read_as_its_description() -> None:
    """The ORM declares string-shaped slots (``"population": ""``).

    No backend code constructs ``Project(...)`` and the column has no server
    default, so this shape is unreachable today — but the declaration is one
    ``Project(...)`` away from firing, and tolerating it costs two lines.
    """
    assert render_picots_block({"population": "Adults only"}, "interventional") == (
        "- Population: Adults only"
    )


def test_non_string_junk_in_a_slot_is_ignored_rather_than_rendered() -> None:
    """The column is client-written over PostgREST — it can hold anything."""
    assert render_picots_block({"population": 42, "outcomes": _item("Mortality")}, "other") == (
        "- Outcome(s): Mortality"
    )


def test_a_json_null_criteria_list_is_read_as_empty() -> None:
    """``jsonb_build_object`` with a SQL NULL emits JSON null, not ``[]``.

    Any write path that builds the slot in SQL can therefore store
    ``"inclusion": null``, which is not a list and must not blow up the
    join — nor count as content that keeps an otherwise-empty slot alive.
    """
    assert render_picots_block(
        {"population": {"description": "Adults", "inclusion": None, "exclusion": None}},
        "interventional",
    ) == ("- Population: Adults")
    assert (
        render_picots_block(
            {"population": {"description": "", "inclusion": None}}, "interventional"
        )
        is None
    )


def test_the_block_is_capped_so_one_paste_cannot_dominate_every_prompt() -> None:
    """PICOT is written over PostgREST with no length cap anywhere.

    ``llm_template_instruction`` — the surface this replaces — is capped at
    4000 chars server-side. The cap belongs in the RENDERER because that is
    what reaches the model, and it holds no matter who writes the column.
    """
    rendered = render_picots_block({"population": _item("x" * 50_000)}, "interventional")
    assert rendered is not None
    assert len(rendered) <= MAX_REVIEW_CONTEXT_CHARS
    assert rendered.endswith("…")
