"""Matching a finding against the instances that already exist.

Reads instances only — never a reviewer-scoped value (spec §5.1.1). Which
field declares the key is a pure read of the pinned tree (``key_field_of``,
covered in ``tests/unit/test_entity_key.py``); this file is the database half.
"""

from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.entity_key import (
    existing_keys,
    match_or_none,
    resolve_instance,
    stamp,
)
from tests.integration.conftest import SEED

pytestmark = pytest.mark.asyncio


async def _repeating_group(db: AsyncSession, *, with_key: bool) -> tuple[UUID, UUID]:
    """A cardinality='many' section under the seeded template, optionally keyed."""
    entity_type_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, sort_order) "
            "VALUES (:id, :tpl, :name, 'Probe Group', 'many', 'study_section', 90)"
        ),
        {
            "id": entity_type_id,
            "tpl": SEED.primary_template,
            "name": f"probe_{entity_type_id.hex[:8]}",
        },
    )
    field_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, sort_order, is_entity_key) "
            "VALUES (:id, :et, 'probe_key', 'Probe Key', 'text', 0, :key)"
        ),
        {"id": field_id, "et": entity_type_id, "key": with_key},
    )
    await db.flush()
    return entity_type_id, field_id


async def _instance(db: AsyncSession, entity_type_id: UUID, key_value: str | None) -> UUID:
    instance_id = uuid4()
    metadata = stamp({"ai_extracted": True}, key_value) if key_value is not None else {}
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, article_id, template_id, entity_type_id, label, sort_order, "
            " metadata, created_by) "
            "VALUES (:id, :proj, :art, :tpl, :et, :label, 0, CAST(:md AS jsonb), :usr)"
        ),
        {
            "id": instance_id,
            "proj": SEED.primary_project,
            "art": SEED.primary_article,
            "tpl": SEED.primary_template,
            "et": entity_type_id,
            "label": key_value or "Unlabelled",
            "md": json.dumps(metadata),
            "usr": SEED.primary_profile,
        },
    )
    await db.flush()
    return instance_id


async def test_resolve_instance_creates_and_stamps_a_new_entry(db_session: AsyncSession) -> None:
    """Identity is materialized at creation, alongside whatever the caller
    records about how the entry was produced."""
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    instance, created = await resolve_instance(
        db_session,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        template_id=SEED.primary_template,
        entity_type_id=entity_type_id,
        parent_instance_id=None,
        key_value="  Internal  validation ",
        sort_order=3,
        metadata={"ai_extracted": True, "ai_run_id": "r1"},
        created_by=SEED.primary_profile,
    )
    assert created is True
    assert instance.metadata_["entity_key"] == "internal validation"
    assert instance.metadata_["ai_run_id"] == "r1"
    assert instance.label == "Internal  validation"
    assert instance.sort_order == 3
    assert await existing_keys(
        db_session, article_id=SEED.primary_article, entity_type_id=entity_type_id
    ) == {"internal validation": instance.id}


async def test_resolve_instance_reuses_the_entry_it_already_holds(db_session: AsyncSession) -> None:
    """The re-run names the same entity in a different spelling — same row."""
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    common = {
        "project_id": SEED.primary_project,
        "article_id": SEED.primary_article,
        "template_id": SEED.primary_template,
        "entity_type_id": entity_type_id,
        "parent_instance_id": None,
        "created_by": SEED.primary_profile,
    }
    first, _ = await resolve_instance(db_session, key_value="XGBoost", sort_order=0, **common)
    second, created = await resolve_instance(
        db_session, key_value="  xgboost ", sort_order=0, metadata={"ai_run_id": "r2"}, **common
    )
    assert created is False
    assert second.id == first.id
    assert second.metadata_.get("ai_run_id") is None, "reuse must not rewrite the row's record"
    assert (
        len(
            await existing_keys(
                db_session, article_id=SEED.primary_article, entity_type_id=entity_type_id
            )
        )
        == 1
    )


async def test_match_finds_the_instance_regardless_of_case_and_spacing(
    db_session: AsyncSession,
) -> None:
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    instance_id = await _instance(db_session, entity_type_id, "XGBoost")
    found = await match_or_none(
        db_session,
        article_id=SEED.primary_article,
        entity_type_id=entity_type_id,
        key_value="  xgboost  ",
    )
    assert found == instance_id


async def test_match_returns_none_for_a_genuinely_new_entity(db_session: AsyncSession) -> None:
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    await _instance(db_session, entity_type_id, "XGBoost")
    assert (
        await match_or_none(
            db_session,
            article_id=SEED.primary_article,
            entity_type_id=entity_type_id,
            key_value="LightGBM",
        )
        is None
    )


async def test_pre_0059_instances_carry_no_key_and_are_not_matched(
    db_session: AsyncSession,
) -> None:
    """An instance created before this feature has no materialized key.

    It must not be matched by guesswork — a re-run creates alongside it
    rather than silently adopting a row it cannot identify.
    """
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    await _instance(db_session, entity_type_id, None)
    assert (
        await existing_keys(
            db_session, article_id=SEED.primary_article, entity_type_id=entity_type_id
        )
        == {}
    )


async def test_keys_are_scoped_to_the_parent_instance(db_session: AsyncSession) -> None:
    """Two models may each own a repeat with the same key (e.g. 'external')."""
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    root = await _instance(db_session, entity_type_id, "shared-key")
    assert (
        await match_or_none(
            db_session,
            article_id=SEED.primary_article,
            entity_type_id=entity_type_id,
            key_value="shared-key",
            parent_instance_id=uuid4(),
        )
        is None
    ), "a key under a different parent must not match"
    assert (
        await match_or_none(
            db_session,
            article_id=SEED.primary_article,
            entity_type_id=entity_type_id,
            key_value="shared-key",
        )
        == root
    )
