"""Blind title/abstract review over HTTP, on real Postgres: queue, decisions, derived outcomes."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from httpx import Response
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.screening import ScreeningDecision
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import client_as
from tests.integration.helpers.screening_fixtures import (
    add_decision,
    add_member,
    add_ruling,
    enroll_articles,
    make_screening_article,
    move_article,
    set_reviewer_count,
)
from tests.integration.helpers.shared_fixtures import make_project

MANAGER = SEED.primary_profile
REASONS = ["Wrong population", "Not ML"]
JAN_1 = datetime(2026, 1, 1, tzinfo=UTC)
JAN_2 = datetime(2026, 1, 2, tzinfo=UTC)


def _assignment_path(assignment_id: UUID) -> str:
    return f"/api/v1/screening/assignments/{assignment_id}"


def _decision_path(assignment_id: UUID) -> str:
    return f"/api/v1/screening/assignments/{assignment_id}/decisions"


def _queue_path(project_id: UUID) -> str:
    return f"/api/v1/projects/{project_id}/screening/queue"


async def _request(
    db: AsyncSession, user: UUID, method: str, path: str, body: dict[str, Any] | None = None
) -> Response:
    try:
        async with client_as(str(user), db) as client:
            return await client.request(method, path, json=body)
    finally:
        app.dependency_overrides.clear()


async def _get(db: AsyncSession, user: UUID, path: str) -> Response:
    return await _request(db, user, "GET", path)


async def _decide(
    db: AsyncSession, user: UUID, assignment_id: UUID, decision: str, reason: str | None = None
) -> Response:
    body: dict[str, Any] = {"decision": decision}
    if reason is not None:
        body["exclusion_reason"] = reason
    return await _request(db, user, "POST", _decision_path(assignment_id), body)


async def _project(
    db: AsyncSession, *, rc: int | None, reviewers: int = 0, articles: int = 1
) -> tuple[UUID, list[UUID], list[UUID], list[UUID]]:
    """A project with the protocol's reasons, ``reviewers`` reviewers and ``articles`` enrolled.

    Returns (project, reviewer ids, article ids, assignment ids).
    """
    project_id = await make_project(db)
    await db.execute(
        text("UPDATE public.projects SET eligibility_criteria = CAST(:e AS jsonb) WHERE id = :p"),
        {"e": '{"exclusion": ["Wrong population", "Not ML"]}', "p": str(project_id)},
    )
    members = [await add_member(db, project_id, "reviewer") for _ in range(reviewers)]
    article_ids = [await make_screening_article(db, project_id) for _ in range(articles)]
    assignment_ids = await enroll_articles(db, project_id, article_ids, by=MANAGER)
    if rc is not None:
        await set_reviewer_count(db, project_id, rc)
    return project_id, members, article_ids, assignment_ids


def _error_code(response: Response) -> str:
    return response.json()["error"]["code"]


async def test_solo_outcome(db_session: AsyncSession) -> None:
    _, (reviewer,), _, (assignment,) = await _project(db_session, rc=1, reviewers=1)

    response = await _decide(db_session, reviewer, assignment, "exclude", "Not ML")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "decided"
    assert data["outcome"] == {
        "kind": "solo",
        "decision": "exclude",
        "exclusion_reason": "Not ML",
        "reasons_differ": False,
    }
    assert data["my_decision"]["decision"] == "exclude"
    assert data["exclusion_reasons"] == REASONS


async def test_dual_blind_until_consensus(db_session: AsyncSession) -> None:
    _, (a, b), _, (assignment,) = await _project(db_session, rc=2, reviewers=2)
    await db_session.execute(
        text("UPDATE public.profiles SET full_name = 'Reviewer B' WHERE id = :id"), {"id": str(b)}
    )

    after_a = (await _decide(db_session, a, assignment, "include")).json()["data"]
    assert (after_a["status"], after_a["peer_decisions"], after_a["outcome"]) == (
        "awaiting_others",
        [],
        None,
    )

    b_view = (await _get(db_session, b, _assignment_path(assignment))).json()["data"]
    assert (b_view["status"], b_view["my_decision"], b_view["peer_decisions"]) == (
        "awaiting_me",
        None,
        [],
    )

    after_b = (await _decide(db_session, b, assignment, "include")).json()["data"]
    assert after_b["outcome"]["kind"] == "consensus"
    assert after_b["outcome"]["decision"] == "include"

    a_view = (await _get(db_session, a, _assignment_path(assignment))).json()["data"]
    assert a_view["status"] == "decided"
    assert len(a_view["peer_decisions"]) == 1
    peer = a_view["peer_decisions"][0]
    assert peer["id"] == after_b["my_decision"]["id"]
    assert (peer["reviewer_id"], peer["reviewer_name"], peer["decision"]) == (
        str(b),
        "Reviewer B",
        "include",
    )


async def test_conflict_is_hidden_from_reviewers_and_shown_to_arbitrators(
    db_session: AsyncSession,
) -> None:
    _, (a, b), _, (assignment,) = await _project(db_session, rc=2, reviewers=2)
    await _decide(db_session, a, assignment, "include")
    await _decide(db_session, b, assignment, "exclude", "Not ML")

    for reviewer in (a, b):
        view = (await _get(db_session, reviewer, _assignment_path(assignment))).json()["data"]
        assert (view["status"], view["peer_decisions"], view["outcome"]) == (
            "awaiting_others",
            [],
            None,
        )

    manager_view = (await _get(db_session, MANAGER, _assignment_path(assignment))).json()["data"]
    assert manager_view["status"] == "conflict"
    assert manager_view["my_decision"] is None
    assert {p["reviewer_id"] for p in manager_view["peer_decisions"]} == {str(a), str(b)}


async def test_three_reviewers(db_session: AsyncSession) -> None:
    _, (a, b, c), _, (assignment,) = await _project(db_session, rc=3, reviewers=3)
    await _decide(db_session, a, assignment, "include")

    after_b = (await _decide(db_session, b, assignment, "include")).json()["data"]
    assert (after_b["status"], after_b["outcome"]) == ("awaiting_others", None)

    after_c = (await _decide(db_session, c, assignment, "include")).json()["data"]
    assert after_c["status"] == "decided"
    assert after_c["outcome"]["kind"] == "consensus"
    assert len(after_c["peer_decisions"]) == 2


async def test_reviewer_beyond_cap_is_409(db_session: AsyncSession) -> None:
    _, (a, b, c), _, (assignment,) = await _project(db_session, rc=2, reviewers=3)
    await add_decision(db_session, assignment, a, "include", created_at=JAN_1)
    await add_decision(db_session, assignment, b, "include", created_at=JAN_1)

    refused = await _decide(db_session, c, assignment, "include")
    assert refused.status_code == 409
    assert _error_code(refused) == "SCREENING_REVIEWER_CAP"

    changed = await _decide(db_session, a, assignment, "maybe")
    assert changed.status_code == 200
    assert changed.json()["data"]["my_decision"]["decision"] == "maybe"
    rows = (
        await db_session.execute(
            select(func.count())
            .select_from(ScreeningDecision)
            .where(
                ScreeningDecision.assignment_id == assignment, ScreeningDecision.reviewer_id == a
            )
        )
    ).scalar_one()
    assert rows == 2


async def test_reviewer_change_after_a_ruling_leaves_it_in_force(db_session: AsyncSession) -> None:
    _, (a, b), _, (assignment,) = await _project(db_session, rc=2, reviewers=2)
    await add_decision(db_session, assignment, a, "include", created_at=JAN_1)
    await add_decision(db_session, assignment, b, "exclude", reason="Not ML", created_at=JAN_1)
    await add_ruling(db_session, assignment, MANAGER, "exclude", reason="Not ML", created_at=JAN_2)

    response = await _decide(db_session, a, assignment, "exclude", "Wrong population")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["my_decision"]["exclusion_reason"] == "Wrong population"
    assert data["outcome"] == {
        "kind": "arbitrated",
        "decision": "exclude",
        "exclusion_reason": "Not ML",
        "reasons_differ": False,
    }


async def test_viewer_reads_but_cannot_decide(db_session: AsyncSession) -> None:
    project_id, _, _, (assignment,) = await _project(db_session, rc=1)
    viewer = await add_member(db_session, project_id, "viewer")

    read = await _get(db_session, viewer, _assignment_path(assignment))
    assert read.status_code == 200
    assert read.json()["data"]["status"] == "awaiting_others"

    assert (await _decide(db_session, viewer, assignment, "include")).status_code == 403


async def test_outsider_and_foreign_assignment(db_session: AsyncSession) -> None:
    _, _, _, (assignment,) = await _project(db_session, rc=1, reviewers=1)
    _, (other_reviewer,), _, (own_assignment,) = await _project(db_session, rc=1, reviewers=1)

    assert (await _get(db_session, other_reviewer, _assignment_path(assignment))).status_code == 403
    foreign = await _decide(db_session, other_reviewer, assignment, "include")
    assert foreign.status_code == 403
    assert (await _get(db_session, other_reviewer, _assignment_path(uuid4()))).status_code == 404
    assert (await _decide(db_session, other_reviewer, uuid4(), "include")).status_code == 404
    assert (
        await _get(db_session, other_reviewer, _assignment_path(own_assignment))
    ).status_code == 200
    written = (
        await db_session.execute(
            select(func.count())
            .select_from(ScreeningDecision)
            .where(ScreeningDecision.assignment_id == assignment)
        )
    ).scalar_one()
    assert written == 0


async def test_unknown_exclusion_reason_is_refused(db_session: AsyncSession) -> None:
    _, (reviewer,), _, (assignment,) = await _project(db_session, rc=1, reviewers=1)

    response = await _decide(db_session, reviewer, assignment, "exclude", "Old reason")

    assert response.status_code == 409
    assert _error_code(response) == "SCREENING_UNKNOWN_EXCLUSION_REASON"


async def test_reason_on_include_is_422(db_session: AsyncSession) -> None:
    _, (reviewer,), _, (assignment,) = await _project(db_session, rc=1, reviewers=1)

    response = await _decide(db_session, reviewer, assignment, "include", "Not ML")

    assert response.status_code == 422


async def test_unconfigured_project(db_session: AsyncSession) -> None:
    project_id, (reviewer,), _, (assignment,) = await _project(db_session, rc=None, reviewers=1)

    decided = await _decide(db_session, reviewer, assignment, "include")
    assert decided.status_code == 409
    assert _error_code(decided) == "SCREENING_NOT_CONFIGURED"

    queue = await _get(db_session, reviewer, _queue_path(project_id))
    assert queue.status_code == 409
    assert _error_code(queue) == "SCREENING_NOT_CONFIGURED"


async def test_deleted_article_assignment_is_404(db_session: AsyncSession) -> None:
    _, (reviewer,), (article,), (assignment,) = await _project(db_session, rc=1, reviewers=1)
    assert (await _get(db_session, reviewer, _assignment_path(assignment))).status_code == 200

    await db_session.execute(
        text("DELETE FROM public.articles WHERE id = :id"), {"id": str(article)}
    )

    assert (await _get(db_session, reviewer, _assignment_path(assignment))).status_code == 404


async def test_moved_article_leaves_the_queue_and_404s(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    reviewer = await add_member(db_session, project_id, "reviewer")
    await set_reviewer_count(db_session, project_id, 2)
    moved = await make_screening_article(db_session, project_id)
    (moved_assignment,) = await enroll_articles(
        db_session, project_id, [moved], by=MANAGER, enrolled_at=JAN_1
    )
    rest = [await make_screening_article(db_session, project_id) for _ in range(2)]
    await enroll_articles(db_session, project_id, rest, by=MANAGER, enrolled_at=JAN_2)
    other_project = await make_project(db_session)

    before = (await _get(db_session, reviewer, _queue_path(project_id))).json()["data"]
    assert before["items"][0]["assignment_id"] == str(moved_assignment)
    config_before = (
        await _get(db_session, MANAGER, f"/api/v1/projects/{project_id}/screening/config")
    ).json()["data"]

    await move_article(db_session, moved, other_project)

    after = (await _get(db_session, reviewer, _queue_path(project_id))).json()["data"]
    assert str(moved_assignment) not in {item["assignment_id"] for item in after["items"]}
    assert after["awaiting_me"] == before["awaiting_me"] - 1
    assert (await _get(db_session, reviewer, _assignment_path(moved_assignment))).status_code == (
        404
    )
    assert (await _decide(db_session, reviewer, moved_assignment, "include")).status_code == 404
    written = (
        await db_session.execute(
            select(func.count())
            .select_from(ScreeningDecision)
            .where(ScreeningDecision.assignment_id == moved_assignment)
        )
    ).scalar_one()
    assert written == 0
    config_after = (
        await _get(db_session, MANAGER, f"/api/v1/projects/{project_id}/screening/config")
    ).json()["data"]
    assert config_after["enrolled"] == config_before["enrolled"] - 1


def _md5_order(ids: list[UUID]) -> list[str]:
    return [str(i) for i in sorted(ids, key=lambda i: hashlib.md5(str(i).encode()).hexdigest())]


async def test_queue_contents_and_order(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    await db_session.execute(
        text("UPDATE public.projects SET eligibility_criteria = CAST(:e AS jsonb) WHERE id = :p"),
        {"e": '{"exclusion": ["Wrong population", "Not ML"]}', "p": str(project_id)},
    )
    a, b, c = [await add_member(db_session, project_id, "reviewer") for _ in range(3)]
    await set_reviewer_count(db_session, project_id, 2)
    first = [await make_screening_article(db_session, project_id) for _ in range(12)]
    second = [await make_screening_article(db_session, project_id) for _ in range(13)]
    first_ids = await enroll_articles(db_session, project_id, first, by=MANAGER, enrolled_at=JAN_1)
    second_ids = await enroll_articles(
        db_session, project_id, second, by=MANAGER, enrolled_at=JAN_2
    )

    queue = (await _get(db_session, a, _queue_path(project_id))).json()["data"]
    order = [item["assignment_id"] for item in queue["items"]]
    assert len(order) == 20
    assert order == _md5_order(first_ids) + _md5_order(second_ids)[:8]
    again = (await _get(db_session, a, _queue_path(project_id))).json()["data"]
    assert [item["assignment_id"] for item in again["items"]] == order

    one, two, three = (UUID(i) for i in order[:3])
    assert (await _decide(db_session, a, one, "include")).status_code == 200
    assert (await _decide(db_session, b, two, "include")).status_code == 200
    assert (await _decide(db_session, c, two, "include")).status_code == 200
    await add_ruling(db_session, three, MANAGER, "include")

    after = (await _get(db_session, a, _queue_path(project_id))).json()["data"]
    listed = {item["assignment_id"] for item in after["items"]}
    assert listed.isdisjoint({str(one), str(two), str(three)})
    assert (after["awaiting_me"], after["awaiting_others"]) == (22, 1)
    assert after["exclusion_reasons"] == REASONS
    assert after["items"][0]["article"]["title"] == "Screening article"


async def test_queue_requires_reviewer_role(db_session: AsyncSession) -> None:
    project_id, _, _, _ = await _project(db_session, rc=1)
    viewer = await add_member(db_session, project_id, "viewer")

    assert (await _get(db_session, viewer, _queue_path(project_id))).status_code == 403
