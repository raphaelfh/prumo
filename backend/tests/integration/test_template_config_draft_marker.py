"""Draft-marker lifecycle (slice B-4).

The editor writes config through PostgREST until B-7, so the ONLY
reliable place to record "there are unpublished edits" is the DB:
AFTER-row triggers on the two live config tables stamp
``project_extraction_templates.config_draft_since``; publish paths
clear it inside ``TemplateVersionService.republish``'s locked section.

The stamp is ``COALESCE(config_draft_since, now())`` with no WHERE
predicate beyond the id: an UPDATE whose WHERE misses the committed row
takes no row lock, so a predicate-guarded stamp racing a mid-flight
publish would commit unserialized and the publish would clear a draft
it never snapshotted.
"""

from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
)
from tests.integration.conftest import SEED

# A sentinel far in the past: within one test transaction now() is
# constant, so "a later edit keeps the first timestamp" is only
# falsifiable against a PRE-SET value, never against two in-txn stamps.
_SENTINEL = datetime(2020, 1, 1, tzinfo=UTC)


async def _marker(db: AsyncSession, template_id: UUID) -> datetime | None:
    return (
        await db.execute(
            select(ProjectExtractionTemplate.config_draft_since).where(
                ProjectExtractionTemplate.id == template_id
            )
        )
    ).scalar_one()


async def _set_marker(db: AsyncSession, template_id: UUID, value: datetime | None) -> None:
    await db.execute(
        update(ProjectExtractionTemplate)
        .where(ProjectExtractionTemplate.id == template_id)
        .values(config_draft_since=value)
    )
    await db.flush()


def _probe_field(name: str) -> ExtractionField:
    return ExtractionField(
        entity_type_id=SEED.primary_entity_type,
        name=name,
        label=f"probe {name}",
        field_type="text",
        is_required=False,
        validation_schema={},
        sort_order=999,
    )


@pytest.mark.asyncio
async def test_field_insert_update_delete_mark_draft(db_session: AsyncSession) -> None:
    await _set_marker(db_session, SEED.primary_template, None)

    field = _probe_field("b4_marker_probe")
    db_session.add(field)
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None

    await _set_marker(db_session, SEED.primary_template, None)
    field.label = "probe renamed"
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None

    await _set_marker(db_session, SEED.primary_template, None)
    await db_session.delete(field)
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None


@pytest.mark.asyncio
async def test_entity_type_write_marks_draft(db_session: AsyncSession) -> None:
    await _set_marker(db_session, SEED.primary_template, None)
    et = await db_session.get(ExtractionEntityType, SEED.primary_entity_type)
    assert et is not None
    et.label = f"{et.label} (b4)"
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None


@pytest.mark.asyncio
async def test_marker_keeps_first_edit_timestamp(db_session: AsyncSession) -> None:
    """COALESCE semantics: a later edit never moves an existing stamp."""
    await _set_marker(db_session, SEED.primary_template, _SENTINEL)
    et = await db_session.get(ExtractionEntityType, SEED.primary_entity_type)
    assert et is not None
    et.label = f"{et.label} (later edit)"
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) == _SENTINEL


@pytest.mark.asyncio
async def test_global_lineage_writes_never_stamp(db_session: AsyncSession) -> None:
    """The seed writes these SAME tables in global lineage (template_id
    set, project_template_id NULL) — the trigger's v_template IS NULL
    skip is what keeps seeding a no-op. Pin it so the guard is never
    "simplified" away."""
    await _set_marker(db_session, SEED.primary_template, None)

    global_tpl = ExtractionTemplateGlobal(
        name="b4 marker probe global",
        framework="CUSTOM",
        kind="extraction",
    )
    db_session.add(global_tpl)
    await db_session.flush()

    global_et = ExtractionEntityType(
        template_id=global_tpl.id,
        project_template_id=None,
        name="b4_probe_global_section",
        label="B4 probe global section",
        role="study_section",
        cardinality="one",
        sort_order=0,
    )
    db_session.add(global_et)
    await db_session.flush()

    global_field = ExtractionField(
        entity_type_id=global_et.id,
        name="b4_probe_global_field",
        label="B4 probe global field",
        field_type="text",
        is_required=False,
        validation_schema={},
        sort_order=0,
    )
    db_session.add(global_field)
    await db_session.flush()
    global_field.label = "B4 probe global field (renamed)"
    await db_session.flush()

    assert await _marker(db_session, SEED.primary_template) is None
