"""Unit tests for the README/Methods (front-matter) sub-builder. Pure — no DB."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from app.services.exports.extraction.front_matter import build_front_matter
from app.services.extraction_export_service import (
    ExportLayout,
    ExportMode,
    ExportNotes,
    FrontMatter,
)


def _layout_with_front_matter(fm: FrontMatter) -> ExportLayout:
    return ExportLayout(
        project_name=fm.project_name,
        template_name=fm.template_name,
        template_version=fm.template_version,
        sections=(),
        articles=(),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(),
        value_map={},
        front_matter=fm,
    )


def _front_matter() -> FrontMatter:
    return FrontMatter(
        project_name="My SR Project",
        template_name="CHARMS",
        template_version=3,
        export_mode_label="Consensus",
        generated_at=datetime(2026, 6, 14, 9, 30, 0, tzinfo=UTC),
        article_count=12,
        record_count=20,
        contents=("README / Methods", "Summary", "CHARMS", "Study characteristics"),
        legend=(("(blank)", "No value / rejected"), ("No information", "Reported as not stated")),
        caveats=("Reviewer outcomes labelled best-effort rely on heuristics.",),
        obsolete_fields_per_article={},
    )


def _flat(spec) -> str:
    return " \n ".join(
        " | ".join("" if c.value is None else str(c.value) for c in row) for row in spec.rows
    )


def test_front_matter_renders_identity_block():
    spec = build_front_matter(_layout_with_front_matter(_front_matter()))
    flat = _flat(spec)
    assert spec.title == "README"
    assert "My SR Project" in flat
    assert "CHARMS" in flat
    assert "v3" in flat
    assert "Consensus" in flat
    assert "2026-06-14" in flat
    assert "12" in flat  # article count
    assert "20" in flat  # record count


def test_front_matter_lists_contents_and_legend():
    spec = build_front_matter(_layout_with_front_matter(_front_matter()))
    flat = _flat(spec)
    assert "Summary" in flat
    assert "Study characteristics" in flat
    assert "No information" in flat
    assert "Reported as not stated" in flat
    assert "best-effort" in flat.lower()


def test_production_legend_carries_three_disposition_rows_matching_resolve_value():
    # ADR-0016 Phase 4: the front-matter legend must explain all THREE coded
    # dispositions with the EXACT label resolve_value emits into a cell, so a
    # marker cell and its legend row can never drift. The label column is derived
    # from the single ABSENT_REASON_LABELS source (see extraction_export_service);
    # this pins both the frozen descriptions and the cell↔legend parity.
    from app.services.exports.value_envelope import resolve_value
    from app.services.extraction_export_service import _FRONT_MATTER_LEGEND
    from app.services.value_semantics import AbsentReason

    legend = dict(_FRONT_MATTER_LEGEND)
    assert legend["No information"] == "The source does not state this item."
    assert legend["Not applicable"] == "The item does not apply to this study."
    assert legend["Not evaluated"] == "The item was not assessed."
    # (blank) keeps its distinct "no value / rejected" meaning.
    assert "(blank)" in legend
    # Anti-drift: the label resolve_value emits for every code IS a legend row.
    for code in AbsentReason:
        label = resolve_value({"value": None, "absent_reason": code.value})
        assert label in legend, f"{code.value} label {label!r} missing from legend"


def test_front_matter_renders_obsolete_fields_block():
    aid = uuid4()
    fm = _front_matter()
    fm = FrontMatter(
        project_name=fm.project_name,
        template_name=fm.template_name,
        template_version=fm.template_version,
        export_mode_label=fm.export_mode_label,
        generated_at=fm.generated_at,
        article_count=fm.article_count,
        record_count=fm.record_count,
        contents=fm.contents,
        legend=fm.legend,
        caveats=fm.caveats,
        obsolete_fields_per_article={aid: ("Old field A", "Old field B")},
    )
    spec = build_front_matter(_layout_with_front_matter(fm))
    flat = _flat(spec)
    assert "Old field A" in flat
    assert "Old field B" in flat
    assert str(aid) in flat


def test_front_matter_handles_missing_front_matter_gracefully():
    layout = ExportLayout(
        project_name="P",
        template_name="T",
        template_version=1,
        sections=(),
        articles=(),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(),
        value_map={},
        front_matter=None,
    )
    spec = build_front_matter(layout)
    # Falls back to layout fields; never raises.
    assert "T" in _flat(spec)
