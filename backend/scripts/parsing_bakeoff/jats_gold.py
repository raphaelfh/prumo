"""Build bake-off gold labels from PMC JATS XML (open-access full text).

PubMed Central's JATS XML is the cleanest ground truth available for an
open-access paper: ``<sec><title>`` → section headings, ``<table-wrap>`` …
``<td|th>`` → table cells, ``<ref>`` → references. This lets the evaluation set
be provisioned reproducibly from open-access sources — no PHI, no manual
labelling. Parsing is namespace-agnostic (JATS files vary).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass

from parsing_bakeoff.manifest import GoldLabels


def _local(tag: str) -> str:
    """Local tag name, stripping any ``{namespace}`` prefix."""
    return tag.rsplit("}", 1)[-1]


def _text(el: ET.Element) -> str:
    """All descendant text of an element, whitespace-collapsed."""
    return " ".join(" ".join(t.split()) for t in el.itertext() if t and t.strip())


def _iter_local(root: ET.Element, name: str) -> list[ET.Element]:
    return [el for el in root.iter() if _local(el.tag) == name]


@dataclass
class JatsGold:
    title: str
    sections: list[str]
    tables: list[list[str]]
    references: list[str]


def parse_jats(xml: str) -> JatsGold:
    """Parse a JATS XML string into structured gold labels."""
    root = ET.fromstring(xml)  # noqa: S314 - OA PMC XML; ET does not resolve external entities

    title_els = _iter_local(root, "article-title")
    title = _text(title_els[0]) if title_els else ""

    sections: list[str] = []
    for sec in _iter_local(root, "sec"):
        for child in sec:
            if _local(child.tag) == "title":
                heading = _text(child)
                if heading:
                    sections.append(heading)
                break

    tables: list[list[str]] = []
    for wrap in _iter_local(root, "table-wrap"):
        cells = [_text(c) for c in wrap.iter() if _local(c.tag) in ("td", "th")]
        cells = [c for c in cells if c]
        if cells:
            tables.append(cells)

    references: list[str] = []
    for ref in _iter_local(root, "ref"):
        txt = _text(ref)
        if txt:
            references.append(txt)

    return JatsGold(title=title, sections=sections, tables=tables, references=references)


def gold_from_jats(xml: str) -> GoldLabels:
    """JATS XML → ``GoldLabels`` (no bbox regions: XML carries no coordinates)."""
    parsed = parse_jats(xml)
    return GoldLabels(
        tables=parsed.tables,
        sections=parsed.sections,
        references=parsed.references,
    )
