"""The portable template file carries the instrument code; a missing,
null or unknown code reads as ``custom`` and never refuses the file."""

from __future__ import annotations

from typing import Any

import pytest

from app.schemas.template_portable import PortableTemplate


def _doc(**extra: Any) -> dict[str, Any]:
    return {
        "prumo_template": 1,
        "kind": "extraction",
        "name": "Mini",
        "sections": [
            {
                "name": "sec1",
                "label": "S1",
                "fields": [{"name": "f1", "label": "F1", "type": "text"}],
            }
        ],
        **extra,
    }


def test_known_code_round_trips() -> None:
    parsed = PortableTemplate.model_validate(_doc(instrument="probast_ai"))
    assert parsed.instrument == "probast_ai"
    dumped = parsed.model_dump(mode="json", by_alias=True, exclude_defaults=True)
    assert dumped["instrument"] == "probast_ai"


def test_missing_code_reads_custom_and_is_omitted_on_export() -> None:
    parsed = PortableTemplate.model_validate(_doc())
    assert parsed.instrument == "custom"
    assert "instrument" not in parsed.model_dump(by_alias=True, exclude_defaults=True)


@pytest.mark.parametrize(
    "raw", ["bogus", None, 7, ["charms"], "CHARMS"], ids=["unknown", "null", "int", "list", "case"]
)
def test_unusable_code_reads_custom(raw: Any) -> None:
    assert PortableTemplate.model_validate(_doc(instrument=raw)).instrument == "custom"
