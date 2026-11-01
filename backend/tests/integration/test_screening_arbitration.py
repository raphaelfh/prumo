"""Screening conflicts (as the records read shows them) and arbitration over HTTP, on real Postgres.

Timestamp trap: ``db_session`` is one outer transaction, so a default
``enrolled_at`` (``now()``) ties. A test that needs "latest" still seeds the
earlier rows with explicit past timestamps; rows written afterwards through the
API are strictly later (``created_at`` is ``clock_timestamp()``).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import Response
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.screening import FULL_TEXT, ScreeningArbitration, ScreeningAssignment
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
JAN_3 = datetime(2026, 1, 3, tzinfo=UTC)


def _records_path(project_id: UUID) -> str:
    return f"/api/v1/projects/{project_id}/screening/records?phase=title_abstract"


def _arbitration_path(assignment_id: UUID) -> str:
    return f"/api/v1/screening/assignments/{assignment_id}/arbitration"


async def _request(
    db: AsyncSession, user: UUID, method: str, path: str, body: dict[str, Any] | None = None
) -> Response:
    try:
        async with client_as(str(user), db) as client:
            return await client.request(method, path, json=body)
    finally:
        app.dependency_overrides.clear()


async def _records(db: AsyncSession, user: UUID, project_id: UUID) -> Response:
    return await _request(db, user, "GET", _records_path(project_id))


async def _statuses(db: AsyncSession, user: UUID, project_id: UUID) -> dict[str, str]:
    """``user``'s records-read status of every enrolled row, by assignment id."""
    rows = (await _records(db, user, project_id)).json()["data"]["rows"]
    return {row["assignment_id"]: row["status"] for row in rows if row["assignment_id"]}


async def _rule(
    db: AsyncSession, user: UUID, assignment_id: UUID, ruled_on: list[UUID], **fields: Any
) -> Response:
    body = {"ruled_on_decision_ids": [str(i) for i in ruled_on]}
    body.update({k: str(v) if isinstance(v, UUID) else v for k, v in fields.items()})
    return await _request(db, user, "POST", _arbitration_path(assignment_id), body)


def _assignment_path(assignment_id: UUID) -> str:
    return f"/api/v1/screening/assignments/{assignment_id}"


def _error_code(response: Response) -> str:
    return response.json()["error"]["code"]


async def _named(db: AsyncSession, user: UUID, name: str) -> None:
    await db.execute(
        text("UPDATE public.profiles SET full_name = :n WHERE id = :id"),
        {"n": name, "id": str(user)},
    )


async def _project(db: AsyncSession, *, articles: int = 1) -> tuple[UUID, UUID, UUID, list[UUID]]:
    """rc 2, the protocol's reasons, reviewers A and B, ``articles`` enrolled at JAN_1 + i.

    Returns (project, A, B, assignment ids in queue order).
    """
    project_id = await make_project(db)
    await db.execute(
        text("UPDATE public.projects SET eligibility_criteria = CAST(:e AS jsonb) WHERE id = :p"),
        {"e": '{"exclusion": ["Wrong population", "Not ML"]}', "p": str(project_id)},
    )
    a = await add_member(db, project_id, "reviewer")
    b = await add_member(db, project_id, "reviewer")
    await _named(db, a, "Reviewer A")
    await _named(db, b, "Reviewer B")
    assignments: list[UUID] = []
    for i in range(articles):
        article = await make_screening_article(db, project_id)
        assignments += await enroll_articles(
            db, project_id, [article], by=MANAGER, enrolled_at=datetime(2025, 1, 1 + i, tzinfo=UTC)
        )
    await set_reviewer_count(db, project_id, 2)
    return project_id, a, b, assignments


async def _conflict(db: AsyncSession, assignment: UUID, a: UUID, b: UUID) -> tuple[UUID, UUID]:
    """A include at JAN_1, B exclude "Not ML" at JAN_2: a conflict. Returns (dA, dB)."""
    d_a = await add_decision(db, assignment, a, "include", created_at=JAN_1)
    d_b = await add_decision(db, assignment, b, "exclude", reason="Not ML", created_at=JAN_2)
    return d_a, d_b


