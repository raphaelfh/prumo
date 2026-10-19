"""The one prompt-name -> pass-kind map, and the snapshot entry built from it."""

import pytest

from app.llm.extractor import LlmUsage
from app.llm.pass_kinds import PASS_KIND_BY_PROMPT
from app.services.ai_extraction._model_calls import pass_detail


@pytest.mark.parametrize(
    ("prompt_name", "kind"),
    [
        ("section_extraction", "extract"),
        ("quality_assessment", "extract"),
        ("entry_identification", "identify"),
        ("verify_pass", "verify"),
        ("entailment_judge", "entailment"),
    ],
    ids=["section", "quality", "identify", "verify", "entailment"],
)
def test_every_prompt_name_maps_to_its_kind(prompt_name: str, kind: str) -> None:
    assert PASS_KIND_BY_PROMPT[prompt_name] == kind


def test_an_unknown_prompt_name_is_a_key_error() -> None:
    with pytest.raises(KeyError):
        PASS_KIND_BY_PROMPT["not_a_prompt"]
    with pytest.raises(KeyError):
        pass_detail("not_a_prompt", "v", LlmUsage())


def test_pass_detail_derives_the_kind_from_the_prompt_name() -> None:
    detail = pass_detail("verify_pass", "abc123abc123", LlmUsage(50, 5, ["v1"]))

    assert detail.model_dump() == {
        "kind": "verify",
        "prompt_name": "verify_pass",
        "prompt_version": "abc123abc123",
        "tokens": {"prompt": 50, "completion": 5, "total": 55},
        "request_ids": ["v1"],
    }
