"""Integration tests for HitlConfigRepository.upsert (#83).

The old SELECT-then-INSERT raced two concurrent first-time creates into a
unique-violation IntegrityError (HTTP 500). The repository now upserts via
``ON CONFLICT DO UPDATE`` on ``uq_extraction_hitl_configs_scope``. We can't
easily reproduce the concurrent race in a single transactional test, but we pin
the upsert semantics the ON CONFLICT path guarantees: idempotent on scope, and a
second call updates the existing row instead of inserting a duplicate.
"""

from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import ExtractionHitlConfig, HitlConfigScopeKind
from app.repositories.hitl_config_repository import HitlConfigRepository

pytestmark = pytest.mark.asyncio


async def test_upsert_inserts_then_updates_same_row(db_session: AsyncSession) -> None:
    repo = HitlConfigRepository(db_session)
    scope_id = uuid4()  # scope_id carries no FK

    created = await repo.upsert(
        HitlConfigScopeKind.PROJECT,
        scope_id,
        reviewer_count=2,
        consensus_rule="majority",
        arbitrator_id=None,
    )
    assert created.reviewer_count == 2
    assert created.consensus_rule == "majority"

    # Second call on the same scope must hit ON CONFLICT → update, not insert.
    updated = await repo.upsert(
        HitlConfigScopeKind.PROJECT,
        scope_id,
        reviewer_count=3,
        consensus_rule="unanimous",
        arbitrator_id=None,
    )
    assert updated.id == created.id
    assert updated.reviewer_count == 3
    assert updated.consensus_rule == "unanimous"

    # Exactly one row exists for the scope (no duplicate from the second call).
    count = (
        await db_session.execute(
            select(func.count())
            .select_from(ExtractionHitlConfig)
            .where(
                ExtractionHitlConfig.scope_kind == HitlConfigScopeKind.PROJECT.value,
                ExtractionHitlConfig.scope_id == scope_id,
            )
        )
    ).scalar_one()
    assert count == 1