async def _rulings(db: AsyncSession, assignment: UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(ScreeningArbitration)
        .where(ScreeningArbitration.assignment_id == assignment)
    )
    return int((await db.execute(stmt)).scalar_one())


async def test_conflicts_list_for_arbitrators(db_session: AsyncSession) -> None:
    project_id, a, b, (a1, a2, a3, a4) = await _project(db_session, articles=4)
    d_a, d_b = await _conflict(db_session, a1, a, b)
    await add_decision(db_session, a2, a, "include", created_at=JAN_1)
    await add_decision(db_session, a2, b, "include", created_at=JAN_1)
    await add_decision(db_session, a3, a, "include", created_at=JAN_1)
    await _conflict(db_session, a4, a, b)
    a4_article = (
        await db_session.execute(
            text("SELECT article_id FROM public.screening_assignments WHERE id = :id"),
            {"id": str(a4)},
        )
    ).scalar_one()
    await move_article(db_session, a4_article, await make_project(db_session))
    consensus = await add_member(db_session, project_id, "consensus")
    viewer = await add_member(db_session, project_id, "viewer")

    for arbitrator in (MANAGER, consensus):
        response = await _records(db_session, arbitrator, project_id)
        assert response.status_code == 200
        data = response.json()["data"]
        statuses = {r["assignment_id"]: r["status"] for r in data["rows"] if r["assignment_id"]}
        assert str(a4) not in statuses
        assert [i for i, status in statuses.items() if status == "conflict"] == [str(a1)]
        assert statuses[str(a2)] == "included"
        assert data["exclusion_reasons"] == REASONS
        view = (await _request(db_session, arbitrator, "GET", _assignment_path(a1))).json()["data"]
        decisions = view["peer_decisions"]
        assert [
            (d["id"], d["reviewer_id"], d["reviewer_name"], d["decision"]) for d in decisions
        ] == [
            (str(d_a), str(a), "Reviewer A", "include"),
            (str(d_b), str(b), "Reviewer B", "exclude"),
        ]
        assert decisions[1]["exclusion_reason"] == "Not ML"

    for reviewer in (a, b):
        statuses = await _statuses(db_session, reviewer, project_id)
        assert statuses[str(a1)] == "waiting"
        assert "conflict" not in statuses.values()
    assert "conflict" not in (await _statuses(db_session, viewer, project_id)).values()


async def test_unconfigured_project_shows_no_conflict(db_session: AsyncSession) -> None:
    project_id = await make_project(db_session)
    a = await add_member(db_session, project_id, "reviewer")
    b = await add_member(db_session, project_id, "reviewer")
    (assignment,) = await enroll_articles(
        db_session, project_id, [await make_screening_article(db_session, project_id)], by=MANAGER
    )
    await _conflict(db_session, assignment, a, b)

    response = await _records(db_session, MANAGER, project_id)
    view = (await _request(db_session, MANAGER, "GET", _assignment_path(assignment))).json()

    assert response.status_code == 409
    assert _error_code(response) == "SCREENING_NOT_CONFIGURED"
    assert view["data"]["status"] != "conflict"


async def test_rule_by_selecting_a_decision(db_session: AsyncSession) -> None:
    project_id, a, b, (a1,) = await _project(db_session)
    d_a, d_b = await _conflict(db_session, a1, a, b)

    response = await _rule(db_session, MANAGER, a1, [d_a, d_b], selected_decision_id=d_b)

    assert response.status_code == 200, response.text
    assert response.json()["data"]["outcome"] == {
        "kind": "arbitrated",
        "decision": "exclude",
        "exclusion_reason": "Not ML",
        "reasons_differ": False,
    }
    ruling = (
        await db_session.execute(
            select(ScreeningArbitration).where(ScreeningArbitration.assignment_id == a1)
        )
    ).scalar_one()
    assert (ruling.selected_decision_id, ruling.decided_by) == (d_b, MANAGER)
    assert await _statuses(db_session, MANAGER, project_id) == {str(a1): "excluded"}
    a_view = (await _request(db_session, a, "GET", f"/api/v1/screening/assignments/{a1}")).json()[
        "data"
    ]
    assert [p["id"] for p in a_view["peer_decisions"]] == [str(d_b)]


