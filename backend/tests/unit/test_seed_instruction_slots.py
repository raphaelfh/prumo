"""Seeded template AI instructions carry no review-question slot.

The project's review question already reaches every prompt, so a seeded
default that asks the manager to retype it is noise. The retired defaults are
kept verbatim (with their slot) so the backfill can recognize an unedited one.
"""

import pytest

from app import seed_instruction_defaults as defaults
from app.seed import (
    _CHARMS_TEMPLATE_ID,
    _LLM_TEMPLATE_INSTRUCTIONS,
    _MM_TEMPLATE_ID,
    _PROBAST_TEMPLATE_ID,
    _QUADAS2_TEMPLATE_ID,
)

_CURRENT = {
    "CHARMS_INSTRUCTION": defaults.CHARMS_INSTRUCTION,
    "CHARMS_MM_INSTRUCTION": defaults.CHARMS_MM_INSTRUCTION,
    "PROBAST_INSTRUCTION": defaults.PROBAST_INSTRUCTION,
    "QUADAS2_INSTRUCTION": defaults.QUADAS2_INSTRUCTION,
    "PROBAST_AI_INSTRUCTION": defaults.PROBAST_AI_INSTRUCTION,
}
_RETIRED = {
    "RETIRED_CHARMS_INSTRUCTION": defaults.RETIRED_CHARMS_INSTRUCTION,
    "RETIRED_CHARMS_MM_INSTRUCTION": defaults.RETIRED_CHARMS_MM_INSTRUCTION,
    "RETIRED_PROBAST_INSTRUCTION": defaults.RETIRED_PROBAST_INSTRUCTION,
    "RETIRED_QUADAS2_INSTRUCTION": defaults.RETIRED_QUADAS2_INSTRUCTION,
    "RETIRED_PROBAST_AI_INSTRUCTION": defaults.RETIRED_PROBAST_AI_INSTRUCTION,
}


@pytest.mark.parametrize("name", list(_CURRENT), ids=list(_CURRENT))
def test_current_default_has_no_customize_slot(name: str) -> None:
    text = _CURRENT[name]
    assert text.strip()
    assert "[customize:" not in text
    assert "review question and scope" in text
    assert "settings" not in text


@pytest.mark.parametrize("name", list(_RETIRED), ids=list(_RETIRED))
def test_retired_default_is_the_verbatim_slotted_text(name: str) -> None:
    assert "[customize:" in _RETIRED[name]


def test_seed_maps_template_ids_to_the_current_defaults() -> None:
    assert _LLM_TEMPLATE_INSTRUCTIONS == {
        _CHARMS_TEMPLATE_ID: defaults.CHARMS_INSTRUCTION,
        _MM_TEMPLATE_ID: defaults.CHARMS_MM_INSTRUCTION,
        _PROBAST_TEMPLATE_ID: defaults.PROBAST_INSTRUCTION,
        _QUADAS2_TEMPLATE_ID: defaults.QUADAS2_INSTRUCTION,
    }
