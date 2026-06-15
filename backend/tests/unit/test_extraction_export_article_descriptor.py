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
        run_stage=None,
        version_id=uuid4(),
        model_instances=(),
        section_instances={section_a: (i1, i2, i3)},
    )
    assert a.section_instances[section_a] == (i1, i2, i3)
    assert a.version_id is not None


def test_study_instances_alias_projects_first_instance_per_section() -> None:
    """Back-compat read alias for the not-yet-migrated builder: one id per
    section (the first), preserving the legacy dict[UUID, UUID] contract."""
    section_a, section_b = uuid4(), uuid4()
    i1, i2 = uuid4(), uuid4()
    a = ArticleDescriptor(
        article_id=uuid4(),
        header_label="X",
        run_id=uuid4(),
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={section_a: (i1, i2), section_b: ()},
    )
    # First instance projected; empty tuples are dropped (no value to show).
    assert a.study_instances == {section_a: i1}
