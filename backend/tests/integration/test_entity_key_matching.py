"""Matching a finding against the instances that already exist.

Reads instances only — never a reviewer-scoped value (spec §5.1.1). Which
field declares the key is a pure read of the pinned tree (``key_field_of``,
covered in ``tests/unit/test_entity_key.py``); this file is the database half.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.integrity import violates_constraint
from app.models.extraction_instance import ExtractionInstance
from app.services import entry_hierarchy_service
from app.services.entity_key import (
    ENTITY_KEY_UNIQUE_INDEX,
    HISTORY_KEY,
    existing_keys,
    match_or_none,
    rekey_instance,
    resolve_instance,
    stamp,
)
from app.services.entry_hierarchy_service import EntryHierarchyService, EntryKeyDuplicateError
from tests.integration.conftest import SEED

pytestmark = pytest.mark.asyncio


async def _repeating_group(
    db: AsyncSession, *, with_key: bool, parent_entity_type_id: UUID | None = None
) -> tuple[UUID, UUID]:
    """A cardinality='many' section under the seeded template, optionally keyed."""
    entity_type_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, sort_order, entry_label,"
            " parent_entity_type_id) "
            # 0069: a repeating section always carries the word for one entry.
            "VALUES (:id, :tpl, :name, 'Probe Group', 'many', 90, 'entry', :parent)"
        ),
        {
            "id": entity_type_id,
            "tpl": SEED.primary_template,
            "name": f"probe_{entity_type_id.hex[:8]}",
            "parent": parent_entity_type_id,
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


async def _instance(
    db: AsyncSession,
    entity_type_id: UUID,
    key_value: str | None,
    parent_instance_id: UUID | None = None,
) -> UUID:
    instance_id = uuid4()
    metadata = stamp({"ai_extracted": True}, key_value) if key_value is not None else {}
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, article_id, template_id, entity_type_id, parent_instance_id,"
            " label, sort_order, metadata, created_by) "
            "VALUES (:id, :proj, :art, :tpl, :et, :parent, :label, 0, CAST(:md AS jsonb), :usr)"
        ),
        {
            "id": instance_id,
            "proj": SEED.primary_project,
            "art": SEED.primary_article,
            "tpl": SEED.primary_template,
            "et": entity_type_id,
            "parent": parent_instance_id,
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


async def _insert_rejected(db: AsyncSession, *args: Any) -> IntegrityError:
    with pytest.raises(IntegrityError) as caught:
        async with db.begin_nested():
            await _instance(db, *args)
    return caught.value


async def test_db_rejects_duplicate_identity_including_root(db_session: AsyncSession) -> None:
    """The unique index holds one normalized key per coordinate: a root
    coordinate (no parent) and a child coordinate alike; the same key under
    a different parent is a different coordinate."""
    parent_type, _ = await _repeating_group(db_session, with_key=True)
    root = await _instance(db_session, parent_type, "Shared")
    other_root = await _instance(db_session, parent_type, "Other")
    exc = await _insert_rejected(db_session, parent_type, " shared ")
    assert violates_constraint(exc, ENTITY_KEY_UNIQUE_INDEX)

    child_type, _ = await _repeating_group(
        db_session, with_key=True, parent_entity_type_id=parent_type
    )
    await _instance(db_session, child_type, "Shared", root)
    exc = await _insert_rejected(db_session, child_type, "SHARED", root)
    assert violates_constraint(exc, ENTITY_KEY_UNIQUE_INDEX)
    await _instance(db_session, child_type, "Shared", other_root)

    # Unkeyed rows (pre-0059) sit outside the partial index.
    await _instance(db_session, parent_type, None)
    await _instance(db_session, parent_type, None)


async def test_resolve_instance_reraises_other_integrity_errors(db_session: AsyncSession) -> None:
    """Only the identity index is a lost race; any other violation surfaces."""
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    with pytest.raises(IntegrityError) as caught:
        await resolve_instance(
            db_session,
            project_id=SEED.primary_project,
            article_id=SEED.primary_article,
            template_id=SEED.primary_template,
            entity_type_id=entity_type_id,
            parent_instance_id=None,
            key_value="orphan",
            sort_order=0,
            created_by=uuid4(),  # no such profile: a foreign-key violation
        )
    assert not violates_constraint(caught.value, ENTITY_KEY_UNIQUE_INDEX)


async def test_create_entry_maps_index_violation_to_409(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A concurrent creator the pre-check missed: the identity index rejects
    the insert, and the reviewer gets the typed 409, not a 500."""
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    existing_id = await _instance(db_session, entity_type_id, "Cox Model")

    async def _miss(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(entry_hierarchy_service, "match_or_none", _miss)

    with pytest.raises(EntryKeyDuplicateError) as caught:
        await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.primary_project,
            article_id=SEED.primary_article,
            template_id=SEED.primary_template,
            entity_type_id=entity_type_id,
            parent_instance_id=None,
            label="Cox model",
            entity_key=" cox  MODEL ",
            user_id=SEED.primary_profile,
        )

    assert caught.value.status_code == 409
    # The savepoint kept the session usable: the holder is still the only row.
    rows = (
        await db_session.execute(
            text("SELECT id FROM public.extraction_instances WHERE entity_type_id = :et"),
            {"et": entity_type_id},
        )
    ).all()
    assert [row[0] for row in rows] == [existing_id]


