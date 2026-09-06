"""DELETE /api/v1/extraction/instances — delete several entries at once.

Same shape as its POST sibling on this router (``test_entry_create_endpoint``):
``db_client`` over the real savepoint session, ``get_current_user`` overridden
to a SEED profile. Deliberately NOT the ``client`` fixture — its DB is an
``AsyncMock``, so nothing can be deleted or refused through it.

The property that matters is ALL-OR-NOTHING: deleting an entry cascades to
its child instances, its values and its reviewer decisions, so a bulk delete
that gets halfway leaves audit-bearing tables in a state no reviewer asked for
and no undo restores.

That property is asserted against the SERVICE, not through the client. The
endpoint's error branches call ``db.rollback()``, which unwinds the savepoint
the fixture rows were written in, so "did the refusal leave the rows alone?"
is unanswerable here — the harness removes them either way and the assertion
would pass for the wrong reason. `test_entry_bulk_delete_service.py` proves
it where a rollback is not in the way; these tests own the HTTP contract:
status codes, the envelope, and the two auth gates.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from tests.integration.conftest import SEED
from tests.integration.test_entry_group_extraction import _group, _instance

pytestmark = pytest.mark.asyncio

ENDPOINT = "/api/v1/extraction/instances"


async def _authenticated(profile_id: UUID) -> AsyncGenerator[UUID, None]:
    async def _override() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id), email="x@example.com", role="authenticated", aal="aal1"
        )

    app.dependency_overrides[get_current_user] = _override
    yield profile_id
    app.dependency_overrides.pop(get_current_user, None)


@pytest_asyncio.fixture
async def as_manager(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    """A MANAGER of the primary project — the only role this endpoint accepts.

    Stricter than the POST sibling on the same router, and deliberately so:
    the RLS policy on this very table is
    `extraction_instances_delete USING is_project_manager(...)`, so accepting
    a reviewer would make the API the more permissive of two implementations
    of one predicate on a destructive path."""
    del db_session
    async for user_id in _authenticated(SEED.primary_profile):
        yield user_id


@pytest_asyncio.fixture
async def as_reviewer(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    """A member whose role is `reviewer` — passes `is_project_reviewer` (and
    so the CREATE sibling's gate) and must still fail THIS one."""
    del db_session
    async for user_id in _authenticated(SEED.reviewer_profile):
        yield user_id


@pytest_asyncio.fixture
async def as_outsider(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    del db_session
    async for user_id in _authenticated(SEED.outsider_profile):
        yield user_id


@pytest_asyncio.fixture
async def as_viewer(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    """A MEMBER who is not a reviewer — the only shape that passes the member
    gate and fails the reviewer one (the seed has no such row)."""
    await db_session.execute(
        text(
            "INSERT INTO public.project_members (id, project_id, user_id, role) "
            "VALUES (gen_random_uuid(), :pid, :uid, 'viewer') "
            "ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'viewer'"
        ),
        {"pid": str(SEED.primary_project), "uid": str(SEED.outsider_profile)},
    )
    await db_session.flush()
    async for user_id in _authenticated(SEED.outsider_profile):
        yield user_id


def _body(ids: list[UUID], **overrides: object) -> dict:
    return {
        "projectId": str(SEED.primary_project),
        "articleId": str(SEED.primary_article),
        "templateId": str(SEED.primary_template),
        "instanceIds": [str(i) for i in ids],
        **overrides,
    }


async def _entries(db: AsyncSession, count: int) -> tuple[UUID, list[UUID]]:
    """One repeating section holding ``count`` entries."""
    entity_type_id, _key_id, _value_id = await _group(db)
    ids = [await _instance(db, entity_type_id, f"Entry {i}") for i in range(count)]
    return entity_type_id, ids


async def _surviving(db: AsyncSession, ids: list[UUID]) -> int:
    return (
        await db.execute(
            text("SELECT count(*) FROM public.extraction_instances WHERE id = ANY(:ids)"),
            {"ids": [str(i) for i in ids]},
        )
    ).scalar_one()


async def test_delete_removes_every_named_entry(
    db_session: AsyncSession, db_client: AsyncClient, as_manager: UUID
) -> None:
    del as_manager
    _et, ids = await _entries(db_session, 3)

    res = await db_client.request("DELETE", ENDPOINT, json=_body(ids))

    assert res.status_code == 200, res.text
    assert res.json()["data"]["deleted"] == 3
    assert await _surviving(db_session, ids) == 0


async def test_it_leaves_the_entries_it_was_not_given(
    db_session: AsyncSession, db_client: AsyncClient, as_manager: UUID
) -> None:
    del as_manager
    _et, ids = await _entries(db_session, 3)

    res = await db_client.request("DELETE", ENDPOINT, json=_body(ids[:2]))

    assert res.status_code == 200, res.text
    assert await _surviving(db_session, ids[:2]) == 0
    assert await _surviving(db_session, ids[2:]) == 1


async def test_one_foreign_id_refuses_the_WHOLE_batch(
    db_session: AsyncSession, db_client: AsyncClient, as_manager: UUID
) -> None:
    """One unknown id refuses the batch. That NOTHING was deleted is the
    service test's job — see this module's docstring."""
    del as_manager
    _et, ids = await _entries(db_session, 2)
    await db_session.commit()

    res = await db_client.request("DELETE", ENDPOINT, json=_body([*ids, uuid4()]))

    assert res.status_code == 404, res.text


async def test_an_entry_outside_the_request_coordinate_is_not_reachable(
    db_session: AsyncSession, db_client: AsyncClient, as_manager: UUID
) -> None:
    """BOLA: the id is bound to the request coordinate in the WHERE clause,
    and a row outside it answers exactly like a missing one — no existence
    oracle. The entry below really exists; only the article differs."""
    del as_manager
    _et, ids = await _entries(db_session, 1)
    await db_session.commit()

    res = await db_client.request("DELETE", ENDPOINT, json=_body(ids, articleId=str(uuid4())))

    assert res.status_code == 404, res.text


async def test_a_singleton_is_refused_not_deleted(
    db_session: AsyncSession, db_client: AsyncClient, as_manager: UUID
) -> None:
    """A ``cardinality='one'`` instance is scaffolding the session seeds, not
    an entry a reviewer added. Deleting one through the entry control would
    empty a section the completion gate still counts."""
    del as_manager
    entity_type_id, _key_id, _value_id = await _group(db_session, cardinality="one")
    singleton = await _instance(db_session, entity_type_id, "Study summary")
    await db_session.commit()

    res = await db_client.request("DELETE", ENDPOINT, json=_body([singleton]))

    assert res.status_code == 422, res.text


async def test_an_empty_list_is_refused_by_the_schema(
    db_session: AsyncSession, db_client: AsyncClient, as_manager: UUID
) -> None:
    del db_session, as_manager
    res = await db_client.request("DELETE", ENDPOINT, json=_body([]))
    assert res.status_code == 422, res.text


async def test_a_duplicate_id_is_refused_by_the_schema(
    db_session: AsyncSession, db_client: AsyncClient, as_manager: UUID
) -> None:
    """Otherwise ``deleted`` would over-report: the batch names one row twice
    and the count would say two."""
    del as_manager
    _et, ids = await _entries(db_session, 1)
    res = await db_client.request("DELETE", ENDPOINT, json=_body([ids[0], ids[0]]))
    assert res.status_code == 422, res.text


async def test_an_outsider_gets_403(
    db_session: AsyncSession, db_client: AsyncClient, as_outsider: UUID
) -> None:
    del as_outsider
    _et, ids = await _entries(db_session, 1)
    await db_session.commit()

    res = await db_client.request("DELETE", ENDPOINT, json=_body(ids))

    assert res.status_code == 403, res.text


async def test_a_member_who_is_not_a_reviewer_gets_403(
    db_session: AsyncSession, db_client: AsyncClient, as_viewer: UUID
) -> None:
    """Deleting an entry destroys reviewer decisions recorded against it, so
    membership alone is not enough — the same gate the create sibling uses."""
    del as_viewer
    _et, ids = await _entries(db_session, 1)
    await db_session.commit()

    res = await db_client.request("DELETE", ENDPOINT, json=_body(ids))

    assert res.status_code == 403, res.text


async def test_a_reviewer_who_is_not_a_manager_gets_403(
    db_session: AsyncSession, db_client: AsyncClient, as_reviewer: UUID
) -> None:
    """The gate matches the RLS policy on the SAME table.

    `extraction_instances_delete` is `USING is_project_manager(...)` — verified
    against production — and the single delete beside this endpoint is a
    browser PostgREST call that RLS therefore refuses to a reviewer. A reviewer
    passes `is_project_reviewer`, so this test is what keeps the bulk path from
    silently becoming the more permissive of the two.
    """
    del as_reviewer
    _et, ids = await _entries(db_session, 1)
    await db_session.commit()

    res = await db_client.request("DELETE", ENDPOINT, json=_body(ids))

    assert res.status_code == 403, res.text
    assert "Manager" in res.json()["error"]["message"], res.text
