"""REPRO (bug: manager annotates over AI suggestion, refresh loses everything).

Faithful HTTP-level reproduction of the reported flow, as the seeded MANAGER
(primary_profile is a manager of primary_project):

  1. POST /api/v1/hitl/sessions (extraction)         -> open (session run R)
  2. POST /api/v1/runs/{R}/decisions  decision='edit' -> the manager "types"
  3. POST /api/v1/hitl/sessions (extraction) again    -> RELOAD

Then assert the manager's edit is still in ``run_view.current_values``.
If it is empty, the bug is reproduced at the backend boundary.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
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


@pytest.mark.asyncio
async def test_manager_edit_survives_a_newer_empty_run(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """REGRESSION: the manager edits run R1, then a NEWER non-terminal run R2
    appears (e.g. a model/full-AI extraction that forked its own run). On
    reload, open_or_resume must resolve the run that HOLDS the reviewer's
    work (R1) — never the newer empty R2 — so the manager's edits survive.

    Before the fix, reload resolved R2 (newest) and current_values was empty."""
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

    # A newer non-terminal run appears (e.g. AI full-extraction created one,
    # or a standalone extraction run) — created strictly AFTER R1's edit.
    run_2 = (
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_runs
                    (id, project_id, article_id, template_id, version_id, kind,
                     stage, status, created_by, created_at)
                SELECT gen_random_uuid(), project_id, article_id, template_id,
                       version_id, kind, 'extract', status, created_by,
                       now() + interval '1 second'
                FROM public.extraction_runs WHERE id = :r1
                RETURNING id
                """
            ),
            {"r1": run_1},
        )
    ).scalar()
    await db_session.commit()

    reloaded = await _open_session(db_client)
    cv = reloaded["run_view"]["current_values"]
    found = [c for c in cv if c["instance_id"] == instance_id and c["field_id"] == field_id]
    # After the fix: reload resolves R1 (the run with the reviewer's decision),
    # NOT the newer empty R2, and the manager's edit is intact.
    assert reloaded["run_id"] == run_1, (
        f"reload must resolve the run holding human work (R1={run_1}), "
        f"got {reloaded['run_id']} (R2={run_2})"
    )
    assert found, f"manager edit LOST: current_values={cv!r}"
    assert found[0]["value"] == {"value": "MANAGER-TYPED-VALUE"}, found[0]


@pytest.mark.asyncio
async def test_consensus_only_run_survives_a_newer_empty_run(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """REGRESSION (adversarial review): a run holding ONLY consensus work — an
    arbitrator's manual override, with ZERO reviewer decisions — must not be
    orphaned by a newer empty run. The resolver ranks by ALL human activity
    (reviewer decisions, consensus decisions, human proposals), not just
    reviewer decisions."""
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

    # R1 moves to consensus and holds an arbitrator manual-override — consensus
    # work, but no reviewer decisions (so the reviewer-only signal is NULL).
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'consensus' WHERE id = :rid"),
        {"rid": run_1},
    )
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_consensus_decisions
                (id, run_id, instance_id, field_id, consensus_user_id, mode, value, created_at)
            VALUES (gen_random_uuid(), :rid, :iid, :fid, :uid, 'manual_override',
                    '{"value": "ARBITRATOR-VALUE"}'::jsonb, now())
            """
        ),
        {"rid": run_1, "iid": instance_id, "fid": field_id, "uid": str(SEED.primary_profile)},
    )
    # A newer empty EXTRACT run appears (strictly after R1's consensus work).
    run_2 = (
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_runs
                    (id, project_id, article_id, template_id, version_id, kind,
                     stage, status, created_by, created_at)
                SELECT gen_random_uuid(), project_id, article_id, template_id,
                       version_id, kind, 'extract', status, created_by,
                       now() + interval '1 second'
                FROM public.extraction_runs WHERE id = :r1
                RETURNING id
                """
            ),
            {"r1": run_1},
        )
    ).scalar()
    await db_session.commit()

    reloaded = await _open_session(db_client)
    assert reloaded["run_id"] == run_1, (
        f"reload must resolve the consensus-work run (R1={run_1}), "
        f"got {reloaded['run_id']} (R2={run_2})"
    )
