"""Integration tests for HitlConfigService."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import (
    ConsensusRule,
    ExtractionHitlConfig,
    HitlConfigScopeKind,
)
from app.services.hitl_config_service import (
    SYSTEM_DEFAULT_HITL_CONFIG,
    HitlConfigService,
)


@pytest.mark.asyncio
async def test_resolve_returns_system_default_when_no_config_exists(
    db_session: AsyncSession,
) -> None:
    project_id = uuid4()  # nonexistent
    template_id = uuid4()  # nonexistent
    service = HitlConfigService(db_session)
    snapshot = await service.resolve_snapshot(project_id, template_id)
    assert snapshot == SYSTEM_DEFAULT_HITL_CONFIG


@pytest.mark.asyncio
async def test_resolve_returns_project_config_when_template_has_none(
    db_session: AsyncSession,
) -> None:
    project_id = (
        await db_session.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    template_id = (
        await db_session.execute(
            text("SELECT id FROM public.project_extraction_templates LIMIT 1")
        )
    ).scalar()
    if not (project_id and template_id):
        pytest.skip("Need projects + project_extraction_templates fixtures.")

    # Clear any pre-existing configs for this project + template
    await db_session.execute(
        text(
            "DELETE FROM public.extraction_hitl_configs "
            "WHERE (scope_kind = 'project' AND scope_id = :pid) "
            "OR (scope_kind = 'template' AND scope_id = :tid)"
        ),
        {"pid": project_id, "tid": template_id},
    )
    await db_session.flush()

    db_session.add(
        ExtractionHitlConfig(
            scope_kind=HitlConfigScopeKind.PROJECT.value,
            scope_id=project_id,
            reviewer_count=2,
            consensus_rule=ConsensusRule.MAJORITY.value,
        )
    )
    await db_session.flush()

    service = HitlConfigService(db_session)
    snapshot = await service.resolve_snapshot(project_id, template_id)
    assert snapshot["scope_kind"] == "project"
    assert snapshot["reviewer_count"] == 2
    assert snapshot["consensus_rule"] == "majority"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_resolve_template_overrides_project(
    db_session: AsyncSession,
) -> None:
    project_id = (
        await db_session.execute(text("SELECT id FROM public.projects LIMIT 1"))
    ).scalar()
    template_id = (
        await db_session.execute(
            text("SELECT id FROM public.project_extraction_templates LIMIT 1")
        )
    ).scalar()
    profile_id = (
        await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    if not (project_id and template_id and profile_id):
        pytest.skip("Need projects + templates + profiles fixtures.")

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_hitl_configs "
            "WHERE (scope_kind = 'project' AND scope_id = :pid) "
            "OR (scope_kind = 'template' AND scope_id = :tid)"
        ),
        {"pid": project_id, "tid": template_id},
    )
    await db_session.flush()

    db_session.add(
        ExtractionHitlConfig(
            scope_kind=HitlConfigScopeKind.PROJECT.value,
            scope_id=project_id,
            reviewer_count=2,
            consensus_rule=ConsensusRule.MAJORITY.value,
        )
    )
    db_session.add(
        ExtractionHitlConfig(
            scope_kind=HitlConfigScopeKind.TEMPLATE.value,
            scope_id=template_id,
            reviewer_count=3,
            consensus_rule=ConsensusRule.ARBITRATOR.value,
            arbitrator_id=profile_id,
        )
    )
    await db_session.flush()

    service = HitlConfigService(db_session)
    snapshot = await service.resolve_snapshot(project_id, template_id)
    assert snapshot["scope_kind"] == "template"
    assert snapshot["reviewer_count"] == 3
    assert snapshot["consensus_rule"] == "arbitrator"
    assert snapshot["arbitrator_id"] == str(profile_id)
    await db_session.rollback()
