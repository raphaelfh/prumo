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
from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.schemas.extraction import SectionExtractionRequest
from app.services import section_extraction_service as ses
from app.services.api_key_service import KeyScope
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED

#: Stands in for real key material. It must never reach the run row.
_SECRET_KEY = "sk-must-never-be-recorded"

#: What the tests treat as "the setting changed under a retry".
_OTHER_PROVIDER = "anthropic"
_OTHER_MODEL = "claude-sonnet-4-5"


async def _run_in_extract(db: AsyncSession) -> ExtractionRun:
    """A fresh run for the seeded coordinate, advanced to EXTRACT."""
    await db.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "tid": str(SEED.primary_template),
        },
    )
    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    run = await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.EXTRACT,
        user_id=SEED.primary_profile,
    )
    await db.flush()
    return run


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
    return calls


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
    run = await _run_in_extract(db_session)

    await _extract_once(db_session, run, "freeze-fresh")
    await db_session.refresh(run)

    assert _engine_of(run) == {
        "provider": settings.LLM_PROVIDER,
        "model": settings.LLM_DEFAULT_MODEL,
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

    run = await _run_in_extract(db_session)
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
    assert _engine_of(run) == {"provider": original_provider, "model": original_model}


@pytest.mark.asyncio
async def test_recorded_engine_is_never_overwritten(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """First writer wins: a run that already names an engine keeps it."""
    calls = _stub_llm_seams(monkeypatch)
    run = await _run_in_extract(db_session)

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

    assert _engine_of(run) == {"provider": _OTHER_PROVIDER, "model": _OTHER_MODEL}, (
        "the pre-recorded engine was overwritten"
    )
    assert calls == [(_OTHER_PROVIDER, _OTHER_MODEL)] * len(calls), (
        f"the run's own engine was ignored in favour of settings: {calls}"
    )


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

    run = await _run_in_extract(db_session)
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
    run = await _run_in_extract(db_session)

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
    run = await _run_in_extract(db_session)

    await _extract_once(db_session, run, "key-scope-none")
    await db_session.refresh(run)

    snapshot = _section_provenance(run, SEED.primary_entity_type)
    assert snapshot, "no section provenance was written"
    assert snapshot.get("key_scope") is None
