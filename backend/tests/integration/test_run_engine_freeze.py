"""The LLM engine is frozen ONCE per run and every later read reuses it.

Regression guard for the #609 fallout. That PR made the model server-owned
(good) but moved the resolution point from the web process into the worker:
``run_from_request`` now does ``settings.LLM_DEFAULT_MODEL`` at execution time.
``run_section_extraction_task`` retries up to 3 times with the SAME payload,
and the model is not in that payload — so every attempt re-read ``settings``
and attempt 2 of one job could run a different engine than attempt 1. Before
#609 the enqueued payload pinned it for the whole job.

These tests simulate a retry the way the worker does it: build the service
again, change ``settings`` in between, and re-enter on the SAME run. The
engine must not move.

The frozen target lives at ``run.results["provenance"]["engine"]``, which only
the server writes. ``run.parameters`` is client-writable — a project reviewer
can hand-write it (the hole #610 closed on the export side) — so it can never
hold provenance.

Only the LLM seams are faked (``build_model`` / ``extract_structured``); the
run row, the freeze write and the provenance merge are real Postgres.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm.extractor import LlmUsage
from app.models.extraction import ExtractionRun
from app.schemas.extraction import SectionExtractionRequest
from app.schemas.llm_target import LlmTarget
from app.services import section_extraction_service as ses
from app.services import verified_mode as vm
from app.services.api_key_service import KeyScope, ResolvedKey
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

#: Stands in for real key material. It must never reach the run row.
_SECRET_KEY = "sk-must-never-be-recorded"

#: What the tests treat as "the setting changed under a retry".
_OTHER_PROVIDER = "anthropic"
_OTHER_MODEL = "claude-sonnet-4-5"


def _service(
    db: AsyncSession,
    trace_id: str,
    key_scope: KeyScope | None = None,
) -> ses.SectionExtractionService:
    """A service built the way the worker builds one — fresh per attempt."""
    return ses.SectionExtractionService(
        db=db,
        user_id=str(SEED.primary_profile),
        storage=MagicMock(),
        trace_id=trace_id,
        openai_api_key=_SECRET_KEY,
        key_scope=key_scope,
    )


def _stub_llm_seams(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    """Fake every outbound LLM seam; return the (provider, model) call log.

    ``build_model`` is the single place the engine reaches the wire, so its
    arguments are the ground truth for "which engine actually ran".
    """
    calls: list[tuple[str, str]] = []

    def _fake_build_model(provider: str, model_name: str, **_kw: Any) -> MagicMock:
        calls.append((provider, model_name))
        return MagicMock()

    async def _fake_extract_structured(**_kw: Any) -> tuple[Any, LlmUsage]:
        return MagicMock(), LlmUsage(prompt_tokens=1, completion_tokens=1)

    monkeypatch.setattr(ses, "build_model", _fake_build_model)
    monkeypatch.setattr(ses, "extract_structured", _fake_extract_structured)
    # The canned "LLM answer": one abstaining field, so the real provenance
    # merge runs without needing evidence anchors or the entailment gate.
    monkeypatch.setattr(
        ses,
        "dump_extraction",
        lambda _out: {
            "sample_size": {
                "value": None,
                "confidence": 0.0,
                "reasoning": "not reported",
                "evidence": [],
                "status": "found",
            }
        },
    )
    # Verified-mode seams (glue module): its build_model must not demand a
    # key, and run_verify_pass must never reach the wire. Unstubbed, the
    # verifier swallows every exception to None BY DESIGN, so a verified test
    # would degrade silently and go vacuously green. Default stub confirms
    # every proposal; tests needing a call log or the failure path re-stub
    # via _stub_verify_pass.
    monkeypatch.setattr(vm, "build_model", _fake_build_model)
    _stub_verify_pass(monkeypatch)
    return calls


def _stub_verify_pass(
    monkeypatch: pytest.MonkeyPatch,
    outcome: str | None = "confirm-all",
) -> list[dict[str, Any]]:
    """Patch the glue's ``run_verify_pass`` seam; return the call log.

    Default: echo-confirm every proposal with a fixed usage (3+2 tokens).
    ``outcome=None`` simulates the degrade path (the verifier swallowed an
    exception and returned ``None``).
    """
    log: list[dict[str, Any]] = []

    async def _fake_run_verify_pass(**kw: Any) -> tuple[dict[str, str], LlmUsage] | None:
        log.append(kw)
        if outcome is None:
            return None
        return (
            {key: "confirmed" for key, _label, _value in kw["proposals"]},
            LlmUsage(prompt_tokens=3, completion_tokens=2),
        )

    monkeypatch.setattr(vm, "run_verify_pass", _fake_run_verify_pass)
    return log


async def _proposal_values(db: AsyncSession, run_id: UUID) -> list[dict[str, Any]]:
    """Every ``proposed_value`` bag written for *run_id*."""
    rows = await db.execute(
        text("SELECT proposed_value FROM public.extraction_proposal_records WHERE run_id = :rid"),
        {"rid": str(run_id)},
    )
    return list(rows.scalars().all())


async def _run_pinned_verified(db: AsyncSession) -> ExtractionRun:
    """A fresh EXTRACT-stage run pre-pinned to the env-default engine in Verified."""
    run = await engine_setup.run_in_extract(db)
    await engine_setup.pin_run(
        db, run, settings.LLM_PROVIDER, settings.LLM_DEFAULT_MODEL, mode="verified"
    )
    return run


async def _extract_once(
    db: AsyncSession,
    run: ExtractionRun,
    trace_id: str,
    key_scope: KeyScope | None = None,
) -> ses.SectionExtractionService:
    """One worker attempt against ``run``, entered exactly like the Celery task.

    ``run_from_request`` is the retried entry point: the payload carries no
    model, so this is where a settings change would leak into attempt 2.
    """
    service = _service(db, trace_id, key_scope)
    service._assemble_prompt_text = AsyncMock(  # type: ignore[method-assign]
        return_value="ARTICLE BODY"
    )
    await service.run_from_request(
        SectionExtractionRequest(
            projectId=SEED.primary_project,
            articleId=SEED.primary_article,
            templateId=SEED.primary_template,
            entityTypeId=SEED.primary_entity_type,
            runId=run.id,
        )
    )
    return service


def _engine_of(run: ExtractionRun) -> dict[str, Any]:
    """The run's frozen engine, or ``{}`` when nothing was recorded."""
    provenance = (run.results or {}).get("provenance") or {}
    return provenance.get("engine") or {}


