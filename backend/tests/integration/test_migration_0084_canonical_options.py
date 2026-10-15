"""Migration 0084 — every live field's options stored as ``{value, label}``.

Runs the migration's statements inside the savepoint-isolated ``db_session``.
The UPDATE is table-wide, so the shared database's own rows are touched too
(and rolled back); every assertion here is per row, on rows this test plants.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.template_change import ChangeVariant, DiffStatus
from app.llm.claim_value import normalize_options
from app.services.template_versioning import TemplateVersionService, get_template_config_diff
from tests.integration.conftest import SEED
from tests.integration.helpers.migrations import load_migration
from tests.integration.helpers.template_fixtures import field_id, fresh_charms

_mig = load_migration("0084_canonical_field_options.py")

_DISABLE = f"ALTER TABLE public.extraction_fields DISABLE TRIGGER {_mig._TRIGGER}"
_ENABLE = f"ALTER TABLE public.extraction_fields ENABLE TRIGGER {_mig._TRIGGER}"

_LEGACY: list[Any] = [
    ["Yes", "No"],
    {"options": ["A", "B"]},
    ["Y", {"value": "NI", "label": "No information"}, {"label": "Z"}],
    [{"value": "dev", "label": "Development only"}],
]
_CANONICAL: list[Any] = [
    [{"value": "Yes", "label": "Yes"}, {"value": "No", "label": "No"}],
    [{"value": "A", "label": "A"}, {"value": "B", "label": "B"}],
    [
        {"value": "Y", "label": "Y"},
        {"value": "NI", "label": "No information"},
        {"value": "Z", "label": "Z"},
    ],
    [{"value": "dev", "label": "Development only"}],
]


async def _select_fields(db: AsyncSession, template_id: UUID, n: int) -> list[UUID]:
    return list(
        (
            await db.execute(
                text(
                    "SELECT f.id FROM public.extraction_fields f "
                    "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                    "WHERE et.project_template_id = :tid ORDER BY f.id LIMIT :n"
                ),
                {"tid": str(template_id), "n": n},
            )
        ).scalars()
    )


async def _plant(db: AsyncSession, options: dict[UUID, Any]) -> None:
    await db.execute(text(_DISABLE))
    for fid, value in options.items():
        await db.execute(
            text(
                "UPDATE public.extraction_fields SET allowed_values = CAST(:v AS jsonb) WHERE id = :id"
            ),
            {"v": json.dumps(value), "id": str(fid)},
        )
    await db.execute(text(_ENABLE))


async def _upgrade(db: AsyncSession) -> int:
    await db.execute(text(_DISABLE))
    rowcount = (await db.execute(text(_mig.UPGRADE_SQL))).rowcount
    await db.execute(text(_ENABLE))
    return rowcount


async def _options(db: AsyncSession, fid: UUID) -> Any:
    return (
        await db.execute(
            text("SELECT allowed_values FROM public.extraction_fields WHERE id = :id"),
            {"id": str(fid)},
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_legacy_rows_become_canonical(db_session: AsyncSession) -> None:
    _, template_id, _ = await fresh_charms(db_session)
    fields = await _select_fields(db_session, template_id, len(_LEGACY))
    await _plant(db_session, dict(zip(fields, _LEGACY, strict=True)))

    await _upgrade(db_session)

    assert [await _options(db_session, f) for f in fields] == _CANONICAL


@pytest.mark.asyncio
async def test_matches_the_read_side_normalizer(db_session: AsyncSession) -> None:
    """The stored labels are exactly what ``normalize_options`` derives for the
    same legacy input, so a legacy baseline and its migrated live row compare
    equal (no spurious "option renamed" rows)."""
    _, template_id, _ = await fresh_charms(db_session)
    fields = await _select_fields(db_session, template_id, len(_LEGACY))
    await _plant(db_session, dict(zip(fields, _LEGACY, strict=True)))

    await _upgrade(db_session)

    assert [await _options(db_session, f) for f in fields] == [
        normalize_options(raw) for raw in _LEGACY
    ]


@pytest.mark.asyncio
async def test_unusable_options_become_null(db_session: AsyncSession) -> None:
    _, template_id, _ = await fresh_charms(db_session)
    (fid,) = await _select_fields(db_session, template_id, 1)
    await _plant(db_session, {fid: ["", {"value": ""}, 3, None]})

    await _upgrade(db_session)

    assert await _options(db_session, fid) is None


@pytest.mark.asyncio
async def test_draft_marker_and_snapshots_untouched(db_session: AsyncSession) -> None:
    _, template_id, _ = await fresh_charms(db_session)
    fields = await _select_fields(db_session, template_id, len(_LEGACY))
    await _plant(db_session, dict(zip(fields, _LEGACY, strict=True)))

    drafts_sql = text("SELECT id, config_draft_since FROM public.project_extraction_templates")
    snapshots_sql = text("SELECT id, md5(schema::text) FROM public.extraction_template_versions")
    drafts = dict((await db_session.execute(drafts_sql)).tuples().all())
    snapshots = dict((await db_session.execute(snapshots_sql)).tuples().all())

    await db_session.execute(text(_DISABLE))
    await db_session.execute(text(_mig.UPGRADE_SQL))
    await db_session.execute(text(_ENABLE))

    assert await _options(db_session, fields[0]) == _CANONICAL[0]  # the upgrade ran
    assert dict((await db_session.execute(drafts_sql)).tuples().all()) == drafts
    assert dict((await db_session.execute(snapshots_sql)).tuples().all()) == snapshots


@pytest.mark.asyncio
async def test_legacy_baseline_shows_no_option_rename_after_upgrade(
    db_session: AsyncSession,
) -> None:
    """A template published while its options were legacy, then migrated:
    the draft diff carries no FIELD_OPTION_RENAMED row."""
    project_id, template_id, _ = await fresh_charms(db_session)
    target = await field_id(db_session, template_id, "model_development", "shrinkage")
    await _plant(db_session, {target: _LEGACY[2]})
    await TemplateVersionService(db_session).republish(
        project_id=project_id, project_template_id=template_id, user_id=SEED.primary_profile
    )

    await _upgrade(db_session)

    assert await _options(db_session, target) == _CANONICAL[2]
    diff = await get_template_config_diff(
        db_session, project_id=project_id, template_id=template_id
    )
    assert diff.status is DiffStatus.AVAILABLE
    buckets = diff.changes
    rows = [*buckets.additive, *buckets.cosmetic, *buckets.semantic, *buckets.destructive]
    assert not [r for r in rows if r.variant is ChangeVariant.FIELD_OPTION_RENAMED]
    assert rows == []


@pytest.mark.asyncio
async def test_is_idempotent(db_session: AsyncSession) -> None:
    _, template_id, _ = await fresh_charms(db_session)
    fields = await _select_fields(db_session, template_id, len(_LEGACY))
    await _plant(db_session, dict(zip(fields, _LEGACY, strict=True)))

    await _upgrade(db_session)
    assert await _upgrade(db_session) == 0  # nothing left to rewrite anywhere

    assert [await _options(db_session, f) for f in fields] == _CANONICAL
