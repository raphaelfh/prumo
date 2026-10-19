"""The grounding validator sends evidence back (bounded) when its block ref
is unknown or its quote is not inside the cited window."""

from types import SimpleNamespace

import pytest
from pydantic_ai import ModelRetry

from app.domain.evidence_block_refs import BlockRefIndex
from app.infrastructure.parsing.base import ParsedBlock
from app.llm.schema import build_output_models
from app.llm.validators import GroundingStats, evidence_grounding_validator

_INDEX = BlockRefIndex(
    [
        ParsedBlock(
            page_number=2,
            block_index=0,
            text="We enrolled 142 adults.",
            char_start=0,
            char_end=0,
            bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
            block_type="paragraph",
        )
    ]
)


def _instance(evidence_list):
    field = SimpleNamespace(
        name="population",
        field_type="text",
        llm_description="d",
        description=None,
        allowed_values=None,
        is_required=False,
    )
    [model] = build_output_models(SimpleNamespace(name="s", description="", fields=[field]))
    return model.model_validate(
        {
            "population": {
                "value": "x",
                "confidence": 0.5,
                "reasoning": None,
                "evidence": evidence_list,
                "status": "found",
            }
        }
    )


def _ctx(retry: int = 0, max_retries: int = 2) -> SimpleNamespace:
    return SimpleNamespace(retry=retry, max_retries=max_retries)


def test_good_ref_and_in_window_quote_passes() -> None:
    stats = GroundingStats()
    output = _instance([{"block_ref": "p2·b0", "quote": "enrolled 142  adults"}])
    assert evidence_grounding_validator(_INDEX, stats)(_ctx(), output) is output
    assert stats.retried == 0


def test_unknown_ref_raises_model_retry_while_retries_remain() -> None:
    stats = GroundingStats()
    output = _instance([{"block_ref": "p9·b4", "quote": "We enrolled 142 adults."}])
    with pytest.raises(ModelRetry, match=r"population.*evidence\[0\].*p9·b4"):
        evidence_grounding_validator(_INDEX, stats)(_ctx(), output)
    assert stats.retried == 1


def test_quote_outside_window_raises() -> None:
    output = _instance(
        [
            {"block_ref": "p2·b0", "quote": "We enrolled 142 adults."},
            {"block_ref": "p2·b0", "quote": "a sentence the block lacks"},
        ]
    )
    with pytest.raises(ModelRetry, match=r"population.*evidence\[1\]"):
        evidence_grounding_validator(_INDEX)(_ctx(retry=1), output)


def test_last_attempt_passes_bad_output_through_unchanged() -> None:
    stats = GroundingStats()
    output = _instance([{"block_ref": "garbage", "quote": "  "}])
    assert evidence_grounding_validator(_INDEX, stats)(_ctx(retry=2), output) is output
    assert stats.retried == 0
