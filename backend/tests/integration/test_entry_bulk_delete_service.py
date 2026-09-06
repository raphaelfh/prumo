"""``delete_entries`` — the all-or-nothing property, proved where it shows.

Its endpoint sibling cannot assert this: the error branches call
``db.rollback()``, which unwinds the savepoint the fixture rows were written
in, so a "nothing was deleted" assertion there would pass whether the service
deleted the rows or not. Calling the service directly leaves the rows exactly
as it found them, so the assertion means what it says.

One child FK does NOT cascade: `extraction_published_states.instance_id` is
NO ACTION, DEFERRABLE INITIALLY DEFERRED (verified by SQL against production).
It therefore fires at COMMIT, which this SAVEPOINT-isolated session never
reaches — a savepoint release is not a commit. The endpoint's translation of
that late failure into a 409 is covered where it can be: the direct-call unit
test in `tests/unit/test_entry_bulk_delete_endpoint_unit.py`.

The all-or-nothing property is worth this much care because deleting an entry
otherwise cascades:
``extraction_instances.parent_instance_id`` is ON DELETE CASCADE and four of
the five work tables cascade from ``instance_id``, so a batch that removes six
of eight destroys six entries' reviewer decisions and leaves the reviewer
looking at a tree they did not ask for.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.entry_bulk_delete_service import (
    EntryNotFoundError,
    EntryNotRepeatingError,
    delete_entries,
)
from tests.integration.conftest import SEED
from tests.integration.test_entry_group_extraction import _group, _instance

pytestmark = pytest.mark.asyncio

COORD = {
    "project_id": SEED.primary_project,
    "article_id": SEED.primary_article,
    "template_id": SEED.primary_template,
}


async def _surviving(db: AsyncSession, ids: list[UUID]) -> int:
    return (
        await db.execute(
            text("SELECT count(*) FROM public.extraction_instances WHERE id = ANY(:ids)"),
            {"ids": [str(i) for i in ids]},
        )
    ).scalar_one()


async def _entries(db: AsyncSession, count: int) -> list[UUID]:
    entity_type_id, _key_id, _value_id = await _group(db)
    return [await _instance(db, entity_type_id, f"Entry {i}") for i in range(count)]


async def test_it_deletes_every_named_entry(db_session: AsyncSession) -> None:
    ids = await _entries(db_session, 3)

    deleted = await delete_entries(db_session, instance_ids=ids, **COORD)

    assert deleted == 3
    assert await _surviving(db_session, ids) == 0


async def test_an_unknown_id_leaves_EVERY_other_entry_alone(db_session: AsyncSession) -> None:
    """The reason this endpoint exists rather than a loop of browser deletes:
    a loop would have removed the first two before it hit the third."""
    ids = await _entries(db_session, 2)

    with pytest.raises(EntryNotFoundError):
        await delete_entries(db_session, instance_ids=[*ids, uuid4()], **COORD)

    assert await _surviving(db_session, ids) == 2


async def test_the_unknown_id_is_checked_even_when_it_comes_FIRST(
    db_session: AsyncSession,
) -> None:
    """Order-independence, so the test above cannot pass by accident: with the
    refusal first, a validate-as-you-go loop would also delete nothing. Both
    orders must leave the set whole."""
    ids = await _entries(db_session, 2)

    with pytest.raises(EntryNotFoundError):
        await delete_entries(db_session, instance_ids=[uuid4(), *ids], **COORD)

    assert await _surviving(db_session, ids) == 2


async def test_an_entry_outside_the_coordinate_leaves_the_batch_whole(
    db_session: AsyncSession,
) -> None:
    """BOLA, and the same all-or-nothing rule. The entry really exists — only
    the article in the request differs — and it answers exactly like a missing
    one, so the endpoint is no existence oracle."""
    ids = await _entries(db_session, 2)

    with pytest.raises(EntryNotFoundError):
        await delete_entries(
            db_session,
            instance_ids=ids,
            project_id=SEED.primary_project,
            article_id=uuid4(),
            template_id=SEED.primary_template,
        )

    assert await _surviving(db_session, ids) == 2


async def test_a_singleton_refuses_and_takes_no_entry_with_it(
    db_session: AsyncSession,
) -> None:
    """A ``cardinality='one'`` instance is scaffolding the session seeds, not
    an entry a reviewer added — and the refusal must not cost the real entries
    named alongside it."""
    entity_type_id, _key_id, _value_id = await _group(db_session, cardinality="one")
    singleton = await _instance(db_session, entity_type_id, "Study summary")
    entries = await _entries(db_session, 2)

    with pytest.raises(EntryNotRepeatingError):
        await delete_entries(db_session, instance_ids=[*entries, singleton], **COORD)

    assert await _surviving(db_session, [*entries, singleton]) == 3


async def test_deleting_an_entry_takes_its_children_with_it(
    db_session: AsyncSession,
) -> None:
    """The cascade is what makes a partial batch expensive, so it is pinned
    here rather than assumed: the child goes with its parent."""
    parent_type, _k, _v = await _group(db_session)
    child_type, _ck, _cv = await _group(db_session, parent=parent_type, label="Validations")
    parent = await _instance(db_session, parent_type, "Cox Model")
    child = await _instance(db_session, child_type, "Internal", parent=parent)

    assert await _surviving(db_session, [child]) == 1

    await delete_entries(db_session, instance_ids=[parent], **COORD)

    assert await _surviving(db_session, [parent, child]) == 0
