"""Matching a finding against the instances that already exist.

Reads instances only — never a reviewer-scoped value (spec §5.1.1). Which
field declares the key is a pure read of the pinned tree (``key_field_of``,
covered in ``tests/unit/test_entity_key.py``); this file is the database half.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionInstance
from app.services.entity_key import (
    HISTORY_KEY,
    existing_keys,
    match_or_none,
    rekey_instance,
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
            "(id, project_template_id, name, label, cardinality, sort_order, entry_label) "
            # 0069: a repeating section always carries the word for one entry.
            "VALUES (:id, :tpl, :name, 'Probe Group', 'many', 90, 'entry')"
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


async def _match_id(db: AsyncSession, **coordinate: Any) -> UUID | None:
    """``match_or_none`` narrowed to the id these asserts compare on."""
    instance = await match_or_none(db, **coordinate)
    return instance.id if instance is not None else None


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
    """Case, and whitespace runs at the edges or inside the value.

    Two entries share the coordinate so that each is the other's decoy: the
    match has to be made by key, not by picking whichever row the scan
    reached first. Keep both — one row alone would pass on scan order.
    """
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    xgboost = await _instance(db_session, entity_type_id, "XGBoost")
    cox = await _instance(db_session, entity_type_id, "Cox Model")
    coordinate = {"article_id": SEED.primary_article, "entity_type_id": entity_type_id}
    assert await _match_id(db_session, key_value="  xgboost  ", **coordinate) == xgboost
    assert await _match_id(db_session, key_value="cox   model", **coordinate) == cox


async def test_match_returns_none_for_a_genuinely_new_entity(db_session: AsyncSession) -> None:
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    await _instance(db_session, entity_type_id, "XGBoost")
    assert (
        await _match_id(
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
    coordinate = {"article_id": SEED.primary_article, "entity_type_id": entity_type_id}
    assert await existing_keys(db_session, **coordinate) == {}
    assert await _match_id(db_session, key_value="Unlabelled", **coordinate) is None


async def test_keys_are_scoped_to_the_parent_instance(db_session: AsyncSession) -> None:
    """Two models may each own a repeat with the same key (e.g. 'external')."""
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    root = await _instance(db_session, entity_type_id, "shared-key")
    coordinate = {"article_id": SEED.primary_article, "entity_type_id": entity_type_id}
    assert (
        await _match_id(
            db_session, key_value="shared-key", parent_instance_id=uuid4(), **coordinate
        )
        is None
    ), "a key under a different parent must not match"
    assert await _match_id(db_session, key_value="shared-key", **coordinate) == root


async def test_a_rekeyed_entry_answers_on_its_current_key_only(
    db_session: AsyncSession,
) -> None:
    """A reviewer re-key leaves the retired key in ``entity_key_history``.

    History is a record, not an identity: the re-run that still calls the
    entry 'XGBoost' must NOT land on it, or the re-key it was told about
    would be silently undone. Matching reads the materialized slot only.
    """
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    instance_id = await _instance(db_session, entity_type_id, "XGBoost")
    instance = await db_session.get(ExtractionInstance, instance_id)
    assert instance is not None
    assert rekey_instance(instance, key_value="Gradient Boosting", actor_id=SEED.primary_profile)
    await db_session.flush()
    assert instance.metadata_[HISTORY_KEY][0]["from"] == "xgboost"

    coordinate = {"article_id": SEED.primary_article, "entity_type_id": entity_type_id}
    key = "gradient boosting"
    assert await _match_id(db_session, key_value=key, **coordinate) == instance_id
    assert await _match_id(db_session, key_value="XGBoost", **coordinate) is None
