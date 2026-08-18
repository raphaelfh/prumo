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


# ---------------------------------------------------------------------------
# Endpoint-backed engines — write gate, retired semantics, resolve (C2 B8)
# ---------------------------------------------------------------------------


async def _delete_endpoint_row(db: AsyncSession, endpoint_id) -> None:
    """Raw delete — bypasses the service's engine-pointer delete guard to
    produce the DANGLING state (row gone while the engine still points)."""
    await db.execute(
        text("DELETE FROM public.project_llm_endpoints WHERE id = :eid"),
        {"eid": str(endpoint_id)},
    )


@pytest.mark.asyncio
async def test_set_endpoint_engine_requires_openai_compatible(db_session: AsyncSession) -> None:
    """An ``endpoint_id`` on any catalogue provider is a shape error."""
    endpoint_id = await engine_setup.make_endpoint(db_session)
    with pytest.raises(ValueError, match="openai_compatible"):
        await engine_setup.set_project_engine(
            db_session, "openai", "endpoint-model-x", endpoint_id=endpoint_id
        )


@pytest.mark.asyncio
async def test_set_openai_compatible_without_endpoint_id_refused(
    db_session: AsyncSession,
) -> None:
    """The reverse shape error: ``openai_compatible`` names no catalogue
    entry, so it is only meaningful WITH an endpoint pointer."""
    with pytest.raises(ValueError, match="endpoint"):
        await engine_setup.set_project_engine(db_session, "openai_compatible", "endpoint-model-x")


@pytest.mark.asyncio
async def test_set_endpoint_engine_cross_project_id_reads_as_unknown(
    db_session: AsyncSession,
) -> None:
    """BOLA: a REAL endpoint id owned by another project must be
    indistinguishable from a missing one — same 'unknown endpoint' error."""
    foreign = await engine_setup.make_endpoint(db_session, project_id=SEED.secondary_project)
    never_existed = uuid4()
    with pytest.raises(ValueError, match="[Uu]nknown endpoint") as cross:
        await engine_setup.set_project_engine(
            db_session, "openai_compatible", "endpoint-model-x", endpoint_id=foreign
        )
    with pytest.raises(ValueError, match="[Uu]nknown endpoint") as missing:
        await engine_setup.set_project_engine(
            db_session, "openai_compatible", "endpoint-model-x", endpoint_id=never_existed
        )
    # Indistinguishable up to the id itself: identical message either way.
    assert str(cross.value).replace(str(foreign), "<id>") == str(missing.value).replace(
        str(never_existed), "<id>"
    )


@pytest.mark.asyncio
async def test_set_endpoint_engine_model_must_be_allowed(db_session: AsyncSession) -> None:
    endpoint_id = await engine_setup.make_endpoint(db_session, allowed_models=["endpoint-model-x"])
    with pytest.raises(ValueError, match="allowed"):
        await engine_setup.set_project_engine(
            db_session, "openai_compatible", "some-other-model", endpoint_id=endpoint_id
        )


@pytest.mark.asyncio
async def test_set_endpoint_engine_requires_a_verified_endpoint(
    db_session: AsyncSession,
) -> None:
    endpoint_id = await engine_setup.make_endpoint(db_session, validation_status="unverified")
    with pytest.raises(ValueError, match="not verified"):
        await engine_setup.set_project_engine(
            db_session, "openai_compatible", "endpoint-model-x", endpoint_id=endpoint_id
        )


@pytest.mark.asyncio
async def test_set_endpoint_engine_verified_mode_rejects_prompted_only(
    db_session: AsyncSession,
) -> None:
    """Decision 10: Verified needs structured output — a prompted-only
    endpoint cannot honour the verify pass."""
    endpoint_id = await engine_setup.make_endpoint(db_session, output_mode="prompted")
    with pytest.raises(ValueError, match="[Vv]erified"):
        await engine_setup.set_project_engine(
            db_session,
            "openai_compatible",
            "endpoint-model-x",
            mode="verified",
            endpoint_id=endpoint_id,
        )
    # Fast mode on the same endpoint is fine.
    stored = await engine_setup.set_project_engine(
        db_session, "openai_compatible", "endpoint-model-x", endpoint_id=endpoint_id
    )
    assert stored.endpoint_id == endpoint_id


@pytest.mark.asyncio
async def test_set_endpoint_engine_skips_the_catalogue_and_stores_the_pointer(
    db_session: AsyncSession,
) -> None:
    """The happy path: an endpoint model the CATALOG never listed is
    accepted (catalogue validation skipped for endpoint engines) and the
    pointer lands in the stored JSONB as a string."""
    endpoint_id = await engine_setup.make_endpoint(db_session)
    assert find_entry("openai_compatible", "endpoint-model-x") is None, (
        "precondition: the pair must NOT be in the catalogue for this test to prove the skip"
    )
    stored = await engine_setup.set_project_engine(
        db_session, "openai_compatible", "endpoint-model-x", endpoint_id=endpoint_id
    )
    assert stored.endpoint_id == endpoint_id
    raw = await _raw_settings(db_session, SEED.primary_project)
    assert raw["llm_engine"]["endpoint_id"] == str(endpoint_id)


@pytest.mark.asyncio
async def test_get_for_project_healthy_endpoint_engine_is_not_retired(
    db_session: AsyncSession,
) -> None:
    """Retired semantics for endpoint engines never consult ``find_entry`` —
    an off-catalogue pair on a healthy endpoint reads as NOT retired."""
    endpoint_id = await engine_setup.make_endpoint(db_session)
    await engine_setup.set_project_engine(
        db_session, "openai_compatible", "endpoint-model-x", endpoint_id=endpoint_id
    )
    resolved = await LlmEngineService(db_session).get_for_project(SEED.primary_project)
    assert resolved.source == "project"
    assert resolved.retired is False
    assert resolved.endpoint_id == endpoint_id
    assert resolved.endpoint_label == "engine-suite-endpoint"