async def test_rule_by_override(db_session: AsyncSession) -> None:
    _, a, b, (a1,) = await _project(db_session)
    d_a, d_b = await _conflict(db_session, a1, a, b)

    response = await _rule(db_session, MANAGER, a1, [d_a, d_b], decision="maybe", rationale="R")

    assert response.status_code == 200, response.text
    outcome = response.json()["data"]["outcome"]
    assert (outcome["kind"], outcome["decision"], outcome["exclusion_reason"]) == (
        "arbitrated",
        "maybe",
        None,
    )
    ruling = (
        await db_session.execute(
            select(ScreeningArbitration).where(ScreeningArbitration.assignment_id == a1)
        )
    ).scalar_one()
    assert (ruling.selected_decision_id, ruling.decision, ruling.rationale) == (None, "maybe", "R")


async def test_ruling_on_part_of_the_decisions_is_409(db_session: AsyncSession) -> None:
    _, a, b, (a1,) = await _project(db_session)
    d_a, d_b = await _conflict(db_session, a1, a, b)

    stale = await _rule(db_session, MANAGER, a1, [d_b], selected_decision_id=d_b)
    assert stale.status_code == 409
    assert _error_code(stale) == "SCREENING_STALE_DECISIONS"
    assert await _rulings(db_session, a1) == 0

    fresh = await _rule(db_session, MANAGER, a1, [d_a, d_b], selected_decision_id=d_b)
    assert fresh.status_code == 200, fresh.text


async def test_not_in_conflict_is_409(db_session: AsyncSession) -> None:
    _, a, b, (consensus, pending) = await _project(db_session, articles=2)
    c_a = await add_decision(db_session, consensus, a, "include", created_at=JAN_1)
    c_b = await add_decision(db_session, consensus, b, "include", created_at=JAN_1)
    p_a = await add_decision(db_session, pending, a, "include", created_at=JAN_1)

    for assignment, ids in ((consensus, [c_a, c_b]), (pending, [p_a])):
        response = await _rule(db_session, MANAGER, assignment, ids, decision="exclude")
        assert response.status_code == 409
        assert _error_code(response) == "SCREENING_NOT_IN_CONFLICT"
        assert await _rulings(db_session, assignment) == 0


async def test_forged_selected_decision_is_refused(db_session: AsyncSession) -> None:
    _, a, b, (a1, a5) = await _project(db_session, articles=2)
    d_a, _ = await _conflict(db_session, a1, a, b)
    _, other_b = await _conflict(db_session, a5, a, b)
    _, fa, fb, (foreign,) = await _project(db_session)
    _, foreign_b = await _conflict(db_session, foreign, fa, fb)

    for forged in (other_b, foreign_b, uuid4()):
        response = await _rule(db_session, MANAGER, a1, [d_a, forged], selected_decision_id=forged)
        assert response.status_code == 404
        assert str(forged) not in response.text
    assert await _rulings(db_session, a1) == 0


async def test_re_ruling_an_arbitrated_record(db_session: AsyncSession) -> None:
    _, a, b, (a1,) = await _project(db_session)
    d_a, d_b = await _conflict(db_session, a1, a, b)
    first = await add_ruling(
        db_session, a1, MANAGER, "exclude", reason="Not ML", selected=d_b, created_at=JAN_3
    )
    snapshot = (
        (
            await db_session.execute(
                text("SELECT * FROM public.screening_arbitrations WHERE id = :id"),
                {"id": str(first)},
            )
        )
        .mappings()
        .one()
    )

    response = await _rule(db_session, MANAGER, a1, [d_a, d_b], decision="include")

    assert response.status_code == 200, response.text
    outcome = response.json()["data"]["outcome"]
    assert (outcome["kind"], outcome["decision"]) == ("arbitrated", "include")
    rows = (
        (
            await db_session.execute(
                text(
                    "SELECT * FROM public.screening_arbitrations WHERE assignment_id = :a "
                    "ORDER BY created_at, id"
                ),
                {"a": str(a1)},
            )
        )
        .mappings()
        .all()
    )
    assert len(rows) == 2
    assert dict(rows[0]) == dict(snapshot)
    assert rows[1]["decision"] == "include"


