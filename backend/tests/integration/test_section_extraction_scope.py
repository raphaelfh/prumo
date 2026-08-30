"""BOLA: every client-supplied id must belong to the request's coordinate.

``_check_request_scope`` bound ``project_id`` / ``article_id`` /
``template_id`` to the run, but two ids the caller also supplies were never
bound to it:

``entity_type_id`` — a member could name ANY entity type, including a
GLOBAL-catalogue one whose ids are deterministic (``uuid5``) and public. The
kickoff then recorded ``ExtractionInstance(template_id=run.template_id,
entity_type_id=<global>)``, and that FK is ``ON DELETE RESTRICT``, so the row
silently stopped the boot-time catalogue replace from converging
(``seed_probast_ai`` downgrades the replace to a loud skip while any
reference exists).

``parent_instance_id`` — a member of project A could name an instance from
project B. The new child row landed in A's article but carried B's
``template_id`` and a ``parent_instance_id`` FK pointing into B's data: a
cross-tenant write, and another RESTRICT-guarded reference blocking B's
template deletion.

Proven at the endpoint: the queue seam is the only stub, so a rejected
request must never reach ``.delay``. The positive controls keep the gates
from over-rejecting legitimate own-coordinate ids.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import section_extraction as se
from app.repositories.extraction_repository import ExtractionInstanceRepository
from tests.integration.conftest import CHARMS_GLOBAL_ID, SEED, first_entity_type_id
from tests.integration.helpers import engine_setup
from tests.integration.helpers.template_fixtures import add_instance, fresh_charms

client_as_manager = engine_setup.client_as_manager
client_as_reviewer = engine_setup.client_as_reviewer
client_as_outsider = engine_setup.client_as_outsider

# Only the same-project/other-article row has no ready-made helper; everything
# else reuses the suite's CHARMS fixtures. Created inside the test's SAVEPOINT
# (``db_session`` rolls back), so nothing reaches the shared dev DB.
_OTHER_ARTICLE_ID = UUID("ffffffff-9999-0002-0000-000000000008")
_OTHER_ARTICLE_INSTANCE_ID = UUID("ffffffff-9999-0006-0000-000000000008")


async def _global_entity_type(db: AsyncSession) -> UUID:
    """A REAL catalogue entity type — the ids an attacker actually has.

    Global lineage is ``template_id`` set / ``project_template_id`` NULL (the
    XOR on the table), which every seeded catalogue row satisfies.
    """
    return (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE template_id = :tid ORDER BY sort_order LIMIT 1"
            ),
            {"tid": str(CHARMS_GLOBAL_ID)},
        )
    ).scalar_one()


async def _foreign_template_entity_type(db: AsyncSession) -> UUID:
    """An entity type owned by a template in ANOTHER project."""
    _, template_id, _ = await fresh_charms(db)
    return await first_entity_type_id(db, template_id)


async def _foreign_project_instance(db: AsyncSession) -> UUID:
    """An instance owned by ANOTHER project's article and template."""
    project_id, template_id, _ = await fresh_charms(db)
    return await add_instance(
        db,
        project_id=project_id,
        template_id=template_id,
        entity_type_id=await first_entity_type_id(db, template_id),
    )


async def _other_article_instance(db: AsyncSession) -> UUID:
    """An instance on the caller's own project but a DIFFERENT article.

    Not cross-tenant, but still incoherent: the child would be filed under
    one article while its parent lives in another.
    """
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'scope-test second article', 1) "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(_OTHER_ARTICLE_ID), "pid": str(SEED.primary_project)},
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, template_id, entity_type_id, article_id, label, created_by) "
            "VALUES (:id, :pid, :tid, :etid, :aid, 'scope-test instance', :uid) "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {
            "id": str(_OTHER_ARTICLE_INSTANCE_ID),
            "pid": str(SEED.primary_project),
            "tid": str(SEED.primary_template),
            "etid": str(SEED.primary_entity_type),
            "aid": str(_OTHER_ARTICLE_ID),
            "uid": str(SEED.primary_profile),
        },
    )
    return _OTHER_ARTICLE_INSTANCE_ID


