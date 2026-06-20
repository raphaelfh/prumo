"""Unit tests for the bake-off manifest loader/validator."""

from __future__ import annotations

import json

import pytest
from parsing_bakeoff.manifest import (
    EvalSet,
    ManifestError,
    load_manifest,
    parse_manifest,
)


def _valid() -> dict:
    return {
        "name": "clinical-eval-v1",
        "docs": [
            {
                "doc_id": "paper-001",
                "pdf_path": "papers/paper-001.pdf",
                "source_type": "born_digital",
                "gold": {
                    "tables": [["arm", "n", "events"], ["12", "98", "7"]],
                    "sections": ["Methods", "Results"],
                    "references": ["Smith 2021"],
                    "regions": [{"x": 10, "y": 20, "width": 100, "height": 50}],
                },
            }
        ],
    }


class TestParseManifest:
    def test_parses_a_valid_manifest(self) -> None:
        es = parse_manifest(_valid())
        assert isinstance(es, EvalSet)
        assert es.name == "clinical-eval-v1"
        assert len(es.docs) == 1
        doc = es.docs[0]
        assert doc.source_type == "born_digital"
        assert doc.gold.all_cells == ["arm", "n", "events", "12", "98", "7"]
        assert doc.gold.regions[0].area == 5000

    def test_gold_is_optional(self) -> None:
        data = _valid()
        del data["docs"][0]["gold"]
        doc = parse_manifest(data).docs[0]
        assert doc.gold.tables == [] and doc.gold.regions == []

    def test_rejects_unknown_source_type(self) -> None:
        data = _valid()
        data["docs"][0]["source_type"] = "powerpoint"
        with pytest.raises(ManifestError, match="source_type"):
            parse_manifest(data)

    def test_rejects_missing_doc_id(self) -> None:
        data = _valid()
        del data["docs"][0]["doc_id"]
        with pytest.raises(ManifestError, match="doc_id"):
            parse_manifest(data)

    def test_rejects_duplicate_doc_id(self) -> None:
        data = _valid()
        data["docs"].append(dict(data["docs"][0]))
        with pytest.raises(ManifestError, match="duplicate"):
            parse_manifest(data)

    def test_rejects_empty_docs(self) -> None:
        with pytest.raises(ManifestError, match="non-empty"):
            parse_manifest({"name": "x", "docs": []})

    def test_rejects_region_with_non_numeric_coord(self) -> None:
        data = _valid()
        data["docs"][0]["gold"]["regions"][0]["x"] = "left"
        with pytest.raises(ManifestError, match="non-numeric"):
            parse_manifest(data)


class TestLoadManifest:
    def test_round_trip_from_file(self, tmp_path) -> None:
        p = tmp_path / "manifest.json"
        p.write_text(json.dumps(_valid()), encoding="utf-8")
        assert load_manifest(p).docs[0].doc_id == "paper-001"

    def test_invalid_json_raises_manifest_error(self, tmp_path) -> None:
        p = tmp_path / "bad.json"
        p.write_text("{not json", encoding="utf-8")
        with pytest.raises(ManifestError, match="invalid JSON"):
            load_manifest(p)
