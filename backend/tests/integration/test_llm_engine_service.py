"""T2 — LlmEngineService against real Postgres (C1b).

The setting lives in plain JSONB (``projects.settings["llm_engine"]``), so
these run against the real column: reassign-to-track, sibling-key survival
and the retired flag are exactly the behaviours a mock would fake.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm.catalog import find_entry
from app.schemas.llm_engine import LlmEngineAlternate
from app.services.llm_engine_service import (
    EngineRetiredError,
    LlmEngineService,
    resolve_project_engine,
)
from app.services.parser_settings_service import ParserSettingsService, ProjectNotFoundError
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup


def _retire_pair(monkeypatch: pytest.MonkeyPatch, provider: str, model: str) -> None:
    """Simulate the roster dropping one pair: the service's catalogue lookup
    misses for it and answers normally for every other pair."""
    monkeypatch.setattr(
        "app.services.llm_engine_service.find_entry",
        lambda p, m: None if (p, m) == (provider, model) else find_entry(p, m),
    )


async def _raw_settings(db: AsyncSession, project_id) -> dict:
    row = (
        await db.execute(
            text("SELECT settings FROM public.projects WHERE id = :pid"),
            {"pid": str(project_id)},
        )
    ).scalar_one()
    return row or {}


@pytest.mark.asyncio
async def test_default_when_unset(db_session: AsyncSession) -> None:
    """A project that never chose an engine resolves to the env default."""
    resolved = await LlmEngineService(db_session).get_for_project(SEED.primary_project)
    assert resolved.source == "default"
    assert resolved.provider == settings.LLM_PROVIDER
    assert resolved.model == settings.LLM_DEFAULT_MODEL
    assert resolved.mode == "fast"
    assert resolved.retired is False
    assert resolved.stored is None


@pytest.mark.asyncio
async def test_set_then_get_roundtrip(db_session: AsyncSession) -> None:
    stored = await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    assert stored.updated_by == SEED.primary_profile
    assert stored.updated_at is not None

    resolved = await LlmEngineService(db_session).get_for_project(SEED.primary_project)
    assert resolved.source == "project"
    assert (resolved.provider, resolved.model) == ("openai", "gpt-5.6-terra")
    assert resolved.retired is False
    assert resolved.stored is not None
    assert resolved.stored.updated_by == SEED.primary_profile


@pytest.mark.asyncio
async def test_unknown_model_refused(db_session: AsyncSession) -> None:
    with pytest.raises(ValueError, match="catalogue"):
        await engine_setup.set_project_engine(db_session, "openai", "gpt-99-does-not-exist")


@pytest.mark.asyncio
async def test_missing_project_raises(db_session: AsyncSession) -> None:
    with pytest.raises(ProjectNotFoundError):
        await LlmEngineService(db_session).get_for_project(uuid4())


@pytest.mark.asyncio
async def test_previous_model_chains(db_session: AsyncSession) -> None:
    """Each write records the model it replaced — A → B → C leaves C with
    previous_model B, never A."""
    first = await engine_setup.set_project_engine(db_session, "openai", "gpt-4o-mini")
    assert first.previous_model is None  # was unset (env default)

    second = await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    assert second.previous_model == "gpt-4o-mini"

    third = await engine_setup.set_project_engine(db_session, "anthropic", "claude-sonnet-5")
    assert third.previous_model == "gpt-5.6-terra"


@pytest.mark.asyncio
async def test_retired_flips_when_the_roster_drops_the_entry(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A stored pair the catalogue no longer lists reads as retired."""
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")

    # The roster moves on: the service's catalogue lookup now misses.
    monkeypatch.setattr(
        "app.services.llm_engine_service.find_entry",
        lambda _provider, _model: None,
    )

    resolved = await LlmEngineService(db_session).get_for_project(SEED.primary_project)
    assert resolved.source == "project"
    assert resolved.retired is True
    assert (resolved.provider, resolved.model) == ("openai", "gpt-5.6-terra")


