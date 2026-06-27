"""Gold-corpus manifest loader for the citation eval harness.

The manifest is a JSON file (kept on an approved, non-public surface).
Shape::

    {
      "doc_id": "pmc123",
      "fields": [
        {
          "name": "dose",
          "gold_value": "50 mg",
          "supporting_spans": ["patients got 50 mg"]
        }
      ]
    }

The harness ships no documents and no manifest; this module only loads one.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class GoldField:
    name: str
    gold_value: str
    supporting_spans: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class GoldDoc:
    doc_id: str
    fields: list[GoldField] = field(default_factory=list)


def load_manifest(path: str | Path) -> GoldDoc:
    """Read and parse a gold manifest JSON file into a ``GoldDoc``."""
    text = Path(path).read_text(encoding="utf-8")
    data = json.loads(text)
    return GoldDoc(
        doc_id=str(data["doc_id"]),
        fields=[
            GoldField(
                name=str(f["name"]),
                gold_value=str(f["gold_value"]),
                supporting_spans=[str(s) for s in f.get("supporting_spans", [])],
            )
            for f in data.get("fields", [])
        ],
    )
