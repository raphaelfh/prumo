"""Every backend option reader delegates to ``normalize_options``.

A legacy bare-string option list and its canonical ``{value, label}`` form must
read identically through each reader, and the ``{"options": [...]}`` wrapper is
tolerated everywhere (pure, no IO). ``_diff._option_codes`` is pinned in
``test_template_diff.py``, the one unit file allowed to import that private
module.
"""

from types import SimpleNamespace

import pytest

from app.api.mcp.tools.templates import _options
from app.llm.prompts.entry_identification import _allowed_value_names
from app.llm.schema import _enum_values
from app.schemas.mcp_templates import McpOption
from app.services.exports.extraction_snapshot_reader import (
    AllowedValue,
    _normalize_allowed_values,
)
from app.services.value_semantics import _option_values

LEGACY = ["development_only", "validation_only"]
CANONICAL = [
    {"value": "development_only", "label": "development_only"},
    {"value": "validation_only", "label": "validation_only"},
]
WRAPPED = {"options": LEGACY}
CODES = ["development_only", "validation_only"]


@pytest.mark.parametrize(
    "raw", [LEGACY, CANONICAL, WRAPPED], ids=["legacy", "canonical", "wrapped"]
)
class TestReadersAgreeAcrossShapes:
    def test_entry_identification_names(self, raw: object) -> None:
        assert _allowed_value_names(raw) == CODES

    def test_snapshot_reader_pairs(self, raw: object) -> None:
        assert _normalize_allowed_values(raw) == tuple(
            AllowedValue(value=code, label=code) for code in CODES
        )

    def test_value_semantics_option_values(self, raw: object) -> None:
        assert _option_values(raw) == set(CODES)

    def test_schema_enum_values(self, raw: object) -> None:
        assert _enum_values(SimpleNamespace(allowed_values=raw)) == CODES

    def test_mcp_template_options(self, raw: object) -> None:
        assert _options(raw) == [McpOption(value=code, label=code) for code in CODES]


def test_readers_use_value_as_code_and_label_for_display() -> None:
    coded = [{"value": "Y", "label": "Yes"}, {"label": "No information"}]
    assert _allowed_value_names(coded) == ["Y", "No information"]
    assert _options(coded) == [
        McpOption(value="Y", label="Yes"),
        McpOption(value="No information", label="No information"),
    ]
    assert _normalize_allowed_values(coded) == (
        AllowedValue(value="Y", label="Yes"),
        AllowedValue(value="No information", label="No information"),
    )


def test_mcp_template_options_empty_is_none() -> None:
    assert _options(None) is None
    assert _options([]) is None
