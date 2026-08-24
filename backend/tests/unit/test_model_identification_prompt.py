"""The identification prompt must see what has already been identified.

Matching alone does not fix the reported bug. ``model_name`` is free text,
so run 2 writes "Gradient Boosting" where run 1 wrote "XGBoost", the keys
differ, and the duplicate is recreated one layer down. The declared key
gives a deterministic place to compare; this prompt block is what makes
the compared value stable. The two halves are inseparable.

No string metric could link that pair — the edit distance is enormous.
The model that produced both names can, when shown what exists.
"""

from __future__ import annotations

from app.llm.prompts.model_identification import render


def test_prompt_lists_the_already_identified_entities() -> None:
    out = render(
        container_label="prediction models",
        article_text="…",
        existing_keys=["XGBoost", "Clinical-only baseline"],
    )
    assert "XGBoost" in out
    assert "Clinical-only baseline" in out


def test_prompt_asks_for_the_exact_existing_name() -> None:
    """Reuse hinges on the LLM returning the existing spelling verbatim."""
    out = render(
        container_label="prediction models", article_text="…", existing_keys=["XGBoost"]
    )
    assert "exact" in out.lower()


def test_prompt_omits_the_block_on_a_first_run() -> None:
    for keys in ([], None):
        out = render(container_label="prediction models", article_text="…", existing_keys=keys)
        assert "already been identified" not in out.lower()


def test_existing_keys_is_optional_for_callers_that_do_not_pass_it() -> None:
    out = render(container_label="prediction models", article_text="…")
    assert "prediction models" in out
