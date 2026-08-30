"""The project's review question is pinned per run, once, and never rewritten.

The template instruction is safe from mid-run edits because it is read from the
run's PINNED version snapshot. The review question has no such anchor: it lives
on the project row, and ``section_extraction_service``'s single-section path
resolves it once per LLM CALL. Without a run-scoped pin, two sections extracted
ten minutes apart could legitimately see different PICOT, and a Celery retry —
which re-enters with the same payload and re-reads live state — would be free to
use whatever the project says now.

The pin write and the provenance merge are real Postgres; nothing is mocked.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun
from app.repositories import ExtractionRunRepository
from app.services.extraction_run_read_service import build_run_view
from app.services.project_ai_context import build_review_context
from app.services.run_prompt_context import (
    read_pinned_review_context,
    resolve_run_prompt_context,
)
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

_PICOT_FIRST = {
    "population": {"description": "Adults with heart failure", "inclusion": [], "exclusion": []},
    "outcomes": {"description": "30-day readmission", "inclusion": [], "exclusion": []},
}
_PICOT_EDITED = {
    "population": {"description": "Children with asthma", "inclusion": [], "exclusion": []},
}

#: Rendered from ``_PICOT_FIRST``. A LITERAL, not a re-render: comparing the pin
#: to a live rebuild would compare the renderer to itself and could not fail.
_BLOCK_FIRST = "- Population: Adults with heart failure\n- Outcome(s): 30-day readmission"


async def _set_picots(db: AsyncSession, project_id: UUID, picots: dict[str, Any] | None) -> None:
    await db.execute(
        text(
            "UPDATE public.projects SET picots_config_ai_review = CAST(:p AS jsonb) WHERE id = :pid"
        ),
        {"p": None if picots is None else json.dumps(picots), "pid": str(project_id)},
    )
    await db.flush()


def _pinned_raw(run: ExtractionRun) -> Any:
    return ((run.results or {}).get("provenance") or {}).get("review_context")


@pytest.mark.asyncio
async def test_first_resolve_pins_the_rendered_block(db_session: AsyncSession) -> None:
    run = await engine_setup.run_in_extract(db_session)
    await _set_picots(db_session, run.project_id, _PICOT_FIRST)

    context = await resolve_run_prompt_context(db_session, run)

    assert context.review_context == _BLOCK_FIRST
    await db_session.refresh(run)
    assert _pinned_raw(run) == {"text": _BLOCK_FIRST}
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_mid_run_picot_edit_cannot_change_what_an_open_run_sees(
    db_session: AsyncSession,
) -> None:
    """First-writer-wins, from the caller's side.

    This is the whole point of the pin: the manager edits the project, the
    worker re-enters (a retry, or simply the next section), and the run keeps
    the text its first call was built against.
    """
    run = await engine_setup.run_in_extract(db_session)
    await _set_picots(db_session, run.project_id, _PICOT_FIRST)
    first = await resolve_run_prompt_context(db_session, run)

    await _set_picots(db_session, run.project_id, _PICOT_EDITED)
    await db_session.refresh(run)
    second = await resolve_run_prompt_context(db_session, run)

    assert first.review_context == _BLOCK_FIRST
    assert second.review_context == _BLOCK_FIRST, (
        f"a mid-run edit leaked into an open run: {second.review_context!r}"
    )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_an_empty_review_pins_a_recorded_nothing_not_an_absent_key(
    db_session: AsyncSession,
) -> None:
    """``{"text": None}`` is "resolved, and the review says nothing".

    It must stay distinguishable from an ABSENT key ("no LLM call has run
    yet"), and it must be a truthy dict — ``freeze_provenance_key``'s
    first-writer-wins guard is a truthy-dict test, so a falsy payload would
    re-resolve on every call and let a later PICOT edit leak in.
    """
    run = await engine_setup.run_in_extract(db_session)
    await _set_picots(db_session, run.project_id, None)

    context = await resolve_run_prompt_context(db_session, run)
    assert context.review_context is None
    await db_session.refresh(run)
    assert _pinned_raw(run) == {"text": None}

    await _set_picots(db_session, run.project_id, _PICOT_FIRST)
    await db_session.refresh(run)
    again = await resolve_run_prompt_context(db_session, run)
    assert again.review_context is None, (
        "a pinned empty context re-resolved — the truthy-dict guard is broken"
    )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_run_that_predates_the_feature_is_pinned_on_its_next_call(
    db_session: AsyncSession,
) -> None:
    """No pin means "not resolved yet", never "permanently empty".

    The one-live-run invariant keeps a run alive for weeks, so a run open at
    deploy time must pick the context up on its next call rather than being
    stranded at None for the rest of its life.
    """
    run = await engine_setup.run_in_extract(db_session)
    await _set_picots(db_session, run.project_id, _PICOT_FIRST)
    assert read_pinned_review_context(run.results) is None

    context = await resolve_run_prompt_context(db_session, run)

    assert context.review_context == _BLOCK_FIRST
    await db_session.rollback()


@pytest.mark.asyncio
async def test_the_pin_preserves_sibling_provenance_keys(db_session: AsyncSession) -> None:
    """The engine pin and the per-section map must survive the new write."""
    run = await engine_setup.run_in_extract(db_session)
    runs = ExtractionRunRepository(db_session)
    await runs.freeze_engine(run.id, {"provider": "openai", "model": "gpt-4o-mini"})
    await db_session.refresh(run)
    await _set_picots(db_session, run.project_id, _PICOT_FIRST)

    await resolve_run_prompt_context(db_session, run)

    await db_session.refresh(run)
    provenance = (run.results or {}).get("provenance") or {}
    assert provenance["engine"]["model"] == "gpt-4o-mini"
    assert provenance["review_context"] == {"text": _BLOCK_FIRST}
    await db_session.rollback()


@pytest.mark.asyncio
async def test_the_toggle_switches_the_block_off(db_session: AsyncSession) -> None:
    """``settings.ai_context.picots = false`` is the off switch."""
    run = await engine_setup.run_in_extract(db_session)
    await _set_picots(db_session, run.project_id, _PICOT_FIRST)
    await db_session.execute(
        text(
            "UPDATE public.projects "
            'SET settings = settings || \'{"ai_context": {"picots": false}}\'::jsonb '
            "WHERE id = :pid"
        ),
        {"pid": str(run.project_id)},
    )
    await db_session.flush()

    context = await resolve_run_prompt_context(db_session, run)

    assert context.review_context is None
    await db_session.rollback()


@pytest.mark.asyncio
async def test_the_run_view_serves_the_pin_and_never_installs_one(
    db_session: AsyncSession,
) -> None:
    """``RunViewResponse.review_context`` is the run's pin, read-only.

    Its sibling ``general_instructions`` exists so the screen can never show a
    text the model did not get; shipping the block without this field would
    make the response lie by omission. And the read path must NOT pin — before
    any LLM call the honest answer is ``None``, not a freshly-installed pin
    taken under a row lock on a GET.
    """
    run = await engine_setup.run_in_extract(db_session)
    await _set_picots(db_session, run.project_id, _PICOT_FIRST)

    before = await build_run_view(
        db_session, run.id, caller_id=SEED.primary_profile, can_see_peers=False
    )
    assert before.review_context is None, "a read path installed a pin"
    await db_session.refresh(run)
    assert _pinned_raw(run) is None, "a GET wrote provenance"

    await resolve_run_prompt_context(db_session, run)
    await db_session.refresh(run)

    after = await build_run_view(
        db_session, run.id, caller_id=SEED.primary_profile, can_see_peers=False
    )
    assert after.review_context == _BLOCK_FIRST
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_missing_project_renders_nothing(db_session: AsyncSession) -> None:
    """A run whose project is gone must not raise on the prompt path."""
    assert await build_review_context(db_session, uuid4()) is None
    await db_session.rollback()


def test_reading_a_pin_is_a_pure_function_of_results() -> None:
    assert read_pinned_review_context(None) is None
    assert read_pinned_review_context({}) is None
    assert read_pinned_review_context({"provenance": {}}) is None
    assert read_pinned_review_context({"provenance": {"review_context": {}}}) is None
    pin = read_pinned_review_context({"provenance": {"review_context": {"text": "- P: x"}}})
    assert pin is not None and pin.text == "- P: x"
