"""POST /api/v1/extraction/instances — create one entry of any group.

Modelled on ``test_instance_identity``'s endpoint half (the PATCH sibling
on the same router): ``db_client`` over the real savepoint session, plus
``get_current_user`` overridden to a SEED profile. Deliberately NOT the
``client`` fixture — its DB is an ``AsyncMock``, so no row can be created
or refused through it.

Error branches in the endpoint call ``db.rollback()``, which unwinds the
savepoint the fixture rows were written in. Tests that fire a refusal
therefore ``commit()`` after setup: that releases the savepoint and the
``after_transaction_end`` hook opens a fresh one, so the rows survive.
"""

from __future__ import annotations

import json
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
async def as_reviewer(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
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
    """A MEMBER who is not a reviewer.

    ``is_project_reviewer`` accepts manager / reviewer / consensus, so a
    ``viewer`` membership is the only shape that passes the member gate and
    fails the reviewer gate. The seed has no such row — this makes one.
    """
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


def _body(**overrides: object) -> dict:
    return {
        "projectId": str(SEED.primary_project),
        "articleId": str(SEED.primary_article),
        "templateId": str(SEED.primary_template),
        **overrides,
    }


async def test_post_creates_the_entry(
    db_session: AsyncSession, db_client: AsyncClient, as_reviewer: UUID
) -> None:
    del as_reviewer  # the fixture overrides auth; its value is unused
    entity_type_id, _key_id, _value_id = await _group(db_session)

    res = await db_client.post(
        ENDPOINT,
        json=_body(entityTypeId=str(entity_type_id), label="Cox Model", entityKey="Cox Model"),
    )

    assert res.status_code == 201, res.text
    data = res.json()["data"]
    assert data["label"] == "Cox Model"
    stored = (
        await db_session.execute(
            text("SELECT metadata FROM public.extraction_instances WHERE id = :id"),
            {"id": data["instanceId"]},
        )
    ).scalar_one()
    metadata = stored if isinstance(stored, dict) else json.loads(stored)
    assert metadata["entity_key"] == "cox model"
    assert metadata["created_via"] == "manual"


async def test_a_duplicate_key_answers_the_typed_409(
    db_session: AsyncSession, db_client: AsyncClient, as_reviewer: UUID
) -> None:
    del as_reviewer  # the fixture overrides auth; its value is unused
    entity_type_id, _key_id, _value_id = await _group(db_session)
    await _instance(db_session, entity_type_id, "Cox Model")
    await db_session.commit()  # survive the endpoint's rollback

    res = await db_client.post(
        ENDPOINT,
        json=_body(entityTypeId=str(entity_type_id), label="cox   model", entityKey="cox   model"),
    )

    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "ENTRY_KEY_DUPLICATE"


async def test_a_foreign_parent_answers_404(
    db_session: AsyncSession, db_client: AsyncClient, as_reviewer: UUID
) -> None:
    del as_reviewer  # the fixture overrides auth; its value is unused
    parent_type_id, _k, _v = await _group(db_session)
    nested_type_id, _nk, _nv = await _group(
        db_session, parent=parent_type_id, label="Nested"
    )
    await db_session.commit()

    res = await db_client.post(
        ENDPOINT,
        json=_body(
            entityTypeId=str(nested_type_id),
            parentInstanceId=str(uuid4()),  # no such instance
            label="Age",
            entityKey="Age",
        ),
    )

    assert res.status_code == 404, res.text


async def test_a_singleton_section_answers_422(
    db_session: AsyncSession, db_client: AsyncClient, as_reviewer: UUID
) -> None:
    del as_reviewer  # the fixture overrides auth; its value is unused
    entity_type_id, _key_id, _value_id = await _group(db_session, cardinality="one")
    await db_session.commit()

    res = await db_client.post(ENDPOINT, json=_body(entityTypeId=str(entity_type_id), label="Nope"))

    assert res.status_code == 422, res.text


async def test_a_blank_label_answers_422(
    db_session: AsyncSession, db_client: AsyncClient, as_reviewer: UUID
) -> None:
    del as_reviewer  # the fixture overrides auth; its value is unused
    entity_type_id, _key_id, _value_id = await _group(db_session)
    await db_session.commit()

    res = await db_client.post(
        ENDPOINT,
        json=_body(entityTypeId=str(entity_type_id), label="   ", entityKey="Cox"),
    )

    assert res.status_code == 422, res.text


async def test_an_unknown_field_answers_422(
    db_session: AsyncSession, db_client: AsyncClient, as_reviewer: UUID
) -> None:
    """``extra="forbid"``: a stale tab gets a loud refusal, not a lost value."""
    del as_reviewer  # the fixture overrides auth; its value is unused
    entity_type_id, _key_id, _value_id = await _group(db_session)
    await db_session.commit()

    res = await db_client.post(
        ENDPOINT,
        json=_body(entityTypeId=str(entity_type_id), label="Cox", entityKey="Cox", modelName="Cox"),
    )

    assert res.status_code == 422, res.text


async def test_a_non_member_answers_403(
    db_session: AsyncSession, db_client: AsyncClient, as_outsider: UUID
) -> None:
    del as_outsider  # the fixture overrides auth; its value is unused
    entity_type_id, _key_id, _value_id = await _group(db_session)
    await db_session.commit()

    res = await db_client.post(
        ENDPOINT,
        json=_body(entityTypeId=str(entity_type_id), label="Cox Model", entityKey="Cox Model"),
    )

    assert res.status_code == 403, res.text


async def test_a_member_who_is_not_a_reviewer_answers_403(
    db_session: AsyncSession, db_client: AsyncClient, as_viewer: UUID
) -> None:
    """Creating an entry authors an audit-trail row, so membership alone is
    not enough — the same gate the PATCH sibling carries."""
    del as_viewer  # the fixture overrides auth; its value is unused
    entity_type_id, _key_id, _value_id = await _group(db_session)
    await db_session.commit()

    res = await db_client.post(
        ENDPOINT,
        json=_body(entityTypeId=str(entity_type_id), label="Cox Model", entityKey="Cox Model"),
    )

    assert res.status_code == 403, res.text