async def test_match_or_none_excludes_the_given_instance(db_session: AsyncSession) -> None:
    entity_type_id, _ = await _repeating_group(db_session, with_key=True)
    instance_id = await _instance(db_session, entity_type_id, "Cox Model")
    coordinate = {"article_id": SEED.primary_article, "entity_type_id": entity_type_id}

    assert await _match_id(db_session, key_value="cox model", **coordinate) == instance_id
    assert (
        await _match_id(db_session, key_value="cox model", exclude_id=instance_id, **coordinate)
        is None
    )
    assert (
        await _match_id(db_session, key_value="cox model", exclude_id=uuid4(), **coordinate)
        == instance_id
    )


async def test_concurrent_resolve_instance_yields_one_row() -> None:
    """Two creators race for one new key. The second misses the first's
    uncommitted row, blocks on the identity index, and once the first
    commits it re-reads and returns that row instead of a 500."""
    engine = create_async_engine(settings.async_database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    draft_since_sql = text(
        "SELECT config_draft_since FROM public.project_extraction_templates WHERE id = :tid"
    )
    async with factory() as setup:
        draft_since = (
            await setup.execute(draft_since_sql, {"tid": SEED.primary_template})
        ).scalar()
        entity_type_id, field_id = await _repeating_group(setup, with_key=True)
        await setup.commit()
    coordinate: dict[str, Any] = {
        "project_id": SEED.primary_project,
        "article_id": SEED.primary_article,
        "template_id": SEED.primary_template,
        "entity_type_id": entity_type_id,
        "parent_instance_id": None,
        "key_value": "Race Key",
        "sort_order": 0,
        "created_by": SEED.primary_profile,
    }
    try:
        async with factory() as first, factory() as second, factory() as probe:
            second_pid = (await second.execute(text("SELECT pg_backend_pid()"))).scalar()
            winner, winner_created = await resolve_instance(first, **coordinate)
            pending = asyncio.create_task(resolve_instance(second, **coordinate))
            for _ in range(500):
                blocked = (
                    await probe.execute(
                        text("SELECT count(*) FROM pg_locks WHERE pid = :pid AND NOT granted"),
                        {"pid": second_pid},
                    )
                ).scalar()
                if blocked:
                    break
                await asyncio.sleep(0.01)
            assert blocked, "the second creator must block on the identity index"
            await first.commit()
            loser, loser_created = await pending
            await second.commit()
            rows = (
                await probe.execute(
                    text("SELECT id FROM public.extraction_instances WHERE entity_type_id = :et"),
                    {"et": entity_type_id},
                )
            ).all()
        assert (winner_created, loser_created) == (True, False)
        assert loser.id == winner.id
        assert [row[0] for row in rows] == [winner.id]
    finally:
        async with factory() as cleanup:
            await cleanup.execute(
                text("DELETE FROM public.extraction_instances WHERE entity_type_id = :et"),
                {"et": entity_type_id},
            )
            await cleanup.execute(
                text("DELETE FROM public.extraction_fields WHERE id = :id"), {"id": field_id}
            )
            await cleanup.execute(
                text("DELETE FROM public.extraction_entity_types WHERE id = :id"),
                {"id": entity_type_id},
            )
            await cleanup.execute(
                text(
                    "UPDATE public.project_extraction_templates"
                    " SET config_draft_since = :since WHERE id = :tid"
                ),
                {"since": draft_since, "tid": SEED.primary_template},
            )
            await cleanup.commit()
        await engine.dispose()
