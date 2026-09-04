"""Migration 0067 — ``is_entity_key`` backfilled into stored snapshots by id.

Runs the migration's exact SQL (imported by file path, the 0039 precedent)
against a snapshot published WITH the key and then stripped of it, so the
expected result is the byte-identical wide snapshot the builder wrote —
jsonb normalizes key order, so equality is a real assertion. The clone is
the secondary project's CHARMS, whose live rows carry the seeded keys.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.helpers.migrations import load_migration
from tests.integration.helpers.template_fixtures import entry_key_holders, fresh_charms

_mig = load_migration("0067_snapshot_entity_key.py")

KEY = "is_entity_key"


def _without_key(snapshot: dict[str, Any], *, field_ids: set[str] | None = None) -> dict[str, Any]:
    """The pre-0067 shape: field objects without the key (all, or a subset)."""
    return {
        **snapshot,
        "entity_types": [
            {
                **et,
                "fields": [
                    {k: v for k, v in f.items() if k != KEY}
                    if field_ids is None or f["id"] in field_ids
                    else f
                    for f in et["fields"]
                ],
            }
            for et in snapshot["entity_types"]
        ],
    }


async def _set_active_schema(db: AsyncSession, template_id: UUID, schema: dict[str, Any]) -> None:
    await db.execute(
        text(
            "UPDATE public.extraction_template_versions SET schema = CAST(:s AS jsonb) "
            "WHERE project_template_id = :tid AND is_active IS TRUE"
        ),
        {"tid": str(template_id), "s": json.dumps(schema)},
    )
    await db.flush()


async def _active_schema(db: AsyncSession, template_id: UUID) -> dict[str, Any]:
    return (
        await db.execute(
            text(
                "SELECT schema FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active IS TRUE"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()


async def _upgrade(db: AsyncSession) -> None:
    await db.execute(text(_mig.UPGRADE_SQL))
    await db.flush()


@pytest.mark.asyncio
async def test_backfill_restores_the_wide_snapshot_exactly(db_session: AsyncSession) -> None:
    _, template_id, wide = await fresh_charms(db_session)
    assert any(await entry_key_holders(db_session, template_id))
    await _set_active_schema(db_session, template_id, _without_key(wide))

    await _upgrade(db_session)

    assert await _active_schema(db_session, template_id) == wide


@pytest.mark.asyncio
async def test_backfill_is_idempotent_and_skips_fields_that_carry_the_key(
    db_session: AsyncSession,
) -> None:
    """A present key is authoritative — a post-#798 publish that moved the
    key elsewhere must not be overwritten by the live flag."""
    _, template_id, wide = await fresh_charms(db_session)
    section, holder = next(iter((await entry_key_holders(db_session, template_id)).items()))
    moved = {
        **wide,
        "entity_types": [
            {
                **et,
                "fields": [
                    {**f, KEY: f["id"] != str(holder)} if UUID(et["id"]) == section else f
                    for f in et["fields"]
                ],
            }
            for et in wide["entity_types"]
        ],
    }
    await _set_active_schema(db_session, template_id, moved)

    await _upgrade(db_session)
    await _upgrade(db_session)

    assert await _active_schema(db_session, template_id) == moved


@pytest.mark.asyncio
async def test_field_without_a_live_row_stays_absent(db_session: AsyncSession) -> None:
    """Versions are append-only audit: nothing is fabricated for a field the
    template no longer has, so the reader's ``absent ≡ false`` applies."""
    _, template_id, wide = await fresh_charms(db_session)
    ghost = {**wide["entity_types"][0]["fields"][0], "id": str(uuid4()), "name": "ghost"}
    with_ghost = {
        **wide,
        "entity_types": [
            {**wide["entity_types"][0], "fields": [*wide["entity_types"][0]["fields"], ghost]},
            *wide["entity_types"][1:],
        ],
    }
    await _set_active_schema(db_session, template_id, _without_key(with_ghost))

    await _upgrade(db_session)

    after = await _active_schema(db_session, template_id)
    ghost_after = next(f for f in after["entity_types"][0]["fields"] if f["id"] == ghost["id"])
    assert KEY not in ghost_after
    assert after["entity_types"][1:] == wide["entity_types"][1:]
