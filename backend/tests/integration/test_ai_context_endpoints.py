"""GET/PUT /api/v1/projects/{id}/ai-context — auth, round-trip, and the preview.

The auth assertions are the point of this file. BOLA is this repo's most
repeated incident class, and the column behind these routes is governed by a
manager-only RLS policy that the API must not be looser than.

Both guards answer 403 for a non-member AND for a project that does not exist,
so neither route is an existence oracle — the design doc's "404 on a foreign
project id" is unreachable through them.
"""

from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_ai_context import (
    ProjectNotFoundError,
    get_ai_context,
    set_ai_context,
)
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

# Re-bound at module level (the repo's idiom for borrowing fixtures) so pytest
# collects them here; a ``from ... import`` would be shadowed by the test
# parameters and trip F811.
client_as_manager = engine_setup.client_as_manager
client_as_outsider = engine_setup.client_as_outsider
client_as_reviewer = engine_setup.client_as_reviewer

_URL = "/api/v1/projects/{pid}/ai-context"


def _slot(description: str = "", inclusion=None, exclusion=None) -> dict:
    return {
        "description": description,
        "inclusion": inclusion or [],
        "exclusion": exclusion or [],
    }


async def _set_raw(db: AsyncSession, project_id: UUID, picots, review_type: str) -> None:
    await db.execute(
        text(
            "UPDATE public.projects SET picots_config_ai_review = CAST(:p AS jsonb), "
            "review_type = CAST(:rt AS review_type) WHERE id = :pid"
        ),
        {
            "p": None if picots is None else json.dumps(picots),
            "rt": review_type,
            "pid": str(project_id),
        },
    )
    await db.flush()


