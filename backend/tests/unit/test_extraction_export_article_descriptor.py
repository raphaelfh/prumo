"""Unit tests for the grown ArticleDescriptor (spec §5.1/§6 medium bug)."""

from __future__ import annotations

from uuid import uuid4

from app.services.extraction_export_service import ArticleDescriptor


def test_article_descriptor_carries_version_id_and_ordered_instances() -> None:
    section_a = uuid4()
    i1, i2, i3 = uuid4(), uuid4(), uuid4()
    a = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=uuid4(),
        version_id=uuid4(),
        model_instances=(),
        section_instances={section_a: (i1, i2, i3)},
    )
    assert a.section_instances[section_a] == (i1, i2, i3)
    assert a.version_id is not None
