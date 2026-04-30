"""Unit tests for extraction_versioning models (no DB)."""

from uuid import uuid4

from app.models.extraction_versioning import (
    ConsensusRule,
    ExtractionHitlConfig,
    ExtractionTemplateVersion,
    HitlConfigScopeKind,
    TemplateKind,
)


def test_template_kind_enum_values() -> None:
    assert TemplateKind.EXTRACTION.value == "extraction"
    assert TemplateKind.QUALITY_ASSESSMENT.value == "quality_assessment"


def test_hitl_config_scope_kind_enum_values() -> None:
    assert HitlConfigScopeKind.PROJECT.value == "project"
    assert HitlConfigScopeKind.TEMPLATE.value == "template"


def test_consensus_rule_enum_values() -> None:
    assert ConsensusRule.UNANIMOUS.value == "unanimous"
    assert ConsensusRule.MAJORITY.value == "majority"
    assert ConsensusRule.ARBITRATOR.value == "arbitrator"


def test_extraction_template_version_instantiation() -> None:
    project_template_id = uuid4()
    published_by = uuid4()
    version = ExtractionTemplateVersion(
        project_template_id=project_template_id,
        version=1,
        schema_={"entity_types": [], "fields": []},
        published_by=published_by,
        is_active=True,
    )
    assert version.project_template_id == project_template_id
    assert version.version == 1
    assert version.is_active is True
    assert version.schema_ == {"entity_types": [], "fields": []}


def test_extraction_template_version_repr() -> None:
    version = ExtractionTemplateVersion(
        project_template_id=uuid4(),
        version=2,
        schema_={},
        published_by=uuid4(),
    )
    assert "ExtractionTemplateVersion" in repr(version)
    assert "version=2" in repr(version)


def test_extraction_hitl_config_instantiation_project_scope() -> None:
    scope_id = uuid4()
    config = ExtractionHitlConfig(
        scope_kind=HitlConfigScopeKind.PROJECT.value,
        scope_id=scope_id,
        reviewer_count=2,
        consensus_rule=ConsensusRule.ARBITRATOR.value,
        arbitrator_id=uuid4(),
    )
    assert config.scope_kind == "project"
    assert config.scope_id == scope_id
    assert config.reviewer_count == 2
    assert config.consensus_rule == "arbitrator"
    assert config.arbitrator_id is not None


def test_extraction_hitl_config_instantiation_template_scope_unanimous() -> None:
    config = ExtractionHitlConfig(
        scope_kind=HitlConfigScopeKind.TEMPLATE.value,
        scope_id=uuid4(),
        reviewer_count=1,
        consensus_rule=ConsensusRule.UNANIMOUS.value,
        arbitrator_id=None,
    )
    assert config.arbitrator_id is None
    assert config.consensus_rule == "unanimous"


def test_extraction_hitl_config_repr() -> None:
    config = ExtractionHitlConfig(
        scope_kind=HitlConfigScopeKind.PROJECT.value,
        scope_id=uuid4(),
        reviewer_count=2,
        consensus_rule=ConsensusRule.MAJORITY.value,
    )
    assert "ExtractionHitlConfig" in repr(config)
    assert "project" in repr(config)
    assert "majority" in repr(config)
