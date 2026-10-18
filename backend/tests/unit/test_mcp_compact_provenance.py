"""`compact_provenance`: the MCP view of a landed generation snapshot is all
or nothing -- an older or malformed snapshot is `None`, never partial."""

from __future__ import annotations

from typing import Any

import pytest

from app.services.extraction_agent_evidence import compact_provenance


def _full() -> dict[str, Any]:
    return {
        "model": "gpt-x",
        "mode_executed": "fast",
        "prompt_version": "abcdefabcdef",
        "template_version": {"id": "t", "version": 2},
        "schema_sha256": "0123456789abcdef" * 4,
        "prompt_composition": {"article_ref": {"text_sha256": "f" * 64, "content_version": 5}},
    }


def test_full_snapshot_compacts():
    p = compact_provenance(_full())
    assert p is not None
    assert p.model_dump() == {
        "model": "gpt-x",
        "mode": "fast",
        "template_version": 2,
        "schema_sha256": "0123456789ab",
        "text_sha256": "ffffffffffff",
        "content_version": 5,
        "prompt_version": "abcdefabcdef",
    }


@pytest.mark.parametrize(
    "composition",
    [
        None,
        "bad",
        {"article_ref": "bad"},
        {"article_ref": {"text_sha256": 1, "content_version": True}},
    ],
    ids=["missing", "not-a-map", "ref-not-a-map", "wrong-types"],
)
def test_article_identity_may_be_null(composition):
    snapshot = _full()
    snapshot["prompt_composition"] = composition
    p = compact_provenance(snapshot)
    assert p is not None
    assert (p.text_sha256, p.content_version) == (None, None)


def _without(key: str) -> dict[str, Any]:
    snapshot = _full()
    del snapshot[key]
    return snapshot


@pytest.mark.parametrize(
    "snapshot",
    [
        None,
        {},
        _without("model"),
        _without("mode_executed"),
        _without("prompt_version"),
        _without("template_version"),
        _without("schema_sha256"),
        {**_full(), "mode_executed": "slow"},
        {**_full(), "template_version": {"version": True}},
        {**_full(), "template_version": 2},
        {**_full(), "model": ""},
    ],
    ids=[
        "none",
        "empty",
        "no-model",
        "no-mode",
        "no-prompt-version",
        "no-template-version",
        "no-schema-hash",
        "unknown-mode",
        "bool-version",
        "version-not-a-map",
        "empty-model",
    ],
)
def test_legacy_or_malformed_snapshot_is_none(snapshot):
    assert compact_provenance(snapshot) is None
