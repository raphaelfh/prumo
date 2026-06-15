"""Pure unit test for the front-matter projection helper."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
    _build_front_matter,
    _build_tidy_tables,
)


def _study() -> SectionDescriptor:
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label="Study characteristics",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(
            FieldDescriptor(
                field_id=uuid4(),
                label="Author",
                type=ExtractionFieldType.TEXT,
                allowed_values=(),
                parent_section_id=eid,
            ),
        ),
        cardinality=ExtractionCardinality.ONE,
        sort_order=0,
    )


def test_front_matter_assembles_counts_contents_and_obsolete() -> None:
    study = _study()
    inst, run = uuid4(), uuid4()
    aid = uuid4()
    article = ArticleDescriptor(
        article_id=aid,
        header_label="Gaca, 2011",
        run_id=run,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={study.entity_type_id: (inst,)},
    )
    value_map = {(run, inst, study.fields[0].field_id): "Gaca"}
    tidy = _build_tidy_tables((study,), (article,), value_map, ExportMode.CONSENSUS)
    fm = _build_front_matter(
        project_name="My Project",
        template_name="CHARMS",
        template_version=2,
        mode=ExportMode.CONSENSUS,
        generated_at=datetime(2026, 6, 14, tzinfo=UTC),
        articles=(article,),
        tidy_tables=tidy,
        obsolete_fields_per_article={aid: ["Removed field"]},
    )
    assert fm.project_name == "My Project"
    assert fm.template_version == 2
    assert fm.export_mode_label  # non-empty human label
    assert fm.article_count == 1
    assert fm.record_count == 1  # one tidy row
    # contents lists the rendered sheet names incl. the tidy table title
    assert "README / Methods" in fm.contents
    assert "Study characteristics" in fm.contents
    # legend + caveats are non-empty (generic glyph/sentinel legend)
    assert fm.legend
    assert fm.caveats
    assert fm.obsolete_fields_per_article[aid] == ("Removed field",)