async def test_reviewer_cannot_arbitrate(db_session: AsyncSession) -> None:
    _, a, b, (a1,) = await _project(db_session)
    d_a, d_b = await _conflict(db_session, a1, a, b)

    response = await _rule(db_session, a, a1, [d_a, d_b], selected_decision_id=d_a)

    assert response.status_code == 403
    assert await _rulings(db_session, a1) == 0


@pytest.mark.parametrize("seat_role", ["manager", "consensus"])
async def test_a_seated_arbitrator_cannot_see_or_rule_their_own_conflict(
    db_session: AsyncSession, seat_role: str
) -> None:
    project_id, _, b, (a1,) = await _project(db_session)
    consensus = await add_member(db_session, project_id, "consensus")
    seated, unseated = (MANAGER, consensus) if seat_role == "manager" else (consensus, MANAGER)
    d_s, d_b = await _conflict(db_session, a1, seated, b)

    view = (await _request(db_session, seated, "GET", _assignment_path(a1))).json()["data"]
    assert (view["status"], view["peer_decisions"], view["outcome"]) == (
        "awaiting_others",
        [],
        None,
    )
    assert view["my_decision"]["id"] == str(d_s)
    assert await _statuses(db_session, seated, project_id) == {str(a1): "waiting"}
    refused = await _rule(db_session, seated, a1, [d_s, d_b], selected_decision_id=d_s)
    assert refused.status_code == 403
    assert _error_code(refused) == "SCREENING_SELF_ARBITRATION"
    assert await _rulings(db_session, a1) == 0

    assert await _statuses(db_session, unseated, project_id) == {str(a1): "conflict"}
    ruled = await _rule(db_session, unseated, a1, [d_s, d_b], selected_decision_id=d_b)
    assert ruled.status_code == 200, ruled.text
    after = (await _request(db_session, seated, "GET", _assignment_path(a1))).json()["data"]
    assert after["status"] == "decided"
    assert [p["id"] for p in after["peer_decisions"]] == [str(d_b)]


async def test_a_seated_arbitrator_cannot_re_rule_their_own_record(
    db_session: AsyncSession,
) -> None:
    project_id, _, b, (a1,) = await _project(db_session)
    consensus = await add_member(db_session, project_id, "consensus")
    d_m, d_b = await _conflict(db_session, a1, MANAGER, b)
    await add_ruling(db_session, a1, consensus, "exclude", reason="Not ML", created_at=JAN_3)

    refused = await _rule(db_session, MANAGER, a1, [d_m, d_b], decision="include")

    assert refused.status_code == 403
    assert _error_code(refused) == "SCREENING_SELF_ARBITRATION"
    assert await _rulings(db_session, a1) == 1


async def test_override_reason_must_be_in_the_protocol(db_session: AsyncSession) -> None:
    _, a, b, (a1,) = await _project(db_session)
    d_a, d_b = await _conflict(db_session, a1, a, b)

    response = await _rule(
        db_session, MANAGER, a1, [d_a, d_b], decision="exclude", exclusion_reason="Old"
    )

    assert response.status_code == 409
    assert _error_code(response) == "SCREENING_UNKNOWN_EXCLUSION_REASON"
    assert await _rulings(db_session, a1) == 0


async def _with_full_text(db: AsyncSession, project_id: UUID, ta_assignment: UUID) -> UUID:
    """Send the TA assignment's article to full text (FT count 2); returns the FT assignment."""
    article = (
        await db.execute(
            select(ScreeningAssignment.article_id).where(ScreeningAssignment.id == ta_assignment)
        )
    ).scalar_one()
    (ft,) = await enroll_articles(db, project_id, [article], by=MANAGER, phase=FULL_TEXT)
    await set_reviewer_count(db, project_id, 2, key="full_text_reviewer_count")
    return ft