@pytest.mark.asyncio
async def test_a_manager_writes_and_the_preview_is_what_the_model_would_get(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    """The response preview is rendered from what was STORED, not echoed back.

    Echoing the request would let the screen show a review question the AI never
    received — the exact failure the run view's sibling field exists to prevent.
    """
    await _set_raw(db_session, SEED.primary_project, None, "predictive_model")

    res = await client_as_manager.put(
        _URL.format(pid=SEED.primary_project),
        json={
            "picots": {
                "population": _slot("Adults with heart failure", inclusion=["NYHA II-IV"]),
                "outcomes": _slot("30-day readmission"),
            }
        },
    )

    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["preview"] == (
        "- Population: Adults with heart failure\n"
        "  Include: NYHA II-IV\n"
        "- Outcome(s): 30-day readmission"
    )
    assert data["picots"]["population"]["inclusion"] == ["NYHA II-IV"]
    await db_session.rollback()


@pytest.mark.asyncio
async def test_the_labels_are_the_instrument_wording_the_prompt_emits(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    """The editor reads its labels from here so it cannot drift from the prompt."""
    await _set_raw(db_session, SEED.primary_project, None, "predictive_model")

    res = await client_as_manager.get(_URL.format(pid=SEED.primary_project))

    assert res.status_code == 200, res.text
    labels = res.json()["data"]["labels"]
    assert labels["index_models"] == "Index model(s)"
    assert labels["comparator_models"] == "Comparator model(s)"
    assert labels["population"] == "Population"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_the_labels_follow_a_non_predictive_review_type(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    await _set_raw(db_session, SEED.primary_project, None, "diagnostic")

    res = await client_as_manager.get(_URL.format(pid=SEED.primary_project))

    labels = res.json()["data"]["labels"]
    assert labels["index_models"] == "Index test"
    assert labels["comparator_models"] == "Reference standard"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_legacy_nested_timing_reads_back_flat(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    """The editor must show the same text the prompt renders, on any stored shape.

    A project untouched since before migration 0063 still holds the nested pair;
    reading it through the prompt's own reader is what stops the editor from
    showing an empty Timing box for a slot the model is being told about.
    """
    await _set_raw(
        db_session,
        SEED.primary_project,
        {
            "timing": {
                "prediction_moment": _slot("At discharge"),
                "prediction_horizon": _slot("30-day horizon"),
            }
        },
        "predictive_model",
    )

    res = await client_as_manager.get(_URL.format(pid=SEED.primary_project))

    assert res.json()["data"]["picots"]["timing"]["description"] == "At discharge; 30-day horizon"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_the_switch_round_trips_and_silences_the_preview(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    await _set_raw(
        db_session, SEED.primary_project, {"population": _slot("Adults")}, "predictive_model"
    )

    off = await client_as_manager.put(
        _URL.format(pid=SEED.primary_project), json={"picots_enabled": False}
    )

    assert off.status_code == 200, off.text
    assert off.json()["data"]["picots_enabled"] is False
    assert off.json()["data"]["preview"] is None
    # The stored question survives being switched off — this is a mute, not a delete.
    assert off.json()["data"]["picots"]["population"]["description"] == "Adults"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_writing_only_the_switch_does_not_erase_the_question(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    """Each half is optional so the toggle and the editor can share one route."""
    await _set_raw(
        db_session, SEED.primary_project, {"population": _slot("Adults")}, "predictive_model"
    )

    await client_as_manager.put(
        _URL.format(pid=SEED.primary_project), json={"picots_enabled": True}
    )
    res = await client_as_manager.get(_URL.format(pid=SEED.primary_project))

    assert res.json()["data"]["picots"]["population"]["description"] == "Adults"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_the_write_preserves_sibling_settings_keys(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    """``projects.settings`` also holds the blind-review control.

    An unlocked or whole-column write here could drop
    ``managers_see_reviewers`` — flipping a security control back on by
    accident, which is why this write takes the row lock.
    """
    await db_session.execute(
        text(
            "UPDATE public.projects SET settings = "
            '\'{"managers_see_reviewers": {"extraction": true}}\'::jsonb WHERE id = :pid'
        ),
        {"pid": str(SEED.primary_project)},
    )
    await db_session.flush()

    await client_as_manager.put(
        _URL.format(pid=SEED.primary_project), json={"picots_enabled": False}
    )

    settings = (
        await db_session.execute(
            text("SELECT settings FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar()
    assert settings["managers_see_reviewers"] == {"extraction": True}
    assert settings["ai_context"] == {"picots": False}
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_reviewer_may_read_but_not_write(
    db_session: AsyncSession, client_as_reviewer: AsyncClient
) -> None:
    """The column is manager-only at the database; the API must not be looser."""
    get = await client_as_reviewer.get(_URL.format(pid=SEED.primary_project))
    assert get.status_code == 200, get.text

    put = await client_as_reviewer.put(
        _URL.format(pid=SEED.primary_project), json={"picots_enabled": False}
    )
    assert put.status_code == 403, put.text
    await db_session.rollback()


@pytest.mark.asyncio
async def test_an_outsider_is_refused_on_a_real_project(
    db_session: AsyncSession, client_as_outsider: AsyncClient
) -> None:
    """A REAL project the caller is not a member of — not a random UUID.

    A random id would only prove "unknown id -> 403" and would say nothing about
    whether membership is actually checked.
    """
    assert (await client_as_outsider.get(_URL.format(pid=SEED.primary_project))).status_code == 403
    assert (
        await client_as_outsider.put(
            _URL.format(pid=SEED.primary_project), json={"picots_enabled": False}
        )
    ).status_code == 403
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_nonexistent_project_answers_exactly_like_a_foreign_one(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    """403 for both, so the route is not an existence oracle."""
    unknown = uuid4()
    assert (await client_as_manager.get(_URL.format(pid=unknown))).status_code == 403
    assert (
        await client_as_manager.put(_URL.format(pid=unknown), json={"picots_enabled": False})
    ).status_code == 403
    await db_session.rollback()


@pytest.mark.asyncio
async def test_the_service_read_and_write_called_directly(db_session: AsyncSession) -> None:
    """Exercises the service functions WITHOUT the HTTP layer.

    The endpoint tests above drive these through httpx's ASGI transport, whose
    frames coverage does not register — so the service's own branches would be
    reported uncovered despite being exercised. Calling them directly is both
    the honest coverage and the tighter unit.
    """
    await _set_raw(db_session, SEED.primary_project, None, "prognostic")

    written = await set_ai_context(
        db_session,
        SEED.primary_project,
        picots={
            "population": _slot("Adults"),
            "index_models": _slot("Frailty index"),
            "comparator_models": _slot(),
            "outcomes": _slot(),
            "timing": _slot(),
            "setting_and_intended_use": _slot(),
        },
        picots_enabled=True,
    )
    assert written["labels"]["index_models"] == "Prognostic factor"
    assert written["preview"] == "- Population: Adults\n- Prognostic factor: Frailty index"

    read = await get_ai_context(db_session, SEED.primary_project)
    assert read["picots"]["population"]["description"] == "Adults"
    assert read["review_type"] == "prognostic"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_the_service_refuses_a_project_that_is_not_there(
    db_session: AsyncSession,
) -> None:
    """Both halves raise, so the router has one error to map rather than two shapes."""
    with pytest.raises(ProjectNotFoundError):
        await get_ai_context(db_session, uuid4())
    with pytest.raises(ProjectNotFoundError):
        await set_ai_context(db_session, uuid4(), picots=None, picots_enabled=True)
    await db_session.rollback()
