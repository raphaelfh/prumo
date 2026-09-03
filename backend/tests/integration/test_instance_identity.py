"""Re-key is a reviewer action folded into the rename path.

Renaming an entry rewrites its human-facing ``label``; re-keying rewrites
``metadata.entity_key`` — the identity an AI re-run matches against — and
appends ``{who, when, from, to}`` to ``metadata.entity_key_history``
(append-only, constitution §IX). Both travel through one endpoint,
``PATCH /api/v1/extraction/instances/{id}``, guarded by the coordinate the
client already holds (``get_in_coordinate`` — the ONE instance-in-coordinate
predicate) and the reviewer gate. Merge stays out (identity spec §7).
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
from app.services.instance_identity_service import (
    InstanceNotFoundError,
    update_instance_identity,
)
from tests.integration.conftest import SEED
from tests.integration.test_entry_group_extraction import (
    _coord,
    _entries,
    _fake_identification,
    _group,
    _instance,
    _run_in_extract,
    _service,
)

pytestmark = pytest.mark.asyncio


async def _metadata(db: AsyncSession, instance_id: UUID) -> dict:
    stored = (
        await db.execute(
            text("SELECT metadata FROM public.extraction_instances WHERE id = :id"),
            {"id": instance_id},
        )
    ).scalar_one()
    return stored if isinstance(stored, dict) else json.loads(stored)


# --------------------------------------------------------------------------
# service
# --------------------------------------------------------------------------


async def test_rename_and_rekey_write_both_and_record_the_history(db_session: AsyncSession) -> None:
    entity_type_id, _key_id, _value_id = await _group(db_session)
    instance_id = await _instance(db_session, entity_type_id, "apparent")

    view = await update_instance_identity(
        db_session,
        instance_id=instance_id,
        **_coord(),
        actor_id=SEED.primary_profile,
        label="Apparent validation (derivation cohort)",
        entity_key="internal",
    )

    assert view.id == instance_id
    assert view.label == "Apparent validation (derivation cohort)"
    stored = await _metadata(db_session, instance_id)
    assert stored["entity_key"] == "internal"
    (entry,) = stored["entity_key_history"]
    assert entry["who"] == str(SEED.primary_profile)
    assert entry["from"] == "apparent" and entry["to"] == "internal"
    assert entry["when"]


async def test_rename_alone_leaves_the_identity_and_its_history_untouched(
    db_session: AsyncSession,
) -> None:
    entity_type_id, _key_id, _value_id = await _group(db_session)
    instance_id = await _instance(db_session, entity_type_id, "apparent")

    await update_instance_identity(
        db_session,
        instance_id=instance_id,
        **_coord(),
        actor_id=SEED.primary_profile,
        label="Renamed",
        entity_key=None,
    )

    stored = await _metadata(db_session, instance_id)
    assert stored["entity_key"] == "apparent"
    assert "entity_key_history" not in stored


async def test_a_foreign_coordinate_is_not_found_not_forbidden(db_session: AsyncSession) -> None:
    """Scope goes in the WHERE clause: missing and foreign answer identically."""
    entity_type_id, _key_id, _value_id = await _group(db_session)
    instance_id = await _instance(db_session, entity_type_id, "apparent")
    for wrong in ({"project_id": SEED.secondary_project}, {"article_id": uuid4()}):
        with pytest.raises(InstanceNotFoundError):
            await update_instance_identity(
                db_session,
                instance_id=instance_id,
                **_coord(**wrong),
                actor_id=SEED.primary_profile,
                label="Renamed",
                entity_key=None,
            )
    assert (await _metadata(db_session, instance_id))["entity_key"] == "apparent"


async def test_a_rerun_matches_the_rekeyed_instance(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The point of re-keying: the next AI pass lands on the row the reviewer
    pointed it at, instead of adding a second entry for the same thing."""
    entity_type_id, _key_id, value_id = await _group(db_session)
    run = await _run_in_extract(db_session)
    service, _fake = _service(db_session)
    identification = _fake_identification(monkeypatch, ["apparent"])
    await service.extract_section(**_coord(), entity_type_id=entity_type_id, run_id=run.id)
    ((instance_id, _key),) = await _entries(db_session, entity_type_id)

    await update_instance_identity(
        db_session,
        instance_id=instance_id,
        **_coord(),
        actor_id=SEED.primary_profile,
        label=None,
        entity_key="internal",
    )

    identification["names"][:] = ["internal"]
    await service.extract_section(**_coord(), entity_type_id=entity_type_id, run_id=run.id)

    entries = await _entries(db_session, entity_type_id)
    assert entries == [(instance_id, "internal")], "matched the re-keyed row, no fork"
    assert "internal" in identification["prompts"][1], "grounding lists the re-keyed identity"
    del value_id


# --------------------------------------------------------------------------
# endpoint
# --------------------------------------------------------------------------


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


def _body(**overrides: object) -> dict:
    return {
        "projectId": str(SEED.primary_project),
        "articleId": str(SEED.primary_article),
        "templateId": str(SEED.primary_template),
        **overrides,
    }


async def test_patch_renames_and_rekeys_as_the_caller(
    db_session: AsyncSession, db_client: AsyncClient, as_reviewer: UUID
) -> None:
    entity_type_id, _key_id, _value_id = await _group(db_session)
    instance_id = await _instance(db_session, entity_type_id, "apparent")

    res = await db_client.patch(
        f"/api/v1/extraction/instances/{instance_id}",
        json=_body(label="Internal validation", entityKey="internal"),
    )

    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["label"] == "Internal validation"
    assert data["metadata"]["entity_key"] == "internal"
    assert data["metadata"]["entity_key_history"][0]["who"] == str(as_reviewer)


async def test_patch_refuses_an_outsider_before_touching_the_row(
    db_session: AsyncSession, db_client: AsyncClient, as_outsider: UUID
) -> None:
    del as_outsider
    entity_type_id, _key_id, _value_id = await _group(db_session)
    instance_id = await _instance(db_session, entity_type_id, "apparent")

    res = await db_client.patch(
        f"/api/v1/extraction/instances/{instance_id}", json=_body(label="Stolen")
    )

    assert res.status_code == 403
    assert (await _metadata(db_session, instance_id))["entity_key"] == "apparent"


async def test_patch_answers_404_for_an_instance_off_the_coordinate(
    db_session: AsyncSession, db_client: AsyncClient, as_reviewer: UUID
) -> None:
    del as_reviewer
    entity_type_id, _key_id, _value_id = await _group(db_session)
    instance_id = await _instance(db_session, entity_type_id, "apparent")

    res = await db_client.patch(
        f"/api/v1/extraction/instances/{instance_id}",
        json=_body(articleId=str(uuid4()), label="Elsewhere"),
    )

    assert res.status_code == 404


async def test_patch_rejects_a_body_that_changes_nothing_or_blanks_a_column(
    db_session: AsyncSession, db_client: AsyncClient, as_reviewer: UUID
) -> None:
    del as_reviewer
    entity_type_id, _key_id, _value_id = await _group(db_session)
    instance_id = await _instance(db_session, entity_type_id, "apparent")

    for body in (_body(), _body(label="   "), _body(entityKey="")):
        res = await db_client.patch(f"/api/v1/extraction/instances/{instance_id}", json=body)
        assert res.status_code == 422, body
