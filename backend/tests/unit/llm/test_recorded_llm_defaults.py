"""The recorded fake answers every field with a reply its own output model accepts."""

from types import SimpleNamespace

import pytest

from app.llm.prompts import section_extraction
from app.llm.schema import build_output_models, dump_extraction
from tests.fakes.recorded_llm import RecordedLlm


def _field(name: str, values=None, *, ni: bool = False, na: bool = False, field_type="text"):
    return SimpleNamespace(
        name=name,
        field_type=field_type,
        is_required=False,
        allowed_values=values,
        llm_description=None,
        description=None,
        allows_no_information=ni,
        allows_not_applicable=na,
    )


async def _ask(fake: RecordedLlm, fields: list) -> dict:
    [model] = build_output_models(SimpleNamespace(id="et", fields=fields))
    output, _usage = await fake(
        output_model=model,
        system_prompt=section_extraction.SYSTEM_PROMPT,
        user_prompt="u",
        model=None,
        prompt_name=section_extraction.NAME,
        prompt_version=section_extraction.VERSION,
    )
    return dump_extraction(output)


@pytest.mark.parametrize("unclear", ["Unclear", "unclear"])
async def test_unscripted_uncertainty_scale_answers_its_unclear_code(unclear: str) -> None:
    reply = await _ask(RecordedLlm(), [_field("judgment", ["Low", "High", unclear], na=True)])
    assert reply["judgment"]["status"] == "ambiguous"
    assert reply["judgment"]["value"] == unclear
    assert reply["judgment"]["absent_reason"] is None


async def test_unscripted_multiselect_scale_answers_a_one_item_list() -> None:
    field = _field("tags", ["A", "Unclear"], field_type="multiselect")
    reply = await _ask(RecordedLlm(), [field])
    assert reply["tags"]["value"] == ["Unclear"]


async def test_unscripted_plain_field_answers_not_found_with_null_reason() -> None:
    reply = await _ask(RecordedLlm(), [_field("dose", ni=True), _field("route")])
    assert reply["dose"]["status"] == "not_found"
    assert reply["dose"]["absent_reason"] is None
    assert "absent_reason" not in reply["route"]


async def test_scripted_answer_gets_absent_reason_filled_unless_given() -> None:
    fake = RecordedLlm(
        fields={
            "dose": {"value": "5 mg"},
            "arm": {"value": None, "status": "not_found", "absent_reason": "not_applicable"},
        }
    )
    reply = await _ask(fake, [_field("dose", ni=True), _field("arm", na=True)])
    assert reply["dose"]["value"] == "5 mg"
    assert reply["dose"]["absent_reason"] is None
    assert reply["arm"]["absent_reason"] == "not_applicable"


async def test_scale_with_two_casings_of_unclear_answers_the_first() -> None:
    field = _field("judgment", ["Low", "unclear", "Unclear"])
    reply = await _ask(RecordedLlm(), [field])
    assert reply["judgment"]["value"] == "unclear"
