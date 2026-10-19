"""Migration 0085 — template QA rules backfilled into existing version snapshots.

Runs the migration's UPDATE inside the savepoint-isolated ``db_session``.
The statement is table-wide, so the database's own seeded versions are
touched too (and rolled back); every assertion here is per row, on rows
this test creates or plants.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.helpers.migrations import load_migration
from tests.integration.helpers.template_fixtures import fresh_charms

_mig = load_migration("0085_freeze_qa_rules.py")

_RULES = {"derived_judgments": [{"x": 1}], "scope_rules": {"a": 1}}


async def _set_template_schema(db: AsyncSession, template_id: UUID, schema: Any) -> None:
    await db.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET schema = CAST(:schema AS jsonb) WHERE id = :tid"
        ),
        {"schema": json.dumps(schema), "tid": str(template_id)},
    )


async def _version_schema(db: AsyncSession, version_id: UUID) -> dict[str, Any]:
    return (
        await db.execute(
            text("SELECT schema FROM public.extraction_template_versions WHERE id = :id"),
            {"id": str(version_id)},
        )
    ).scalar_one()


async def _active_version(db: AsyncSession, template_id: UUID) -> UUID:
    return (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()


async def _version_count(db: AsyncSession) -> int:
    return (
        await db.execute(text("SELECT count(*) FROM public.extraction_template_versions"))
    ).scalar_one()


async def _upgrade(db: AsyncSession) -> int:
    return (await db.execute(text(_mig.UPGRADE_SQL))).rowcount


@pytest.mark.asyncio
async def test_backfills_template_rules_into_existing_versions(db_session: AsyncSession) -> None:
    _, template_id, _ = await fresh_charms(db_session)
    await _set_template_schema(db_session, template_id, _RULES)
    active = await _active_version(db_session, template_id)
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions "
            "SET schema = schema - 'derived_judgments' - 'scope_rules' WHERE id = :id"
        ),
        {"id": str(active)},
    )
    older = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "VALUES (:id, :tid, 999, CAST(:schema AS jsonb), :pub, false)"
        ),
        {
            "id": str(older),
            "tid": str(template_id),
            "schema": json.dumps({"entity_types": [], "scope_rules": {"own": 1}}),
            "pub": str(SEED.primary_profile),
        },
    )
    count_before = await _version_count(db_session)

    assert await _upgrade(db_session) > 0

    active_schema = await _version_schema(db_session, active)
    assert active_schema["derived_judgments"] == [{"x": 1}]
    assert active_schema["scope_rules"] == {"a": 1}
    assert active_schema["entity_types"], "the frozen tree is kept"
    older_schema = await _version_schema(db_session, older)
    assert older_schema["scope_rules"] == {"own": 1}, "a version's own key wins"
    assert older_schema["derived_judgments"] == [{"x": 1}]
    assert await _version_count(db_session) == count_before, "no version is created"
    assert await _upgrade(db_session) == 0, "idempotent"


@pytest.mark.asyncio
async def test_empty_template_rules_add_no_keys(db_session: AsyncSession) -> None:
    _, template_id, _ = await fresh_charms(db_session)
    await _set_template_schema(
        db_session, template_id, {"derived_judgments": [], "scope_rules": {}}
    )
    active = await _active_version(db_session, template_id)
    before = await _version_schema(db_session, active)
    assert "derived_judgments" not in before and "scope_rules" not in before

    await _upgrade(db_session)

    assert await _version_schema(db_session, active) == before


@pytest.mark.asyncio
async def test_backfill_stamps_no_config_draft(db_session: AsyncSession) -> None:
    """A snapshot backfill is not a config edit: no template gets ``config_draft_since``."""
    _, template_id, _ = await fresh_charms(db_session)
    await _set_template_schema(db_session, template_id, _RULES)
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates SET config_draft_since = NULL "
            "WHERE id = :tid"
        ),
        {"tid": str(template_id)},
    )

    await _upgrade(db_session)

    marker = (
        await db_session.execute(
            text(
                "SELECT config_draft_since FROM public.project_extraction_templates WHERE id = :tid"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()
    assert marker is None


@pytest.mark.asyncio
async def test_downgrade_strips_the_rules_keys(db_session: AsyncSession) -> None:
    _, template_id, _ = await fresh_charms(db_session)
    await _set_template_schema(db_session, template_id, _RULES)
    active = await _active_version(db_session, template_id)
    await _upgrade(db_session)

    await db_session.execute(text(_mig.DOWNGRADE_SQL))

    schema = await _version_schema(db_session, active)
    assert "derived_judgments" not in schema and "scope_rules" not in schema
    assert schema["entity_types"]
