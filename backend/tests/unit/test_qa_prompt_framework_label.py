"""The QA system prompt names the instrument it is given.

Which name it is given — the template's, never the ``CUSTOM`` framework
enum — is pinned end to end in
``tests/integration/test_ai_extraction_prompts.py``.
"""

from app.llm.prompts import quality_assessment


def test_system_prompt_uses_given_label() -> None:
    assert "PROBAST+AI" in quality_assessment.system_prompt("PROBAST+AI")


def test_system_prompt_falls_back_when_label_missing() -> None:
    assert "the assessment tool" in quality_assessment.system_prompt(None)
