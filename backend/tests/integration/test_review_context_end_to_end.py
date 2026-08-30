"""The review question actually reaches a real prompt, and is recorded.

Everything upstream of this is proven in isolation: the renderer
(``test_project_ai_context``), the prompt block (``test_review_context_prompt``)
and the pin (``test_run_review_context_pin``). This is the seam that proves
they are wired together — a manager fills PICOT, a run extracts, and the block
is in the prompt the model got AND in the provenance a reviewer can read back.

Only the outbound LLM seams are faked. The run row, the pin write, the prompt
render and the provenance merge are real Postgres and real code.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.extractor import LlmUsage
from app.models.extraction import ExtractionRun
from app.schemas.extraction import SectionExtractionRequest
from app.services import section_extraction_service as ses
from app.services import verified_mode as vm
from app.services.engine_credentials import EngineCredentials
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

_PICOT = {
    "population": {
        "description": "Adults hospitalised with acute heart failure",
        "inclusion": ["NYHA II-IV"],
        "exclusion": ["paediatric cohorts"],
    },
    "index_models": {"description": "Multimodal ML models", "inclusion": [], "exclusion": []},
}

#: A LITERAL, not a re-render. Comparing the recorded provenance against a live
#: ``build_review_context`` call would compare the renderer to itself and could
#: never fail — the same self-fulfilling trap the prompt goldens avoid.
_EXPECTED_BLOCK = (
    "- Population: Adults hospitalised with acute heart failure\n"
    "  Include: NYHA II-IV\n"
    "  Exclude: paediatric cohorts\n"
    "- Index model(s): Multimodal ML models"
)


async def _set_picots(db: AsyncSession, project_id: UUID, picots: dict[str, Any]) -> None:
    # ``review_type`` drives the I/C labels, and the seeded project is not
    # necessarily a predictive-model review — set both so the assertion pins
    # the instrument's own wording rather than whatever the seed happens to be.
    await db.execute(
        text(
            "UPDATE public.projects "
            "SET picots_config_ai_review = CAST(:p AS jsonb), review_type = 'predictive_model' "
            "WHERE id = :pid"
        ),
        {"p": json.dumps(picots), "pid": str(project_id)},
    )
    await db.flush()


def _stub_llm_seams(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """Fake the wire; capture the user prompt the model would have received."""
    captured: dict[str, str] = {}

    async def _fake_extract_structured(**kwargs: Any) -> tuple[Any, LlmUsage]:
        captured.setdefault("user_prompt", kwargs["user_prompt"])
        return object(), LlmUsage(prompt_tokens=1, completion_tokens=1)

    monkeypatch.setattr(ses, "build_model", lambda *_a, **_k: object())
    monkeypatch.setattr(vm, "build_model", lambda *_a, **_k: object())
    monkeypatch.setattr(ses, "extract_structured", _fake_extract_structured)
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
    monkeypatch.setattr(vm, "run_verify_pass", _never_called)
    return captured


async def _never_called(**_kw: Any) -> None:
    return None


async def _extract_once(db: AsyncSession, run: ExtractionRun) -> None:
    service = ses.SectionExtractionService(
        db=db,
        user_id=str(SEED.primary_profile),
        storage=object(),
        trace_id="review-context-e2e",
        llm_credentials=EngineCredentials(
            api_key="sk-never-recorded", key_scope=None, base_url=None, endpoint_id=None
        ),
        repin=True,
    )
    service._assemble_prompt_text = _fixed_article  # type: ignore[method-assign]
    await service.run_from_request(
        SectionExtractionRequest(
            projectId=SEED.primary_project,
            articleId=SEED.primary_article,
            templateId=SEED.primary_template,
            entityTypeId=SEED.primary_entity_type,
            runId=run.id,
        )
    )


async def _fixed_article(*_a: Any, **_k: Any) -> str:
    return "ARTICLE BODY"


@pytest.mark.asyncio
async def test_the_review_question_reaches_the_prompt_and_the_provenance(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = await engine_setup.run_in_extract(db_session)
    await _set_picots(db_session, run.project_id, _PICOT)
    captured = _stub_llm_seams(monkeypatch)

    await _extract_once(db_session, run)

    # 1. The model got it, leading the prompt.
    assert captured["user_prompt"].startswith(f"Review question and scope:\n{_EXPECTED_BLOCK}\n\n")

    await db_session.refresh(run)
    provenance = (run.results or {}).get("provenance") or {}

    # 2. The run records exactly what it sent — pinned, not re-derived.
    assert provenance["review_context"] == {"text": _EXPECTED_BLOCK}

    # 3. The per-section composition carries it too, which is what
    #    GenerationDetailsDialog renders — so "tracking is free" is real and
    #    needs no new provenance field or UI.
    sections = provenance.get("sections") or {}
    assert sections, f"no per-section provenance was merged: {provenance}"
    instruction = next(iter(sections.values()))["prompt_composition"]["section_instruction"]
    assert instruction.startswith(f"Review question and scope:\n{_EXPECTED_BLOCK}\n\n")

    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_project_with_no_picot_sends_no_block_at_all(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The no-regression proof at the level that matters: a whole run.

    The renderer being inert on empty input is a unit test; this is the
    corpus claim — an untouched project's prompt gains nothing.
    """
    run = await engine_setup.run_in_extract(db_session)
    await db_session.execute(
        text("UPDATE public.projects SET picots_config_ai_review = NULL WHERE id = :pid"),
        {"pid": str(run.project_id)},
    )
    await db_session.flush()
    captured = _stub_llm_seams(monkeypatch)

    await _extract_once(db_session, run)

    assert "Review question and scope:" not in captured["user_prompt"]
    await db_session.refresh(run)
    assert ((run.results or {}).get("provenance") or {})["review_context"] == {"text": None}
    await db_session.rollback()
