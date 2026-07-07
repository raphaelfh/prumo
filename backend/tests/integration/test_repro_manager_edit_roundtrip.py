"""REPRO (bug: manager annotates over AI suggestion, refresh loses everything).

Faithful HTTP-level reproduction of the reported flow, as the seeded MANAGER
(primary_profile is a manager of primary_project):

  1. POST /api/v1/hitl/sessions (extraction)         -> open (session run R)
  2. POST /api/v1/runs/{R}/decisions  decision='edit' -> the manager "types"
  3. POST /api/v1/hitl/sessions (extraction) again    -> RELOAD

Then assert the manager's edit is still in ``run_view.current_values``.

The orphaning mechanism (a newer parallel non-terminal run shadowing the run
that holds the manager's work) is UNREPRESENTABLE since migration 0045: the
partial unique index ``uq_one_live_extraction_run_per_coord`` rejects the
second live run outright, so the shadow-run tests below assert the rejection
itself. The resolver's human-work ranking (defense-in-depth for pre-heal
data) is covered by the heal test in ``test_one_live_run_guard_migration``.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from tests.integration.conftest import SEED

_SESSION_URL = "/api/v1/hitl/sessions"


@pytest_asyncio.fixture
async def auth_as_manager(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    del db_session
    profile_id = SEED.primary_profile  # manager of primary_project

    async def override() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="primary@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override
    try:
        yield profile_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def _open_session(client: AsyncClient) -> dict:
    res = await client.post(
        _SESSION_URL,
        json={
            "kind": "extraction",
            "project_id": str(SEED.primary_project),
            "article_id": str(SEED.primary_article),
            "project_template_id": str(SEED.primary_template),
        },
    )
    assert res.status_code in (200, 201), res.text
    body = res.json()
    assert body["ok"] is True, body
    return body["data"]


@pytest.mark.asyncio
async def test_manager_edit_survives_reload(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    # 1. OPEN
    opened = await _open_session(db_client)
    run_id = opened["run_id"]
    view = opened["run_view"]
    assert view["run"]["stage"] == "extract", view["run"]["stage"]

    # Pick a real coord on this run (first instance/field of the template).
    coord = (
        await db_session.execute(
            text(
                """
                SELECT i.id, f.id
                FROM public.extraction_instances i
                JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
                JOIN public.extraction_fields f ON f.entity_type_id = et.id
                WHERE i.template_id = :tid AND i.article_id = :aid
                ORDER BY i.id, f.id
                LIMIT 1
                """
            ),
            {"tid": str(SEED.primary_template), "aid": str(SEED.primary_article)},
        )
    ).first()
    assert coord is not None, "seed graph must have at least one (instance, field)"
    instance_id, field_id = str(coord[0]), str(coord[1])

    # 2. TYPE (manager records an edit over the field)
    dec = await db_client.post(
        f"/api/v1/runs/{run_id}/decisions",
        json={
            "instance_id": instance_id,
            "field_id": field_id,
            "decision": "edit",
            "value": {"value": "MANAGER-TYPED-VALUE"},
        },
    )
    assert dec.status_code in (200, 201), dec.text  # "Saved" badge == this succeeding

    # 3. RELOAD (open session again — mimics the page refresh)
    reloaded = await _open_session(db_client)
    assert reloaded["run_id"] == run_id, (
        f"reload resolved a DIFFERENT run: wrote to {run_id}, reload got {reloaded['run_id']}"
    )
    cv = reloaded["run_view"]["current_values"]
    key = f"{instance_id}/{field_id}"
    found = [c for c in cv if c["instance_id"] == instance_id and c["field_id"] == field_id]
    assert found, (
        f"manager edit LOST on reload: current_values has no entry for {key}. current_values={cv!r}"
    )
    assert found[0]["value"] == {"value": "MANAGER-TYPED-VALUE"}, found[0]


_SHADOW_RUN_INSERT = text(
    """
    INSERT INTO public.extraction_runs
        (id, project_id, article_id, template_id, version_id, kind,
         stage, status, created_by, created_at)
    SELECT gen_random_uuid(), project_id, article_id, template_id,
           version_id, kind, 'extract', 'pending', created_by,
           now() + interval '1 second'
    FROM public.extraction_runs WHERE id = :r1
    RETURNING id
    """
)


@pytest.mark.asyncio
async def test_second_live_run_is_unrepresentable(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """The orphaning MECHANISM is dead at the DB level (migration 0045): with
    the session run R1 live, inserting the shadow run R2 that used to swallow
    the manager's edits on refresh violates
    ``uq_one_live_extraction_run_per_coord`` outright. Before 0045 this INSERT
    succeeded and reload resolved the empty R2, losing R1's decisions."""
    opened = await _open_session(db_client)
    run_1 = opened["run_id"]

    coord = (
        await db_session.execute(
            text(
                """
                SELECT i.id, f.id
                FROM public.extraction_instances i
                JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
                JOIN public.extraction_fields f ON f.entity_type_id = et.id
                WHERE i.template_id = :tid AND i.article_id = :aid
                ORDER BY i.id, f.id
                LIMIT 1
                """
            ),
            {"tid": str(SEED.primary_template), "aid": str(SEED.primary_article)},
        )
    ).first()
    instance_id, field_id = str(coord[0]), str(coord[1])

    dec = await db_client.post(
        f"/api/v1/runs/{run_1}/decisions",
        json={
            "instance_id": instance_id,
            "field_id": field_id,
            "decision": "edit",
            "value": {"value": "MANAGER-TYPED-VALUE"},
        },
    )
    assert dec.status_code in (200, 201), dec.text

    # The manager's edit is exactly where they left it on reload.
    reloaded = await _open_session(db_client)
    assert reloaded["run_id"] == run_1
    cv = reloaded["run_view"]["current_values"]
    found = [c for c in cv if c["instance_id"] == instance_id and c["field_id"] == field_id]
    assert found and found[0]["value"] == {"value": "MANAGER-TYPED-VALUE"}, cv

    # The forked shadow run (what model/full-AI extraction used to create) is
    # rejected by the partial unique index. LAST statement on purpose: the
    # violation aborts the fixture's savepoint-wrapped transaction, so nothing
    # else may run on this session — teardown rolls the outer txn back.
    with pytest.raises(IntegrityError, match="uq_one_live_extraction_run_per_coord"):
        await db_session.execute(_SHADOW_RUN_INSERT, {"r1": run_1})


@pytest.mark.asyncio
async def test_consensus_stage_run_also_blocks_a_second_live_run(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """CONSENSUS is inside the partial index too (adversarial-review finding:
    consensus-only arbitrator work used to be orphanable): with R1 in
    consensus, a fresh extract-stage fork is still rejected. Stage flip stays
    transaction-local so the shared coordinate is untouched on rollback."""
    opened = await _open_session(db_client)
    run_1 = opened["run_id"]

    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'consensus' WHERE id = :rid"),
        {"rid": run_1},
    )
    # LAST statement on purpose — see test_second_live_run_is_unrepresentable.
    with pytest.raises(IntegrityError, match="uq_one_live_extraction_run_per_coord"):
        await db_session.execute(_SHADOW_RUN_INSERT, {"r1": run_1})