@pytest.mark.parametrize(
    ("phase", "fields", "code"),
    [
        ("full_text", {"decision": "maybe"}, "SCREENING_DECISION_NOT_IN_PHASE"),
        ("title_abstract", {"decision": "not_retrieved"}, "SCREENING_DECISION_NOT_IN_PHASE"),
        ("full_text", {"decision": "exclude"}, "SCREENING_REASON_REQUIRED"),
    ],
    ids=["maybe-at-full-text", "not-retrieved-at-title-abstract", "exclude-without-reason"],
)
async def test_override_must_fit_the_phase(
    db_session: AsyncSession, phase: str, fields: dict[str, str], code: str
) -> None:
    project_id, a, b, (a1,) = await _project(db_session)
    target = await _with_full_text(db_session, project_id, a1) if phase == "full_text" else a1
    d_a, d_b = await _conflict(db_session, target, a, b)

    refused = await _rule(db_session, MANAGER, target, [d_a, d_b], **fields)

    assert refused.status_code == 409
    assert _error_code(refused) == code
    assert await _rulings(db_session, target) == 0


async def test_title_abstract_ruling_after_full_text_is_refused(db_session: AsyncSession) -> None:
    project_id, a, b, (a1,) = await _project(db_session)
    d_a, d_b = await _conflict(db_session, a1, a, b)
    await add_ruling(db_session, a1, MANAGER, "include", selected=d_a, created_at=JAN_3)
    await _with_full_text(db_session, project_id, a1)

    refused = await _rule(db_session, MANAGER, a1, [d_a, d_b], decision="exclude")

    assert refused.status_code == 409
    assert _error_code(refused) == "SCREENING_PHASE_ADVANCED"
    assert await _rulings(db_session, a1) == 1


async def _full_text_pair(
    db: AsyncSession, first: str, second: str, *, seat_manager: bool = False
) -> tuple[UUID, UUID, UUID, tuple[UUID, UUID]]:
    """An FT assignment (count 2) where A (or the manager) says ``first`` and B ``second``.

    Returns (project, FT assignment, B, (decision ids)).
    """
    project_id, a, b, (a1,) = await _project(db)
    ft = await _with_full_text(db, project_id, a1)
    first_user = MANAGER if seat_manager else a
    d_a = await add_decision(db, ft, first_user, first, created_at=JAN_1)
    d_b = await add_decision(db, ft, b, second, created_at=JAN_2)
    return project_id, ft, b, (d_a, d_b)


async def test_pdf_found_later(db_session: AsyncSession) -> None:
    _, ft, _, ruled_on = await _full_text_pair(db_session, "not_retrieved", "not_retrieved")
    seen = (await _request(db_session, MANAGER, "GET", _assignment_path(ft))).json()["data"]
    assert seen["outcome"]["decision"] == "not_retrieved"

    ruled = await _rule(db_session, MANAGER, ft, list(ruled_on), decision="include")

    assert ruled.status_code == 200, ruled.text
    outcome = ruled.json()["data"]["outcome"]
    assert (outcome["kind"], outcome["decision"]) == ("arbitrated", "include")
    assert await _rulings(db_session, ft) == 1


async def test_pdf_found_later_is_not_ruled_by_a_seated_arbitrator(
    db_session: AsyncSession,
) -> None:
    _, ft, _, ruled_on = await _full_text_pair(
        db_session, "not_retrieved", "not_retrieved", seat_manager=True
    )

    refused = await _rule(db_session, MANAGER, ft, list(ruled_on), decision="include")

    assert refused.status_code == 403
    assert _error_code(refused) == "SCREENING_SELF_ARBITRATION"
    assert await _rulings(db_session, ft) == 0


async def test_not_retrieved_vs_include_is_ruled_like_a_conflict(db_session: AsyncSession) -> None:
    _, ft, _, ruled_on = await _full_text_pair(db_session, "include", "not_retrieved")
    view = (await _request(db_session, MANAGER, "GET", _assignment_path(ft))).json()["data"]
    assert view["status"] == "conflict"

    ruled = await _rule(db_session, MANAGER, ft, list(ruled_on), selected_decision_id=ruled_on[0])

    assert ruled.status_code == 200, ruled.text
    assert ruled.json()["data"]["outcome"]["decision"] == "include"