@pytest.mark.asyncio
async def test_get_for_project_dangling_endpoint_is_retired(db_session: AsyncSession) -> None:
    endpoint_id = await engine_setup.make_endpoint(db_session)
    await engine_setup.set_project_engine(
        db_session, "openai_compatible", "endpoint-model-x", endpoint_id=endpoint_id
    )
    await _delete_endpoint_row(db_session, endpoint_id)
    resolved = await LlmEngineService(db_session).get_for_project(SEED.primary_project)
    assert resolved.retired is True
    assert resolved.endpoint_label is None


@pytest.mark.asyncio
async def test_get_for_project_model_dropped_from_endpoint_is_retired(
    db_session: AsyncSession,
) -> None:
    """The endpoint survives but no longer allows the stored model — same
    retired outcome (a manager must re-choose)."""
    endpoint_id = await engine_setup.make_endpoint(db_session)
    await engine_setup.set_project_engine(
        db_session, "openai_compatible", "endpoint-model-x", endpoint_id=endpoint_id
    )
    await db_session.execute(
        text(
            "UPDATE public.project_llm_endpoints "
            "SET allowed_models = '[\"another-model\"]'::jsonb WHERE id = :eid"
        ),
        {"eid": str(endpoint_id)},
    )
    resolved = await LlmEngineService(db_session).get_for_project(SEED.primary_project)
    assert resolved.retired is True
    # The row still exists, so the label still renders for the re-choose UI.
    assert resolved.endpoint_label == "engine-suite-endpoint"


@pytest.mark.asyncio
async def test_get_engine_read_carries_the_endpoint_scalars(db_session: AsyncSession) -> None:
    """Decision 12: the read gains ONLY ``endpoint_id`` + ``endpoint_label``
    (the chip), never an embedded endpoints matrix."""
    endpoint_id = await engine_setup.make_endpoint(db_session, label="Lab Ollama")
    await engine_setup.set_project_engine(
        db_session, "openai_compatible", "endpoint-model-x", endpoint_id=endpoint_id
    )
    read = await LlmEngineService(db_session).get_engine_read(
        SEED.primary_project, SEED.primary_profile
    )
    assert read.endpoint_id == endpoint_id
    assert read.endpoint_label == "Lab Ollama"
    assert read.retired is False


@pytest.mark.asyncio
async def test_resolve_endpoint_engine_returns_the_endpoint_target(
    db_session: AsyncSession,
) -> None:
    """Healthy endpoint engine resolves to an ``openai_compatible`` target
    carrying the pointer as a JSON-safe string (the freeze pins it)."""
    endpoint_id = await engine_setup.make_endpoint(db_session)
    await engine_setup.set_project_engine(
        db_session, "openai_compatible", "endpoint-model-x", endpoint_id=endpoint_id
    )
    target = await resolve_project_engine(db_session, SEED.primary_project)
    assert (target.provider, target.model) == ("openai_compatible", "endpoint-model-x")
    assert target.endpoint_id == str(endpoint_id)
    assert (target.mode_requested, target.mode_executed) == ("fast", "fast")


@pytest.mark.asyncio
async def test_resolve_dangling_endpoint_raises_the_typed_409(db_session: AsyncSession) -> None:
    """Rule 6: a stored pointer whose row was deleted concurrently resolves
    to the typed 409 (re-choose message) — never a 500."""
    from app.services.llm_endpoint_service import EndpointUnavailableError

    endpoint_id = await engine_setup.make_endpoint(db_session)
    await engine_setup.set_project_engine(
        db_session, "openai_compatible", "endpoint-model-x", endpoint_id=endpoint_id
    )
    await _delete_endpoint_row(db_session, endpoint_id)
    with pytest.raises(EndpointUnavailableError) as exc_info:
        await resolve_project_engine(db_session, SEED.primary_project)
    assert exc_info.value.code == "LLM_ENDPOINT_UNAVAILABLE"
    assert exc_info.value.status_code == 409
    assert "manager" in exc_info.value.message


@pytest.mark.asyncio
async def test_resolve_unverified_endpoint_raises_the_typed_409(
    db_session: AsyncSession,
) -> None:
    """A probe-state reset after the engine was chosen (e.g. base_url
    edited) refuses new kickoffs with the same typed error."""
    from app.services.llm_endpoint_service import EndpointUnavailableError

    endpoint_id = await engine_setup.make_endpoint(db_session)
    await engine_setup.set_project_engine(
        db_session, "openai_compatible", "endpoint-model-x", endpoint_id=endpoint_id
    )
    await db_session.execute(
        text(
            "UPDATE public.project_llm_endpoints "
            "SET validation_status = 'unverified' WHERE id = :eid"
        ),
        {"eid": str(endpoint_id)},
    )
    with pytest.raises(EndpointUnavailableError):
        await resolve_project_engine(db_session, SEED.primary_project)


@pytest.mark.asyncio
async def test_alternates_stay_catalogue_only_even_for_endpoint_models(
    db_session: AsyncSession,
) -> None:
    """Rule 8 (pin): an alternate pair not in the CATALOG is rejected even
    when it matches a verified endpoint's model — alternates are
    catalogue-only in C2 (the existing A2-1 gate enforces this)."""
    await engine_setup.make_endpoint(db_session, allowed_models=["endpoint-model-x"])
    with pytest.raises(ValueError, match="alternate engine"):
        await engine_setup.set_project_engine(
            db_session,
            "openai",
            "gpt-5.6-terra",
            alternates=[LlmEngineAlternate(provider="openai_compatible", model="endpoint-model-x")],
        )
