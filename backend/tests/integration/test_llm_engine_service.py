"""T2 — LlmEngineService against real Postgres (C1b).

The setting lives in plain JSONB (``projects.settings["llm_engine"]``), so
these run against the real column: reassign-to-track, sibling-key survival
and the retired flag are exactly the behaviours a mock would fake.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.llm_engine_service import LlmEngineService
from app.services.parser_settings_service import ParserSettingsService, ProjectNotFoundError
from tests.integration.conftest import SEED


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
    service = LlmEngineService(db_session)
    stored = await service.set_for_project(
        project_id=SEED.primary_project,
        provider="openai",
        model="gpt-4o",
        mode="fast",
        updated_by=SEED.primary_profile,
    )
    assert stored.updated_by == SEED.primary_profile
    assert stored.updated_at is not None

    resolved = await service.get_for_project(SEED.primary_project)
    assert resolved.source == "project"
    assert (resolved.provider, resolved.model) == ("openai", "gpt-4o")
    assert resolved.retired is False
    assert resolved.stored is not None
    assert resolved.stored.updated_by == SEED.primary_profile


@pytest.mark.asyncio
async def test_unknown_model_refused(db_session: AsyncSession) -> None:
    with pytest.raises(ValueError, match="catalogue"):
        await LlmEngineService(db_session).set_for_project(
            project_id=SEED.primary_project,
            provider="openai",
            model="gpt-99-does-not-exist",
            mode="fast",
            updated_by=SEED.primary_profile,
        )


@pytest.mark.asyncio
async def test_missing_project_raises(db_session: AsyncSession) -> None:
    from uuid import uuid4

    with pytest.raises(ProjectNotFoundError):
        await LlmEngineService(db_session).get_for_project(uuid4())


@pytest.mark.asyncio
async def test_previous_model_chains(db_session: AsyncSession) -> None:
    """Each write records the model it replaced — A → B → C leaves C with
    previous_model B, never A."""
    service = LlmEngineService(db_session)

    first = await service.set_for_project(
        project_id=SEED.primary_project,
        provider="openai",
        model="gpt-4o-mini",
        mode="fast",
        updated_by=SEED.primary_profile,
    )
    assert first.previous_model is None  # was unset (env default)

    second = await service.set_for_project(
        project_id=SEED.primary_project,
        provider="openai",
        model="gpt-4o",
        mode="fast",
        updated_by=SEED.primary_profile,
    )
    assert second.previous_model == "gpt-4o-mini"

    third = await service.set_for_project(
        project_id=SEED.primary_project,
        provider="anthropic",
        model="claude-sonnet-4-5",
        mode="fast",
        updated_by=SEED.primary_profile,
    )
    assert third.previous_model == "gpt-4o"


@pytest.mark.asyncio
async def test_retired_flips_when_the_roster_drops_the_entry(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A stored pair the catalogue no longer lists reads as retired."""
    service = LlmEngineService(db_session)
    await service.set_for_project(
        project_id=SEED.primary_project,
        provider="openai",
        model="gpt-4o",
        mode="fast",
        updated_by=SEED.primary_profile,
    )

    # The roster moves on: the service's catalogue lookup now misses.
    monkeypatch.setattr(
        "app.services.llm_engine_service.find_entry",
        lambda _provider, _model: None,
    )

    resolved = await service.get_for_project(SEED.primary_project)
    assert resolved.source == "project"
    assert resolved.retired is True
    assert (resolved.provider, resolved.model) == ("openai", "gpt-4o")


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


@pytest.mark.asyncio
async def test_get_engine_read_names_the_updater(db_session: AsyncSession) -> None:
    service = LlmEngineService(db_session)
    await service.set_for_project(
        project_id=SEED.primary_project,
        provider="openai",
        model="gpt-4o",
        mode="fast",
        updated_by=SEED.primary_profile,
    )
    read = await service.get_engine_read(SEED.primary_project, SEED.primary_profile)
    assert read.source == "project"
    assert read.updated_by_name == "Integration Primary"
    assert read.updated_at is not None


@pytest.mark.asyncio
async def test_sibling_parsing_key_survives_an_engine_write(db_session: AsyncSession) -> None:
    """The service writes ONLY its own ``llm_engine`` sub-key."""
    await ParserSettingsService(db_session).set_for_project(
        project_id=SEED.primary_project,
        parser_type="docling",
    )
    await LlmEngineService(db_session).set_for_project(
        project_id=SEED.primary_project,
        provider="openai",
        model="gpt-4o",
        mode="fast",
        updated_by=SEED.primary_profile,
    )
    await db_session.flush()

    raw = await _raw_settings(db_session, SEED.primary_project)
    assert raw.get("parsing") == {"type": "docling"}, "sibling key clobbered by the engine write"
    assert raw.get("llm_engine", {}).get("model") == "gpt-4o"

    # And the reverse: a parser write must not clobber the engine.
    await ParserSettingsService(db_session).set_for_project(
        project_id=SEED.primary_project,
        parser_type="auto",
    )
    raw = await _raw_settings(db_session, SEED.primary_project)
    assert raw.get("llm_engine", {}).get("model") == "gpt-4o"
