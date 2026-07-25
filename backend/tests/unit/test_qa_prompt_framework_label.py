"""The QA prompt must name the instrument, not the framework enum.

Every quality-assessment template is framework='CUSTOM' (the enum has only
CHARMS/PICOS/CUSTOM), so interpolating `template.framework` produced the
literal prompt "assessing a study using CUSTOM".
"""

from app.llm.prompts import quality_assessment
from app.services.section_extraction_service import _qa_framework_label


def test_system_prompt_uses_given_label() -> None:
    assert "PROBAST+AI" in quality_assessment.system_prompt("PROBAST+AI")


def test_system_prompt_falls_back_when_label_missing() -> None:
    assert "the assessment tool" in quality_assessment.system_prompt(None)


def test_label_prefers_template_name() -> None:
    class _Tpl:
        name = "PROBAST+AI"
        framework = "CUSTOM"

    assert _qa_framework_label(_Tpl()) == "PROBAST+AI"


def test_label_is_none_without_a_template() -> None:
    assert _qa_framework_label(None) is None


def test_label_falls_back_to_framework_when_name_blank() -> None:
    class _Tpl:
        name = "   "
        framework = "CHARMS"

    assert _qa_framework_label(_Tpl()) == "CHARMS"
