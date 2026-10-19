"""Schema hardening from migration 0086: evidence workflow-link indexes and
HITL configuration scope foreign keys."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import (
    ConsensusRule,
    ExtractionHitlConfig,
    HitlConfigScopeKind,
)

_EVIDENCE_INDEXES = {
    "idx_extraction_evidence_proposal_record_id",
    "idx_extraction_evidence_reviewer_decision_id",
    "idx_extraction_evidence_consensus_decision_id",
}


@pytest.mark.asyncio
async def test_evidence_workflow_links_are_indexed(db_session: AsyncSession) -> None:
    names = set(
        (
            await db_session.execute(
                text(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE schemaname = 'public' AND tablename = 'extraction_evidence'"
                )
            )
        )
        .scalars()
        .all()
    )
    assert names >= _EVIDENCE_INDEXES


@pytest.mark.asyncio
async def test_hitl_scope_foreign_keys_cascade(db_session: AsyncSession) -> None:
    rows = dict(
        (
            await db_session.execute(
                text(
                    "SELECT conname, confdeltype::text FROM pg_constraint "
                    "WHERE conname IN ('fk_hitl_configs_scope_project', "
                    "'fk_hitl_configs_scope_template')"
                )
            )
        ).all()
    )
    assert rows == {
        "fk_hitl_configs_scope_project": "c",
        "fk_hitl_configs_scope_template": "c",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "scope_kind",
    [HitlConfigScopeKind.PROJECT, HitlConfigScopeKind.TEMPLATE],
    ids=["project", "template"],
)
async def test_hitl_config_for_missing_scope_is_refused(
    db_session: AsyncSession, scope_kind: HitlConfigScopeKind
) -> None:
    db_session.add(
        ExtractionHitlConfig(
            scope_kind=scope_kind.value,
            scope_id=uuid4(),
            reviewer_count=1,
            consensus_rule=ConsensusRule.UNANIMOUS.value,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()
