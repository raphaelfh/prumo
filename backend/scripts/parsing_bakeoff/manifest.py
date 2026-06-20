"""Evaluation-set manifest: the frozen list of labelled papers to score.

The manifest is a JSON file (kept on an approved, non-public surface — see
README). It names each document, its source type, and the human-labelled
ground truth used by ``scoring``. The harness ships no documents and no
manifest; this module only loads and validates one.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from parsing_bakeoff.scoring import Box

#: Input classes ADR-0011 puts in scope.
SOURCE_TYPES: frozenset[str] = frozenset({"born_digital", "scanned", "jats"})


class ManifestError(ValueError):
    """Raised when a manifest is missing required fields or malformed."""


@dataclass(frozen=True)
class GoldLabels:
    """Human-labelled ground truth for one document."""

    #: Each table is a flat list of its cell strings (reading order).
    tables: list[list[str]] = field(default_factory=list)
    sections: list[str] = field(default_factory=list)
    references: list[str] = field(default_factory=list)
    #: Gold table/figure regions (PDF user space) for bbox correctness.
    regions: list[Box] = field(default_factory=list)

    @property
    def all_cells(self) -> list[str]:
        return [cell for table in self.tables for cell in table]


@dataclass(frozen=True)
class EvalDoc:
    doc_id: str
    pdf_path: str
    source_type: str
    gold: GoldLabels


@dataclass(frozen=True)
class EvalSet:
    name: str
    docs: list[EvalDoc]


def _require(obj: dict[str, Any], key: str, where: str) -> Any:
    if key not in obj:
        raise ManifestError(f"{where}: missing required key {key!r}")
    return obj[key]


def _box_from(raw: Any, where: str) -> Box:
    if not isinstance(raw, dict):
        raise ManifestError(f"{where}: region must be an object, got {type(raw).__name__}")
    try:
        return Box(
            x=float(raw["x"]),
            y=float(raw["y"]),
            width=float(raw["width"]),
            height=float(raw["height"]),
        )
    except KeyError as exc:
        raise ManifestError(f"{where}: region missing key {exc.args[0]!r}") from exc
    except (TypeError, ValueError) as exc:
        raise ManifestError(f"{where}: region has non-numeric coordinate ({exc})") from exc


def _gold_from(raw: Any, where: str) -> GoldLabels:
    if raw is None:
        return GoldLabels()
    if not isinstance(raw, dict):
        raise ManifestError(f"{where}: 'gold' must be an object")
    tables = raw.get("tables", [])
    if not all(isinstance(t, list) for t in tables):
        raise ManifestError(f"{where}: 'gold.tables' must be a list of lists")
    return GoldLabels(
        tables=[[str(c) for c in table] for table in tables],
        sections=[str(s) for s in raw.get("sections", [])],
        references=[str(r) for r in raw.get("references", [])],
        regions=[_box_from(b, where) for b in raw.get("regions", [])],
    )


def parse_manifest(data: dict[str, Any]) -> EvalSet:
    """Validate an already-decoded manifest dict into an ``EvalSet``."""
    name = str(_require(data, "name", "manifest"))
    raw_docs = _require(data, "docs", "manifest")
    if not isinstance(raw_docs, list) or not raw_docs:
        raise ManifestError("manifest: 'docs' must be a non-empty list")

    docs: list[EvalDoc] = []
    seen: set[str] = set()
    for i, raw in enumerate(raw_docs):
        where = f"docs[{i}]"
        if not isinstance(raw, dict):
            raise ManifestError(f"{where}: must be an object")
        doc_id = str(_require(raw, "doc_id", where))
        if doc_id in seen:
            raise ManifestError(f"{where}: duplicate doc_id {doc_id!r}")
        seen.add(doc_id)
        source_type = str(_require(raw, "source_type", where))
        if source_type not in SOURCE_TYPES:
            raise ManifestError(
                f"{where}: source_type {source_type!r} not in {sorted(SOURCE_TYPES)}"
            )
        docs.append(
            EvalDoc(
                doc_id=doc_id,
                pdf_path=str(_require(raw, "pdf_path", where)),
                source_type=source_type,
                gold=_gold_from(raw.get("gold"), where),
            )
        )
    return EvalSet(name=name, docs=docs)


def load_manifest(path: str | Path) -> EvalSet:
    """Read + validate a manifest JSON file into an ``EvalSet``."""
    text = Path(path).read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ManifestError(f"{path}: invalid JSON ({exc})") from exc
    if not isinstance(data, dict):
        raise ManifestError(f"{path}: top level must be a JSON object")
    return parse_manifest(data)
