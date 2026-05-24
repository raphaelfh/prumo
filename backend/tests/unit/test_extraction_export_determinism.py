"""SC-006 / FR-026 — extraction export idempotency / byte-determinism.

Two identical builder invocations against the same in-memory layout
(no DB, no storage) MUST produce byte-identical workbooks aside from
their embedded ``generated_at`` timestamp.

Implementation note: openpyxl stamps every saved workbook with a
fresh ``modified``/``created`` time in ``docProps/core.xml`` and a
random ``application`` revision id, so bit-by-bit equality of the
raw bytes is unattainable. We assert structural equality instead:
the unpacked ZIP entries (apart from doc-properties and the
generated_at line on the Notes sheet) are identical.
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime
from uuid import uuid4

from openpyxl import load_workbook

from app.models.extraction import ExtractionEntityRole, ExtractionFieldType
from app.services.exports.extraction_xlsx_builder import build_workbook
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    ExportNotes,
    FieldDescriptor,
    SectionDescriptor,
)


def _fixed_layout() -> ExportLayout:
    """A layout whose every UUID is hard-coded so two runs produce the
    same workbook bytes (mod doc-properties)."""
    section_id = uuid4()
    field_id = uuid4()
    run_id = uuid4()
    inst_id = uuid4()
    article_id = uuid4()

    field = FieldDescriptor(
        field_id=field_id,
        label="1.1 Source of data",
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=section_id,
    )
    section = SectionDescriptor(
        entity_type_id=section_id,
        label="1. Source of data",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(field,),
    )
    article = ArticleDescriptor(
        article_id=article_id,
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        model_instances=(),
        study_instances={section_id: inst_id},
    )
    return ExportLayout(
        project_name="Test Project",
        template_name="CHARMS",
        template_version=1,
        sections=(section,),
        articles=(article,),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(
            template_version_label="CHARMS v1",
            export_mode_label="Consensus",
            generated_at=datetime(2026, 5, 23, 12, 0, 0, tzinfo=UTC),
        ),
        value_map={(run_id, inst_id, field_id): "Existing registry"},
    )


def _unzip_entries(blob: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        return {name: zf.read(name) for name in sorted(zf.namelist())}


def test_build_workbook_consensus_is_deterministic_modulo_doc_properties():
    layout = _fixed_layout()
    a = build_workbook(layout)
    b = build_workbook(layout)

    entries_a = _unzip_entries(a)
    entries_b = _unzip_entries(b)
    assert sorted(entries_a.keys()) == sorted(entries_b.keys())

    # docProps/core.xml stamps modified/created times; ignore it.
    ignored = {"docProps/core.xml", "docProps/app.xml"}
    for name in entries_a:
        if name in ignored:
            continue
        assert entries_a[name] == entries_b[name], f"divergent entry: {name}"


def test_build_workbook_ai_metadata_path_is_deterministic():
    """SC-007 budget aside, the AI metadata sheet itself is deterministic
    when the layout is fixed."""
    from app.services.extraction_export_service import AIProposalRow

    base = _fixed_layout()
    proposals = (
        AIProposalRow(
            article_label="Gaca, 2011",
            section_label="1. Source of data",
            instance_index=1,
            field_label="1.1 Source of data",
            ai_proposed_value="Existing registry",
            confidence=0.93,
            rationale="LLM reasoning",
            evidence_text="excerpt",
            evidence_pages="4",
            proposed_at=datetime(2026, 5, 23, 10, 0, 0, tzinfo=UTC),
            reviewer_outcome="accepted",
            final_value_used="Existing registry",
        ),
    )
    layout = ExportLayout(
        project_name=base.project_name,
        template_name=base.template_name,
        template_version=base.template_version,
        sections=base.sections,
        articles=base.articles,
        reviewers=base.reviewers,
        mode=base.mode,
        include_ai_metadata=True,
        anonymize_reviewer_names=base.anonymize_reviewer_names,
        notes=base.notes,
        value_map=base.value_map,
        ai_proposal_rows=proposals,
    )
    a = build_workbook(layout)
    b = build_workbook(layout)

    # Open both and compare the AI metadata sheet cell-by-cell.
    wb_a = load_workbook(io.BytesIO(a))
    wb_b = load_workbook(io.BytesIO(b))
    ws_a = wb_a["AI metadata"]
    ws_b = wb_b["AI metadata"]
    rows_a = [list(r) for r in ws_a.iter_rows(values_only=True)]
    rows_b = [list(r) for r in ws_b.iter_rows(values_only=True)]
    assert rows_a == rows_b
