"""Pure unit test for the front-matter projection helper."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from app.models.extraction import ExtractionCardinality, ExtractionFieldType
from app.services.exports.descriptors import count_level_records
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
    _build_front_matter,
)


def _models() -> SectionDescriptor:
    return SectionDescriptor(
        entity_type_id=uuid4(),
        label="Models",
        parent_entity_type_id=None,
        fields=(
            FieldDescriptor(
                field_id=uuid4(),
                label="Name",
                type=ExtractionFieldType.TEXT,
                allowed_values=(),
            ),
        ),
        cardinality=ExtractionCardinality.MANY,
        sort_order=0,
    )


def test_front_matter_assembles_counts_and_obsolete() -> None:
    models = _models()
    aid = uuid4()
    article = ArticleDescriptor(
        article_id=aid,
        article_label="Gaca 2011",
        run_id=uuid4(),
        version_id=None,
        entries={(models.entity_type_id, None): (uuid4(), uuid4())},
    )
    fm = _build_front_matter(
        project_name="My Project",
        template_name="CHARMS",
        template_version=2,
        mode=ExportMode.CONSENSUS,
        generated_at=datetime(2026, 6, 14, tzinfo=UTC),
        articles=(article,),
        record_count=count_level_records((models,), (article,)),
        obsolete_fields_per_article={aid: ["Removed field"]},
    )
    assert fm.project_name == "My Project"
    assert fm.template_version == 2
    assert fm.export_mode_label  # non-empty human label
    assert fm.article_count == 1
    assert fm.record_count == 2  # two model records
    # legend + caveats are non-empty (generic glyph/sentinel legend)
    assert fm.legend
    assert fm.caveats
    assert fm.obsolete_fields_per_article[aid] == ("Removed field",)