def _section_provenance(run: ExtractionRun, entity_type_id: UUID) -> dict[str, Any]:
    """One section's provenance snapshot off the run row."""
    provenance = (run.results or {}).get("provenance") or {}
    return (provenance.get("sections") or {}).get(str(entity_type_id)) or {}


@pytest.mark.asyncio
async def test_fresh_run_resolves_engine_from_settings_and_persists_it(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A run with no engine recorded resolves from settings and stores it."""
    calls = _stub_llm_seams(monkeypatch)
    run = await engine_setup.run_in_extract(db_session)

    await _extract_once(db_session, run, "freeze-fresh")
    await db_session.refresh(run)

    assert _engine_of(run) == {
        "provider": settings.LLM_PROVIDER,
        "model": settings.LLM_DEFAULT_MODEL,
        "mode_requested": "fast",
        "mode_executed": "fast",
    }, f"engine not frozen on the run: results={run.results}"
    assert calls, "build_model was never called — the stub is not wired"
    assert calls[0] == (settings.LLM_PROVIDER, settings.LLM_DEFAULT_MODEL)


@pytest.mark.asyncio
async def test_retry_after_settings_change_keeps_the_first_engine(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """THE #609 REGRESSION.

    Attempt 1 runs, the setting changes, attempt 2 re-enters with the same
    payload. Attempt 2 must run attempt 1's engine, not the new setting.
    """
    calls = _stub_llm_seams(monkeypatch)
    original_provider = settings.LLM_PROVIDER
    original_model = settings.LLM_DEFAULT_MODEL

    run = await engine_setup.run_in_extract(db_session)
    await _extract_once(db_session, run, "freeze-attempt-1")

    # The manager flips the engine between the two attempts.
    monkeypatch.setattr(settings, "LLM_PROVIDER", _OTHER_PROVIDER)
    monkeypatch.setattr(settings, "LLM_DEFAULT_MODEL", _OTHER_MODEL)
    calls.clear()

    await _extract_once(db_session, run, "freeze-attempt-2")
    await db_session.refresh(run)

    assert calls, "attempt 2 never reached build_model"
    assert calls == [(original_provider, original_model)] * len(calls), (
        f"attempt 2 ran a different engine than attempt 1: {calls}"
    )
    assert _engine_of(run) == {
        "provider": original_provider,
        "model": original_model,
        "mode_requested": "fast",
        "mode_executed": "fast",
    }


@pytest.mark.asyncio
async def test_recorded_engine_is_never_overwritten(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """First writer wins: a run that already names an engine keeps it."""
    calls = _stub_llm_seams(monkeypatch)
    run = await engine_setup.run_in_extract(db_session)

    # NB: jsonb_set cannot create the intermediate ``provenance`` object, so
    # write the whole bag — a jsonb_set here silently no-ops and the test
    # would assert against a run that never had an engine.
    await db_session.execute(
        text("UPDATE public.extraction_runs SET results = CAST(:r AS jsonb) WHERE id = :rid"),
        {
            "r": f'{{"provenance": {{"engine": '
            f'{{"provider": "{_OTHER_PROVIDER}", "model": "{_OTHER_MODEL}"}}}}}}',
            "rid": str(run.id),
        },
    )
    await db_session.refresh(run)
    assert _engine_of(run) == {"provider": _OTHER_PROVIDER, "model": _OTHER_MODEL}, (
        "pre-seed did not land — the rest of this test would be vacuous"
    )

    await _extract_once(db_session, run, "freeze-existing")
    await db_session.refresh(run)

    # Deliberately mode-less: a pre-C1b pinned snapshot must be tolerated
    # (LlmTarget's mode fields default on validate) and never rewritten —
    # first writer wins means the stored dict stays byte-identical.
    assert _engine_of(run) == {"provider": _OTHER_PROVIDER, "model": _OTHER_MODEL}, (
        "the pre-recorded engine was overwritten"
    )
    assert calls == [(_OTHER_PROVIDER, _OTHER_MODEL)] * len(calls), (
        f"the run's own engine was ignored in favour of settings: {calls}"
    )


@pytest.mark.asyncio
async def test_fresh_run_freezes_the_project_engine(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """C1b: a project WITH ``llm_engine`` set freezes THAT pair, not the env
    default — asserted on the run row AND on what reached ``build_model``.
    Without this, the #609 regression guard stops guarding the real path."""
    calls = _stub_llm_seams(monkeypatch)
    await engine_setup.set_project_engine(db_session, "openai", "gpt-4o")
    run = await engine_setup.run_in_extract(db_session)

    await _extract_once(db_session, run, "freeze-project-pair")
    await db_session.refresh(run)

    assert _engine_of(run) == {
        "provider": "openai",
        "model": "gpt-4o",
        "mode_requested": "fast",
        "mode_executed": "fast",
    }, f"the project engine was not frozen: results={run.results}"
    assert calls, "build_model was never called — the stub is not wired"
    assert calls == [("openai", "gpt-4o")] * len(calls)


@pytest.mark.asyncio
async def test_retry_after_set_for_project_flip_keeps_attempt_1_pair(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A manager flips the PROJECT engine between two attempts of one job —
    attempt 2 must stay on attempt 1's frozen pair (retries stay pinned)."""
    calls = _stub_llm_seams(monkeypatch)
    await engine_setup.set_project_engine(db_session, "openai", "gpt-4o")
    run = await engine_setup.run_in_extract(db_session)
    await _extract_once(db_session, run, "flip-attempt-1")

    await engine_setup.set_project_engine(db_session, "anthropic", "claude-haiku-4-5")
    calls.clear()

    await _extract_once(db_session, run, "flip-attempt-2")
    await db_session.refresh(run)

    assert calls, "attempt 2 never reached build_model"
    assert calls == [("openai", "gpt-4o")] * len(calls), (
        f"attempt 2 followed the flipped project engine: {calls}"
    )
    assert _engine_of(run) == {
        "provider": "openai",
        "model": "gpt-4o",
        "mode_requested": "fast",
        "mode_executed": "fast",
    }


@pytest.mark.asyncio
async def test_section_provenance_records_the_frozen_provider(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Provenance must report what ran, not a later re-read of ``settings``.

    §5.2: recording ``settings.LLM_PROVIDER`` lets an env-var change after the
    run rewrite history — provenance that can lie is worse than none.
    """
    _stub_llm_seams(monkeypatch)
    original_provider = settings.LLM_PROVIDER
    original_model = settings.LLM_DEFAULT_MODEL

    run = await engine_setup.run_in_extract(db_session)
    await _extract_once(db_session, run, "freeze-provenance")

    # The env var moves after the run — the snapshot must not follow it.
    monkeypatch.setattr(settings, "LLM_PROVIDER", _OTHER_PROVIDER)
    monkeypatch.setattr(settings, "LLM_DEFAULT_MODEL", _OTHER_MODEL)
    await _extract_once(db_session, run, "freeze-provenance-2")
    await db_session.refresh(run)

    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot, f"no section provenance was written: results={run.results}"
    assert snapshot["provider"] == original_provider
    assert snapshot["model"] == original_model


@pytest.mark.asyncio
async def test_provenance_records_the_key_scope_and_never_the_key(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """§5.2 wants to know WHOSE key paid, and must never store the key.

    ``get_key_for_provider`` used to return a bare string, so both branches —
    the reviewer's own stored key and prumo's shared one — looked identical to
    the caller and no run could say which one it ran on. The scope now travels
    beside the key; only the scope is recorded.

    The second assertion is the one that matters if this ever regresses: the
    whole run row is searched for the key material, not just the field we
    expect it in.
    """
    _stub_llm_seams(monkeypatch)
    run = await engine_setup.run_in_extract(db_session)

    await _extract_once(db_session, run, "key-scope", KeyScope.USER_BYOK)
    await db_session.refresh(run)

    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot.get("key_scope") == KeyScope.USER_BYOK.value

    assert _SECRET_KEY not in json.dumps(run.results or {}), (
        "key material reached the run row — provenance must carry the scope only"
    )


@pytest.mark.asyncio
async def test_provenance_key_scope_is_null_when_the_caller_did_not_resolve_one(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unknown scope is recorded as null, never guessed.

    Only the caller knows which lookup branch won, so a service built without
    one must not invent ``global_service`` — a wrong attribution is worse than
    an absent one when the record is what an auditor reads.
    """
    _stub_llm_seams(monkeypatch)
    run = await engine_setup.run_in_extract(db_session)

    await _extract_once(db_session, run, "key-scope-none")
    await db_session.refresh(run)

    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot, "no section provenance was written"
    assert snapshot.get("key_scope") is None


# ---------------------------------------------------------------------------
# F1 — the key must match the ADOPTED engine's provider, not the kickoff's
# ---------------------------------------------------------------------------


def _stub_keyed_build_model(
    monkeypatch: pytest.MonkeyPatch,
) -> list[tuple[str, str, str | None]]:
    """Re-patch ``build_model`` to also record the api_key it was handed.

    Call AFTER ``_stub_llm_seams`` (which wires the other seams); the
    (provider, model, api_key) triple is the ground truth for which engine
    ran on whose key.
    """
    calls: list[tuple[str, str, str | None]] = []

    def _fake_build_model(provider: str, model_name: str, **kw: Any) -> MagicMock:
        calls.append((provider, model_name, kw.get("api_key")))
        return MagicMock()

    monkeypatch.setattr(ses, "build_model", _fake_build_model)
    return calls


def _stub_key_service(
    monkeypatch: pytest.MonkeyPatch,
    resolved: ResolvedKey | None,
) -> list[str]:
    """Patch the service-module ``APIKeyService`` seam; return the providers
    the service asked a key for (empty = it never re-keyed)."""
    asked: list[str] = []

    class _RecordingKeys:
        def __init__(self, _db: Any, _user_id: Any) -> None:
            pass

        async def get_key_for_provider(self, provider: str) -> ResolvedKey | None:
            asked.append(provider)
            return resolved

    monkeypatch.setattr(ses, "APIKeyService", _RecordingKeys)
    return asked


def _keyed_service(db: AsyncSession, trace_id: str, key_provider: str) -> Any:
    """A service built the way the worker builds one AFTER resolving a key
    for ``key_provider`` (the freshly-resolved project provider)."""
    return ses.SectionExtractionService(
        db=db,
        user_id=str(SEED.primary_profile),
        storage=MagicMock(),
        trace_id=trace_id,
        openai_api_key=f"key-for-{key_provider}",
        key_scope=KeyScope.USER_BYOK,
        key_provider=key_provider,
    )


@pytest.mark.asyncio
async def test_standalone_kickoff_rekeys_for_the_adopted_pinned_provider(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """F1: a ``run_id=None`` kickoff REUSES the coordinate's live run, so
    ``_adopt_frozen_engine`` can settle on a pin from BEFORE a manager's
    provider flip — after the worker already keyed the freshly-resolved
    project provider. The service must re-resolve key + scope for the
    ADOPTED provider: pairing the anthropic key with the pinned openai
    engine 401s (BYOK), and the recorded ``key_scope`` would name the
    wrong resolution (§5.2)."""
    _stub_llm_seams(monkeypatch)
    keyed_calls = _stub_keyed_build_model(monkeypatch)
    asked = _stub_key_service(monkeypatch, ResolvedKey("key-for-openai", KeyScope.GLOBAL_SERVICE))

    run = await engine_setup.run_in_extract(db_session)
    await engine_setup.pin_run(db_session, run, "openai", "gpt-4o-mini")
    # The manager flips the project provider between pin and kickoff.
    await engine_setup.set_project_engine(db_session, "anthropic", "claude-sonnet-4-5")

    service = _keyed_service(db_session, "f1-standalone-rekey", key_provider="anthropic")
    service._assemble_prompt_text = AsyncMock(  # type: ignore[method-assign]
        return_value="ARTICLE BODY"
    )
    await service.run_from_request(
        SectionExtractionRequest(
            projectId=SEED.primary_project,
            articleId=SEED.primary_article,
            templateId=SEED.primary_template,
            entityTypeId=SEED.primary_entity_type,
            # NO runId: the standalone path resolves the coordinate's live run.
        ),
        engine=LlmTarget(provider="anthropic", model="claude-sonnet-4-5"),
    )
    await db_session.refresh(run)

    assert keyed_calls, "build_model was never called — the stub is not wired"
    assert all(c[:2] == ("openai", "gpt-4o-mini") for c in keyed_calls), (
        f"the pinned engine did not win: {keyed_calls}"
    )
    assert all(c[2] == "key-for-openai" for c in keyed_calls), (
        f"build_model got the kickoff-provider key, not the re-resolved one: {keyed_calls}"
    )
    assert asked == ["openai"], f"expected exactly one re-resolution for openai, got {asked}"
    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot.get("key_scope") == KeyScope.GLOBAL_SERVICE.value, (
        "provenance must carry the RE-RESOLVED scope, not the stale kickoff one"
    )


@pytest.mark.asyncio
async def test_pinned_run_kickoff_with_matching_key_provider_never_rekeys(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The explicit-``run_id`` branch reads the pin before keying, so the
    providers match — the mechanism must not double-key (no second
    ``get_key_for_provider`` and no scope rewrite)."""
    _stub_llm_seams(monkeypatch)
    asked = _stub_key_service(monkeypatch, ResolvedKey("must-not-be-used", KeyScope.GLOBAL_SERVICE))

    run = await engine_setup.run_in_extract(db_session)
    await engine_setup.pin_run(db_session, run, "openai", "gpt-4o-mini")

    service = _keyed_service(db_session, "f1-no-double-key", key_provider="openai")
    service._assemble_prompt_text = AsyncMock(  # type: ignore[method-assign]
        return_value="ARTICLE BODY"
    )
    await service.run_from_request(
        SectionExtractionRequest(
            projectId=SEED.primary_project,
            articleId=SEED.primary_article,
            templateId=SEED.primary_template,
            entityTypeId=SEED.primary_entity_type,
            runId=run.id,
        ),
        engine=LlmTarget(provider="openai", model="gpt-4o-mini"),
    )
    await db_session.refresh(run)

    assert asked == [], f"the service re-keyed on a matching provider: {asked}"
    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot.get("key_scope") == KeyScope.USER_BYOK.value, (
        "the caller's scope was rewritten although the providers matched"
    )


@pytest.mark.asyncio
async def test_rekey_with_no_key_for_the_adopted_provider_degrades_to_none(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A mismatch whose re-resolution finds nothing degrades to no key + no
    scope — never raises — leaving ``build_model``'s global fallback as the
    last resort, with ``key_scope: null`` truthfully recorded."""
    _stub_llm_seams(monkeypatch)
    keyed_calls = _stub_keyed_build_model(monkeypatch)
    asked = _stub_key_service(monkeypatch, None)

    run = await engine_setup.run_in_extract(db_session)
    await engine_setup.pin_run(db_session, run, "openai", "gpt-4o-mini")
    await engine_setup.set_project_engine(db_session, "anthropic", "claude-sonnet-4-5")

    service = _keyed_service(db_session, "f1-rekey-none", key_provider="anthropic")
    service._assemble_prompt_text = AsyncMock(  # type: ignore[method-assign]
        return_value="ARTICLE BODY"
    )
    await service.run_from_request(
        SectionExtractionRequest(
            projectId=SEED.primary_project,
            articleId=SEED.primary_article,
            templateId=SEED.primary_template,
            entityTypeId=SEED.primary_entity_type,
        ),
        engine=LlmTarget(provider="anthropic", model="claude-sonnet-4-5"),
    )
    await db_session.refresh(run)

    assert asked == ["openai"]
    assert keyed_calls and all(c[2] is None for c in keyed_calls), (
        f"the stale anthropic key leaked into build_model: {keyed_calls}"
    )
    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot, "no section provenance was written"
    assert snapshot.get("key_scope") is None, (
        "a scope was invented for a key that was never resolved"
    )


# ---------------------------------------------------------------------------
# Verified mode — the verify pass + the section snapshot's execution truth.
# Execution truth lives ONLY in provenance.sections[et_id] (design 3): the
# frozen engine dict's mode fields are a request-echo, never an execution
# claim. Verified is set up via the run PIN (LlmTarget's bare-str modes);
# the stored-project path lands with the T3 widening.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verified_pin_runs_verify_and_annotates_proposals(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A run pinned to Verified gets the second pass: the verifier runs once
    for the section, verdict annotations land on the proposal rows, the
    SECTION snapshot records verified/2, and the verify usage sums into the
    section token totals."""
    _stub_llm_seams(monkeypatch)
    verify_log = _stub_verify_pass(monkeypatch)
    run = await _run_pinned_verified(db_session)

    await _extract_once(db_session, run, "verified-success")
    await db_session.refresh(run)

    assert len(verify_log) == 1, "the verifier must run exactly once per section"
    # F6a: the verify prompt grounds in the entity's human LABEL, not the name.
    assert verify_log[0]["entity_type_label"] == "Participants"
    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot["mode_requested"] == "verified"
    assert snapshot["mode_executed"] == "verified"
    assert snapshot["passes"] == 2
    # extract (1+1) + verify (3+2): the verify usage is IN the run's totals.
    assert snapshot["tokens"] == {"prompt": 4, "completion": 3, "total": 7}
    values = await _proposal_values(db_session, run.id)
    assert values, "no proposal rows were written"
    assert all(pv.get("verification") == {"verdict": "confirmed"} for pv in values), (
        f"verdict annotation missing on proposal rows: {values}"
    )


@pytest.mark.asyncio
async def test_fresh_run_freezes_the_stored_verified_mode(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T3: a project whose STORED engine says verified freezes that mode into
    the engine dict (exact dict — a request-echo) and the section snapshot
    records the executed verify pass."""
    _stub_llm_seams(monkeypatch)
    verify_log = _stub_verify_pass(monkeypatch)
    await engine_setup.set_project_engine(db_session, "openai", "gpt-4o", mode="verified")
    run = await engine_setup.run_in_extract(db_session)

    await _extract_once(db_session, run, "freeze-stored-verified")
    await db_session.refresh(run)

    assert _engine_of(run) == {
        "provider": "openai",
        "model": "gpt-4o",
        "mode_requested": "verified",
        "mode_executed": "verified",
    }, f"the stored verified mode was not frozen: results={run.results}"
    assert len(verify_log) == 1
    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot["mode_executed"] == "verified"
    assert snapshot["passes"] == 2


@pytest.mark.asyncio
async def test_verified_pin_verify_failure_degrades_to_fast(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Design 3: the verify pass degrades, honestly recorded — proposals land
    UNANNOTATED and the section snapshot says mode_executed fast, passes 1,
    while mode_requested still records the ask."""
    _stub_llm_seams(monkeypatch)
    verify_log = _stub_verify_pass(monkeypatch, outcome=None)
    run = await _run_pinned_verified(db_session)

    await _extract_once(db_session, run, "verified-degrade")
    await db_session.refresh(run)

    assert len(verify_log) == 1
    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot["mode_requested"] == "verified"
    assert snapshot["mode_executed"] == "fast"
    assert snapshot["passes"] == 1
    # No verify tokens on the degrade path — extract usage only.
    assert snapshot["tokens"] == {"prompt": 1, "completion": 1, "total": 2}
    values = await _proposal_values(db_session, run.id)
    assert values, "no proposal rows were written"
    assert all("verification" not in pv for pv in values), (
        f"a flaked verify must leave proposals unannotated: {values}"
    )


@pytest.mark.asyncio
async def test_fast_run_never_calls_the_verifier(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Fast project: the verify seam is NEVER reached (must-not-be-called
    guard) and the section snapshot records fast/1."""
    _stub_llm_seams(monkeypatch)
    verify_log = _stub_verify_pass(monkeypatch)
    run = await engine_setup.run_in_extract(db_session)

    await _extract_once(db_session, run, "fast-guard")
    await db_session.refresh(run)

    assert verify_log == [], f"the verifier ran on a fast project: {verify_log}"
    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot["mode_requested"] == "fast"
    assert snapshot["mode_executed"] == "fast"
    assert snapshot["passes"] == 1


@pytest.mark.asyncio
async def test_verified_no_info_proposal_carries_no_verification_key(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No-info proposals are NOT verified — there is no value to check. F5:
    an all-no-info section never invokes the verifier at all, and its
    snapshot says verified/1 — ``passes`` counts LLM passes that RAN, and
    "nothing needed verifying" is not a degrade."""
    _stub_llm_seams(monkeypatch)
    verify_log = _stub_verify_pass(monkeypatch)
    monkeypatch.setattr(
        ses,
        "dump_extraction",
        lambda _out: {
            "sample_size": {
                "value": None,
                "confidence": None,
                "reasoning": "not stated",
                "evidence": [],
                "status": "not_found",
            }
        },
    )
    run = await _run_pinned_verified(db_session)

    await _extract_once(db_session, run, "verified-no-info")
    await db_session.refresh(run)

    # Zero found fields -> the verify pass is skipped BEFORE any call.
    assert verify_log == [], f"the verifier ran on an all-no-info section: {verify_log}"
    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot["mode_requested"] == "verified"
    assert snapshot["mode_executed"] == "verified"
    assert snapshot["passes"] == 1
    # Zero verify tokens — extract usage only.
    assert snapshot["tokens"] == {"prompt": 1, "completion": 1, "total": 2}
    values = await _proposal_values(db_session, run.id)
    assert values == [{"value": None, "absent_reason": "no_information"}]


@pytest.mark.asyncio
async def test_verified_qa_run_skips_the_verifier(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """F4: the verify prompt judges whether the TEXT states a value —
    inapplicable to evaluative QA judgments, which would draw systematic
    amber chips on legitimate assessments. A ``quality_assessment`` run on a
    verified engine skips the pass: verifier never called, proposals
    unannotated, snapshot says requested-verified / executed-fast / 1 pass,
    under the DISTINCT ``verify_skipped_qa_kind`` log (never confusable
    with a flake)."""
    from structlog.testing import capture_logs

    _stub_llm_seams(monkeypatch)
    verify_log = _stub_verify_pass(monkeypatch)
    # Flip the TEMPLATE to the QA kind BEFORE the run exists: create_run
    # derives run.kind from the template, and the composite FK
    # fk_extraction_runs_template_kind_coherence forbids flipping either
    # side once the pair is referenced.
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET kind = 'quality_assessment' WHERE id = :tid"
        ),
        {"tid": str(SEED.primary_template)},
    )
    run = await _run_pinned_verified(db_session)
    assert run.kind == "quality_assessment", "the run must derive the QA kind"

    with capture_logs() as entries:
        await _extract_once(db_session, run, "verified-qa-skip")
    await db_session.refresh(run)

    assert verify_log == [], f"the verifier ran on a QA run: {verify_log}"
    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot["mode_requested"] == "verified"
    assert snapshot["mode_executed"] == "fast"
    assert snapshot["passes"] == 1
    values = await _proposal_values(db_session, run.id)
    assert values, "no proposal rows were written"
    assert all("verification" not in pv for pv in values)
    assert any(e["event"] == "verify_skipped_qa_kind" for e in entries), (
        "the QA skip must be logged under its own event, distinct from a flake"
    )