@pytest.mark.asyncio
async def test_get_engine_read_serves_catalog_and_caller_availability(
    db_session: AsyncSession,
) -> None:
    """The whole read model comes from the service: resolved engine, the
    roster, and the CALLER's per-provider availability (booleans only)."""
    read = await LlmEngineService(db_session).get_engine_read(
        SEED.primary_project, SEED.reviewer_profile
    )
    assert read.source == "default"
    assert read.model == settings.LLM_DEFAULT_MODEL
    assert read.updated_by_name is None
    pairs = {(e.provider, e.model) for e in read.catalog}
    assert ("openai", "gpt-4o-mini") in pairs
    assert set(read.availability) == {e.provider for e in read.catalog}
    # The reviewer stores no anthropic key and no global anthropic key exists.
    assert read.availability["anthropic"] is False
    # Unset engine (default source) means no alternates either.
    assert read.alternates == []


@pytest.mark.asyncio
async def test_get_engine_read_names_the_updater(db_session: AsyncSession) -> None:
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    read = await LlmEngineService(db_session).get_engine_read(
        SEED.primary_project, SEED.primary_profile
    )
    assert read.source == "project"
    assert read.updated_by_name == "Integration Primary"
    assert read.updated_at is not None


@pytest.mark.asyncio
async def test_set_for_project_locks_the_project_row(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """F3: the engine write is a whole-column read-modify-reassign of
    ``projects.settings``, shared with ``ParserSettingsService`` — an
    unlocked read lets two writers interleave (read A, read B, write A,
    write B) and silently drop one sub-key. The read must take the row
    lock (``SELECT … FOR UPDATE``), mirroring ``freeze_engine``'s
    reasoning in ``extraction_run_repository``."""
    executed: list[str] = []
    real_execute = db_session.execute

    async def _spy(statement, *args, **kwargs):  # type: ignore[no-untyped-def]
        executed.append(str(statement))
        return await real_execute(statement, *args, **kwargs)

    monkeypatch.setattr(db_session, "execute", _spy)

    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")

    assert any("projects" in sql and "FOR UPDATE" in sql for sql in executed), (
        f"set_for_project read the project row without FOR UPDATE — statements executed: {executed}"
    )


@pytest.mark.asyncio
async def test_sibling_parsing_key_survives_an_engine_write(db_session: AsyncSession) -> None:
    """The service writes ONLY its own ``llm_engine`` sub-key."""
    await ParserSettingsService(db_session).set_for_project(
        project_id=SEED.primary_project,
        parser_type="docling",
    )
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    await db_session.flush()

    raw = await _raw_settings(db_session, SEED.primary_project)
    assert raw.get("parsing") == {"type": "docling"}, "sibling key clobbered by the engine write"
    assert raw.get("llm_engine", {}).get("model") == "gpt-5.6-terra"

    # And the reverse: a parser write must not clobber the engine.
    await ParserSettingsService(db_session).set_for_project(
        project_id=SEED.primary_project,
        parser_type="auto",
    )
    raw = await _raw_settings(db_session, SEED.primary_project)
    assert raw.get("llm_engine", {}).get("model") == "gpt-5.6-terra"


# ---------------------------------------------------------------------------
# Manager-curated alternates — write gate + read model (C2 A2)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_alternates_rejects_unknown_pair(db_session: AsyncSession) -> None:
    """Alternates are catalogue-only in C2 — a pair the catalogue does not
    list (which is also what any custom-endpoint pair looks like here) is
    refused before anything is written."""
    with pytest.raises(ValueError, match="alternate engine"):
        await engine_setup.set_project_engine(
            db_session,
            "openai",
            "gpt-5.6-terra",
            alternates=[LlmEngineAlternate(provider="openai", model="gpt-99-does-not-exist")],
        )


@pytest.mark.asyncio
async def test_set_alternates_dedupes_and_excludes_primary(db_session: AsyncSession) -> None:
    """(provider, model) duplicates collapse to the first occurrence and the
    primary pair is silently dropped — order otherwise preserved."""
    stored = await engine_setup.set_project_engine(
        db_session,
        "openai",
        "gpt-5.6-terra",
        alternates=[
            LlmEngineAlternate(provider="anthropic", model="claude-sonnet-5"),
            LlmEngineAlternate(provider="openai", model="gpt-5.6-terra"),  # the primary
            LlmEngineAlternate(provider="openai", model="gpt-4o-mini"),
            LlmEngineAlternate(provider="anthropic", model="claude-sonnet-5"),  # duplicate
        ],
    )
    assert [(a.provider, a.model) for a in stored.alternates] == [
        ("anthropic", "claude-sonnet-5"),
        ("openai", "gpt-4o-mini"),
    ]
    raw = await _raw_settings(db_session, SEED.primary_project)
    assert raw["llm_engine"]["alternates"] == [
        {"provider": "anthropic", "model": "claude-sonnet-5"},
        {"provider": "openai", "model": "gpt-4o-mini"},
    ]


@pytest.mark.asyncio
async def test_set_alternates_none_keeps_previous(db_session: AsyncSession) -> None:
    """A write without the field (None) keeps the stored list verbatim."""
    await engine_setup.set_project_engine(
        db_session,
        "openai",
        "gpt-5.6-terra",
        alternates=[LlmEngineAlternate(provider="anthropic", model="claude-sonnet-5")],
    )
    stored = await engine_setup.set_project_engine(db_session, "openai", "gpt-4o-mini")
    assert [(a.provider, a.model) for a in stored.alternates] == [
        ("anthropic", "claude-sonnet-5"),
    ]


@pytest.mark.asyncio
async def test_set_alternates_empty_clears(db_session: AsyncSession) -> None:
    await engine_setup.set_project_engine(
        db_session,
        "openai",
        "gpt-5.6-terra",
        alternates=[LlmEngineAlternate(provider="anthropic", model="claude-sonnet-5")],
    )
    stored = await engine_setup.set_project_engine(
        db_session, "openai", "gpt-5.6-terra", alternates=[]
    )
    assert stored.alternates == []
    raw = await _raw_settings(db_session, SEED.primary_project)
    assert raw["llm_engine"]["alternates"] == []


@pytest.mark.asyncio
async def test_engine_read_flags_retired_alternate(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The read model carries the stored alternates with a per-entry retired
    flag — the primary's own flag stays untouched."""
    await engine_setup.set_project_engine(
        db_session,
        "openai",
        "gpt-5.6-terra",
        alternates=[
            LlmEngineAlternate(provider="openai", model="gpt-4o-mini"),
            LlmEngineAlternate(provider="anthropic", model="claude-sonnet-5"),
        ],
    )

    # The roster moves on: gpt-4o-mini alone drops off the catalogue.
    _retire_pair(monkeypatch, "openai", "gpt-4o-mini")

    read = await LlmEngineService(db_session).get_engine_read(
        SEED.primary_project, SEED.primary_profile
    )
    assert read.retired is False
    assert [(a.provider, a.model, a.canonical, a.retired) for a in read.alternates] == [
        ("openai", "gpt-4o-mini", "openai:gpt-4o-mini", True),
        ("anthropic", "claude-sonnet-5", "anthropic:claude-sonnet-5", False),
    ]


@pytest.mark.asyncio
async def test_set_alternates_keeps_already_stored_retired_pair(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PR-A must-fix 1: the A4 frontend echoes the FULL stored list on every
    mutation, so a stored-then-retired alternate must not brick every PUT.
    Catalogue validation applies only to entries NOT already stored; a NEW
    unknown pair is still refused."""
    await engine_setup.set_project_engine(
        db_session,
        "openai",
        "gpt-5.6-terra",
        alternates=[
            LlmEngineAlternate(provider="openai", model="gpt-4o-mini"),
            LlmEngineAlternate(provider="anthropic", model="claude-sonnet-5"),
        ],
    )

    # The roster moves on: gpt-4o-mini alone drops off the catalogue.
    _retire_pair(monkeypatch, "openai", "gpt-4o-mini")

    # Mode change: the frontend echoes the stored list verbatim — retired
    # entry included. The write must succeed and keep the list untouched.
    stored = await engine_setup.set_project_engine(
        db_session,
        "openai",
        "gpt-5.6-terra",
        mode="verified",
        alternates=[
            LlmEngineAlternate(provider="openai", model="gpt-4o-mini"),
            LlmEngineAlternate(provider="anthropic", model="claude-sonnet-5"),
        ],
    )
    assert stored.mode == "verified"
    assert [(a.provider, a.model) for a in stored.alternates] == [
        ("openai", "gpt-4o-mini"),
        ("anthropic", "claude-sonnet-5"),
    ]

    # A NEW pair the catalogue does not list is still refused.
    with pytest.raises(ValueError, match="alternate engine"):
        await engine_setup.set_project_engine(
            db_session,
            "openai",
            "gpt-5.6-terra",
            alternates=[
                LlmEngineAlternate(provider="openai", model="gpt-4o-mini"),
                LlmEngineAlternate(provider="anthropic", model="claude-sonnet-5"),
                LlmEngineAlternate(provider="openai", model="gpt-99-does-not-exist"),
            ],
        )


@pytest.mark.asyncio
async def test_set_alternates_none_keep_filters_new_primary(db_session: AsyncSession) -> None:
    """The None=keep path applies the primary-pair filter too: promoting a
    stored alternate to primary must not leave it in the kept list."""
    await engine_setup.set_project_engine(
        db_session,
        "openai",
        "gpt-5.6-terra",
        alternates=[LlmEngineAlternate(provider="openai", model="gpt-4o-mini")],
    )
    stored = await engine_setup.set_project_engine(db_session, "openai", "gpt-4o-mini")
    assert [(a.provider, a.model) for a in stored.alternates] == []


# ---------------------------------------------------------------------------
# resolve_project_engine — read boundary #2 (T4)
# ---------------------------------------------------------------------------


async def _bypass_write_llm_engine(db: AsyncSession, payload: str) -> None:
    """Simulate a manager hand-writing raw JSONB through PostgREST,
    bypassing the endpoint's catalogue validation."""
    await db.execute(
        text(
            "UPDATE public.projects "
            "SET settings = COALESCE(settings, '{}'::jsonb) "
            "|| jsonb_build_object('llm_engine', CAST(:payload AS jsonb)) "
            "WHERE id = :pid"
        ),
        {"payload": payload, "pid": str(SEED.primary_project)},
    )


@pytest.mark.asyncio
async def test_resolve_unset_falls_back_to_the_env_default(db_session: AsyncSession) -> None:
    target = await resolve_project_engine(db_session, SEED.primary_project)
    assert (target.provider, target.model) == (settings.LLM_PROVIDER, settings.LLM_DEFAULT_MODEL)
    assert (target.mode_requested, target.mode_executed) == ("fast", "fast")


@pytest.mark.asyncio
async def test_resolve_returns_the_project_pair(db_session: AsyncSession) -> None:
    await engine_setup.set_project_engine(db_session, "anthropic", "claude-sonnet-5")
    target = await resolve_project_engine(db_session, SEED.primary_project)
    assert (target.provider, target.model) == ("anthropic", "claude-sonnet-5")
    assert (target.mode_requested, target.mode_executed) == ("fast", "fast")


@pytest.mark.asyncio
async def test_resolve_raises_retired_for_a_bypass_written_unknown_pair(
    db_session: AsyncSession,
) -> None:
    """Validate-on-read stays even though the write validates: a raw-JSONB
    pair the catalogue never listed is refused with the typed error."""
    await _bypass_write_llm_engine(
        db_session, '{"provider": "openai", "model": "gpt-net-new-nonsense"}'
    )
    with pytest.raises(EngineRetiredError) as exc_info:
        await resolve_project_engine(db_session, SEED.primary_project)
    assert exc_info.value.code == "LLM_ENGINE_RETIRED"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_resolve_treats_structural_garbage_as_unset(db_session: AsyncSession) -> None:
    """A payload that does not even parse degrades to the env default —
    contained, never a 500 on every read."""
    await _bypass_write_llm_engine(db_session, '"gpt-5.6-terra"')
    target = await resolve_project_engine(db_session, SEED.primary_project)
    assert (target.provider, target.model) == (settings.LLM_PROVIDER, settings.LLM_DEFAULT_MODEL)


@pytest.mark.asyncio
async def test_resolve_normalizes_a_non_string_mode_and_keeps_the_pair(
    db_session: AsyncSession,
) -> None:
    """F6c: NUMERIC garbage in ``mode`` (hand-written JSONB) normalizes to
    fast at the read — the engine PAIR keeps the manager's choice instead of
    the whole payload degrading to the env default."""
    await _bypass_write_llm_engine(
        db_session, '{"provider": "openai", "model": "gpt-5.6-terra", "mode": 123}'
    )
    target = await resolve_project_engine(db_session, SEED.primary_project)
    assert (target.provider, target.model) == ("openai", "gpt-5.6-terra"), (
        "a garbage MODE must not throw the stored PAIR away"
    )
    assert (target.mode_requested, target.mode_executed) == ("fast", "fast")