async def _unknown_id(_db: AsyncSession) -> UUID:
    """An id that matches nothing at all."""
    return UUID("ffffffff-9999-0004-0000-0000000000ff")


def _payload(entity_type_id: UUID) -> dict:
    return {
        "projectId": str(SEED.primary_project),
        "articleId": str(SEED.primary_article),
        "templateId": str(SEED.primary_template),
        "entityTypeId": str(entity_type_id),
    }


def _parent_payload(parent_instance_id: UUID) -> dict:
    return {**_payload(SEED.primary_entity_type), "parentInstanceId": str(parent_instance_id)}


def _batch_parent_payload(parent_instance_id: UUID) -> dict:
    """The BATCH dispatch branch: ``parentInstanceId`` alone routes to
    ``extract_all_sections``, and the request validator requires
    ``extractAllSections`` there."""
    body = _parent_payload(parent_instance_id)
    del body["entityTypeId"]
    body["extractAllSections"] = True
    return body


def _stub_queue(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Stub the queue seam only — the gate must run for real."""
    monkeypatch.setattr(se, "_is_queue_available", lambda: True)
    fake_delay = MagicMock(return_value=MagicMock(id="job-1"))
    monkeypatch.setattr(se, "run_section_extraction_task", MagicMock(delay=fake_delay))
    monkeypatch.setattr(se, "_remember_job_owner", lambda *_a, **_k: None)
    return fake_delay


# ======================================================================
# Rejections — one table, because every case is the same assertion
# ======================================================================

_ENTITY_DETAIL = "entityTypeId does not belong to templateId"
_PARENT_DETAIL = "parentInstanceId does not belong to this coordinate"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("build_id", "build_payload", "detail"),
    [
        (_global_entity_type, _payload, _ENTITY_DETAIL),
        (_foreign_template_entity_type, _payload, _ENTITY_DETAIL),
        (_unknown_id, _payload, _ENTITY_DETAIL),
        (_foreign_project_instance, _parent_payload, _PARENT_DETAIL),
        (_other_article_instance, _parent_payload, _PARENT_DETAIL),
        (_unknown_id, _parent_payload, _PARENT_DETAIL),
        (_foreign_project_instance, _batch_parent_payload, _PARENT_DETAIL),
    ],
    ids=[
        "entity_type/global-catalogue",
        "entity_type/another-template",
        "entity_type/unknown",
        "parent/another-project",
        "parent/another-article",
        "parent/unknown",
        "parent/batch-branch",
    ],
)
async def test_out_of_scope_id_is_rejected(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    build_id,
    build_payload,
    detail: str,
) -> None:
    """Every out-of-scope id answers 400 with the same message a missing one
    gets, and none of them reach the queue.

    ``parent/batch-branch`` matters on its own: ``parentInstanceId`` with no
    ``entityTypeId`` routes to ``extract_all_sections``, a different dispatch
    branch behind the same gate.
    """
    fake_delay = _stub_queue(monkeypatch)

    r = await client_as_manager.post(
        "/api/v1/extraction/sections", json=build_payload(await build_id(db_session))
    )

    assert r.status_code == 400, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["message"] == detail
    fake_delay.assert_not_called()


@pytest.mark.asyncio
async def test_run_continuation_is_gated_too(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ``runId`` path — how the QA surface always calls — gates equally.

    Matching ``runId`` binds project/article/template; the leaf ids are what
    that check never reached.
    """
    fake_delay = _stub_queue(monkeypatch)
    run = await engine_setup.run_in_extract(db_session)
    entity_type_id = await _global_entity_type(db_session)

    r = await client_as_manager.post(
        "/api/v1/extraction/sections",
        json={**_payload(entity_type_id), "runId": str(run.id)},
    )

    assert r.status_code == 400, r.text
    fake_delay.assert_not_called()


@pytest.mark.asyncio
async def test_cross_tenant_parent_is_rejected_for_a_single_project_member(
    client_as_reviewer: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The realistic caller: one with no standing in the parent's project.

    The guard is coordinate-based, so identity does not change its answer —
    the table row above already covers the mechanism. This pins the OUTCOME
    for a caller who is a member of the primary project only (the manager
    profile manages both seed projects), so a future identity-dependent
    rewrite cannot quietly pass.
    """
    fake_delay = _stub_queue(monkeypatch)
    parent_id = await _foreign_project_instance(db_session)

    r = await client_as_reviewer.post(
        "/api/v1/extraction/sections", json=_parent_payload(parent_id)
    )

    assert r.status_code == 400, r.text
    fake_delay.assert_not_called()


@pytest.mark.asyncio
async def test_outsider_gets_403_before_any_leaf_check(
    client_as_outsider: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Membership precedes BOTH gates: a non-member carrying two foreign ids
    learns nothing about either."""
    fake_delay = _stub_queue(monkeypatch)
    body = _parent_payload(await _foreign_project_instance(db_session))
    body["entityTypeId"] = str(await _global_entity_type(db_session))

    r = await client_as_outsider.post("/api/v1/extraction/sections", json=body)

    assert r.status_code == 403, r.text
    fake_delay.assert_not_called()


# ======================================================================
# Positive controls — the gates must not over-reject
# ======================================================================


@pytest.mark.asyncio
async def test_own_template_entity_type_still_enqueues(
    client_as_manager: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_delay = _stub_queue(monkeypatch)

    r = await client_as_manager.post(
        "/api/v1/extraction/sections", json=_payload(SEED.primary_entity_type)
    )

    assert r.status_code == 202, r.text
    fake_delay.assert_called_once()


@pytest.mark.asyncio
async def test_own_coordinate_parent_instance_still_enqueues(
    client_as_manager: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_delay = _stub_queue(monkeypatch)

    r = await client_as_manager.post(
        "/api/v1/extraction/sections", json=_parent_payload(SEED.primary_instance)
    )

    assert r.status_code == 202, r.text
    fake_delay.assert_called_once()


@pytest.mark.asyncio
async def test_scope_predicate_lives_in_the_query(db_session: AsyncSession) -> None:
    """The durable half, against real SQL.

    ``get_in_coordinate`` filters in the statement rather than comparing
    after a bare ``get_by_id``, so a future caller cannot forget the scope:
    an out-of-coordinate row is indistinguishable from a missing one.
    """
    repo = ExtractionInstanceRepository(db_session)
    coordinate = {
        "project_id": SEED.primary_project,
        "article_id": SEED.primary_article,
        "template_id": SEED.primary_template,
    }

    assert (
        await repo.get_in_coordinate(await _foreign_project_instance(db_session), **coordinate)
        is None
    )
    assert (
        await repo.get_in_coordinate(await _other_article_instance(db_session), **coordinate)
        is None
    )

    own = await repo.get_in_coordinate(SEED.primary_instance, **coordinate)
    assert own is not None
    assert own.id == SEED.primary_instance


@pytest.mark.asyncio
async def test_foreign_template_is_rejected_without_an_entity_type_oracle(
    client_as_reviewer: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``templateId`` must belong to ``projectId`` on the no-run branch.

    Nothing bound them there: only the worker's ``create_run`` did, long
    after the 202. So a foreign templateId paired with a MATCHING entity
    type enqueued (202) while a non-matching one was refused (400) — and
    that difference is a cross-project oracle for "does entity type X belong
    to template Y". Both must now answer 400 identically.

    The reviewer profile is a member of the primary project only, so this is
    a real tenant boundary rather than a coordinate mismatch.
    """
    fake_delay = _stub_queue(monkeypatch)
    _, foreign_template, _ = await fresh_charms(db_session)
    matching_entity_type = await first_entity_type_id(db_session, foreign_template)

    async def _post(entity_type_id: UUID) -> int:
        r = await client_as_reviewer.post(
            "/api/v1/extraction/sections",
            json={**_payload(entity_type_id), "templateId": str(foreign_template)},
        )
        return r.status_code

    # The pair that used to enqueue, and the pair that used to 400.
    assert await _post(matching_entity_type) == 400
    assert await _post(SEED.primary_entity_type) == 400
    fake_delay.assert_not_called()
