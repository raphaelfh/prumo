"""The identification prompt is parameterized by the pinned group.

One prompt serves every repeating group — the model container, a top-level
list of predictors, a per-model table of validation blocks — so it has to
say which section, what one entry is called, which field identifies an
entry, and what the section's own instruction is. And it must see what has
already been identified: matching alone does not fix the reported bug. A
free-text key drifts ("XGBoost" then "Gradient Boosting"), the keys differ,
and the duplicate is recreated one layer down; the model that produced both
names can align them when shown what exists.
"""

from __future__ import annotations

from app.llm.prompts.entry_identification import render, system_prompt


def _render(**overrides: object) -> str:
    kwargs: dict[str, object] = {
        "group_label": "Numeric performance",
        "entry_label": "validation",
        "key_label": "Validation type",
        "article_text": "…",
    }
    kwargs.update(overrides)
    return render(**kwargs)  # type: ignore[arg-type]


def test_prompt_names_the_group_the_noun_and_the_key() -> None:
    out = _render()
    assert 'for the section "Numeric performance"' in out
    assert "identify every validation" in out
    assert "return its Validation type exactly as the article states it" in out
    assert "tells one validation apart from another" in out


def test_system_prompt_names_the_noun() -> None:
    assert "validation entries" in system_prompt("validation")
    assert "model entries" in system_prompt("model")


def test_section_instruction_is_carried_when_present_and_absent_otherwise() -> None:
    with_it = _render(instruction="  Report every validation set separately. ")
    assert "Section instructions: Report every validation set separately." in with_it
    for absent in (None, "", "   "):
        assert "Section instructions" not in _render(instruction=absent)


def test_a_choice_key_lists_its_allowed_values() -> None:
    out = _render(allowed_values=["apparent", "internal", "external"])
    assert "The Validation type must be one of: apparent, internal, external." in out


def test_allowed_values_accept_the_value_label_object_shape() -> None:
    out = _render(
        allowed_values=[
            {"value": "int", "label": "Internal"},
            {"value": "ext", "label": "External"},
        ]
    )
    assert "must be one of: int, ext." in out


def test_a_free_text_key_lists_no_choices() -> None:
    for none in (None, [], {"not": "a list"}):
        assert "must be one of" not in _render(allowed_values=none)


def test_prompt_lists_the_already_identified_entities() -> None:
    out = _render(existing_keys=["XGBoost", "Clinical-only baseline"])
    assert "- XGBoost" in out
    assert "- Clinical-only baseline" in out
    assert "Some validation entries in this article have already been identified" in out


def test_prompt_asks_for_the_exact_existing_key() -> None:
    """Reuse hinges on the LLM returning the existing spelling verbatim."""
    out = _render(existing_keys=["XGBoost"])
    assert "EXACT existing Validation type" in out


def test_prompt_omits_the_block_on_a_first_run() -> None:
    for keys in ([], None):
        assert "already been identified" not in _render(existing_keys=keys).lower()


def test_a_nested_group_is_scoped_to_its_parent_entry() -> None:
    """Extraction per entry was already scoped to the parent (the entry-scope
    block); identification was not, so model A's validation table listed
    model B's validations too — and each got an instance under A."""
    out = _render(parent_label="XGBoost")
    assert 'Only the validation entries that belong to "XGBoost" count here' in out
    assert "leave out those the article reports for anything else" in out


def test_a_top_level_group_carries_no_parent_clause() -> None:
    for absent in (None, ""):
        assert "belong to" not in _render(parent_label=absent)
