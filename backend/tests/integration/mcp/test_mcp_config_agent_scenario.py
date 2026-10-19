"""The configuration scenario end to end: a blank template a manager created
becomes a published questionnaire through MCP calls only, plus one REST
publish (publishing is human-only in prumo).

Setup: the cross-project seed with `review_type` set, an empty review
question, a parsed PDF on every article, the parser left off LlamaParse and
the caller's own (fake) key for the project's AI engine. The credential seam
is pinned: `global_key_for` answers None, so no environment key can satisfy
the engine check locally while CI (which has none) fails it. No model is
called anywhere in the flow.

Every MCP write call writes exactly one `applied` audit row and none is
refused."""

from __future__ import annotations

from collections import Counter
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.parser_settings_service import ParserSettingsService
from app.services.template_create_service import create_blank_template
from app.utils.compact_json import RESULT_CAP, compact_json
from tests.integration.conftest import SEED, clean_project_clones
from tests.integration.helpers.template_fixtures import ARTICLE_ID
from tests.integration.mcp.test_mcp_setup_readiness import (
    _configure_engine,
    _no_global_key,
    _parse_every_article,
)
from tests.integration.mcp.tool_calls import call_tool, structured

P = SEED.secondary_project
_TEMPLATE_CODES = {"TEMPLATE_NOT_PUBLISHED", "TEMPLATE_NARROW_BASELINE", "DRAFT_PENDING_PUBLISH"}


async def _prepare_project(db: AsyncSession) -> None:
    await clean_project_clones(db, P)
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'Scenario article', 1) ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(ARTICLE_ID), "pid": str(P)},
    )
    await db.execute(
        text(
            "UPDATE public.projects SET review_type = 'prognostic', "
            "picots_config_ai_review = '{}'::jsonb, eligibility_criteria = '{}'::jsonb, "
            "study_design = '{}'::jsonb, settings = COALESCE(settings, '{}'::jsonb) - 'ai_context' "
            "WHERE id = :pid"
        ),
        {"pid": str(P)},
    )
    await _configure_engine(db, P)
    await _parse_every_article(db, P)
    await db.flush()


async def _readiness(mcp_client, pat) -> dict[str, Any]:
    body = structured(
        await call_tool(mcp_client, pat, "get_setup_readiness", {"project_id": str(P)})
    )
    assert len(compact_json(body)) <= RESULT_CAP
    assert body["items_truncated"] is False
    return body


def _codes(body: dict[str, Any]) -> set[str]:
    return {item["code"] for item in body["items"]}


async def _applied_and_refused(db: AsyncSession) -> tuple[Counter[str], int]:
    rows = (
        await db.execute(
            text("SELECT tool, outcome FROM public.agent_actions WHERE project_id = :pid"),
            {"pid": str(P)},
        )
    ).all()
    applied = Counter(r.tool for r in rows if r.outcome == "applied")
    return applied, sum(r.outcome == "refused" for r in rows)


async def test_blank_template_to_published_questionnaire(
    mcp_client,
    pat_primary_rw,
    db_session: AsyncSession,
    db_client: AsyncClient,
    auth_as_profile,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert auth_as_profile == SEED.primary_profile
    _no_global_key(monkeypatch)
    await _prepare_project(db_session)
    assert await ParserSettingsService(db_session).get_for_project(P) != "llamaparse"
    template_id = (
        await create_blank_template(
            db_session,
            project_id=P,
            name="Scenario questionnaire",
            description=None,
            framework="CUSTOM",
            user_id=SEED.primary_profile,
        )
    ).project_template_id
    writes: Counter[str] = Counter()

    async def write(tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
        body = structured(await call_tool(mcp_client, pat_primary_rw, tool, arguments))
        writes[tool] += 1
        return body

    async def edit(ops: list[dict[str, Any]]) -> dict[str, Any]:
        return await write(
            "edit_template_draft",
            {"project_id": str(P), "template_id": str(template_id), "ops": ops},
        )

    # 1. Readiness names the empty review question.
    first = await _readiness(mcp_client, pat_primary_rw)
    assert "REVIEW_QUESTION_EMPTY" in _codes(first)
    assert not {"ENGINE_NO_CREDENTIAL", "ARTICLES_WITHOUT_TEXT"} & _codes(first)

    # 2. The review question, compare-and-swap on the revision just read.
    question = structured(
        await call_tool(mcp_client, pat_primary_rw, "get_review_question", {"project_id": str(P)})
    )
    written = await write(
        "set_review_question",
        {
            "project_id": str(P),
            "expected_revision": question["revision"],
            "slots": {
                "population": {
                    "description": "Adults admitted to intensive care",
                    "inclusion": ["ICU admission"],
                    "exclusion": [],
                },
                "outcomes": {
                    "description": "In-hospital mortality",
                    "inclusion": [],
                    "exclusion": [],
                },
            },
        },
    )
    assert written["revision"] == question["revision"] + 1

    # 3. Eligibility through update_project_details, `expected` echoed from get_project.
    project = structured(
        await call_tool(mcp_client, pat_primary_rw, "get_project", {"project_id": str(P)})
    )
    eligibility = {
        "inclusion": ["Prognostic model development or validation"],
        "exclusion": ["Paediatric populations"],
        "notes": "",
    }
    details = await write(
        "update_project_details",
        {
            "project_id": str(P),
            "fields": {"eligibility_criteria": eligibility},
            "expected": {"eligibility_criteria": project["details"]["eligibility_criteria"]},
        },
    )
    assert details["after"]["eligibility_criteria"] == eligibility

    # 4. The questionnaire: a repeating section keyed by its entity-key
    # question, and a single section with a coded select; every question
    # carries AI instructions.
    sections = await edit(
        [
            {
                "op": "add_section",
                "label": "Prediction models",
                "cardinality": "many",
                "entry_label": "Model",
            },
            {"op": "add_section", "label": "Study", "cardinality": "one"},
        ]
    )
    models_id, study_id = (op["section_id"] for op in sections["applied"])
    questions = await edit(
        [
            {
                "op": "add_question",
                "section_id": models_id,
                "label": "Model name",
                "type": "text",
                "instructions": "The name the article gives the model.",
            },
            {
                "op": "add_question",
                "section_id": study_id,
                "label": "Data source",
                "type": "select",
                "options": [
                    {"value": "cohort", "label": "Prospective cohort"},
                    {"value": "registry", "label": "Registry"},
                ],
                "instructions": "Where the study's participants come from.",
            },
        ]
    )
    key_field = questions["applied"][0]["field_id"]
    keyed = await edit([{"op": "update_question", "field_id": key_field, "is_entity_key": True}])
    assert keyed["lint"] == {"block": 0, "warn": 0}
    assert keyed["visible_to_reviewers_and_ai"] is False

    # 5. The changes view and the REST diff the Publish sheet reads agree.
    changes = structured(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "get_template",
            {"project_id": str(P), "template_id": str(template_id), "view": "changes"},
        )
    )
    assert len(compact_json(changes)) <= RESULT_CAP
    diff = await db_client.get(f"/api/v1/projects/{P}/templates/{template_id}/config-diff")
    assert diff.status_code == 200, diff.text
    fingerprint = diff.json()["data"]["fingerprint"]
    assert fingerprint
    assert changes["fingerprint"] == fingerprint == keyed["draft_fingerprint"]

    # 6. Nothing blocks; the only items are the template's pending draft and
    # its empty v1 baseline (a blank template publishes an empty version).
    ready = await _readiness(mcp_client, pat_primary_rw)
    assert ready["summary"]["block"] == 0
    assert ready["summary"]["ok"] is True
    assert _codes(ready) == {"DRAFT_PENDING_PUBLISH", "TEMPLATE_NARROW_BASELINE"}
    assert all(item["subject"]["id"] == str(template_id) for item in ready["items"])

    # 7. A manager publishes in prumo (REST), with the fingerprint they reviewed.
    published = await db_client.post(
        f"/api/v1/projects/{P}/templates/{template_id}/republish-version",
        json={"expected_fingerprint": fingerprint, "acknowledged": []},
    )
    assert published.status_code == 200, published.text
    assert published.json()["data"]["changed"] is True

    # 8. No template item remains.
    final = await _readiness(mcp_client, pat_primary_rw)
    assert not _codes(final) & _TEMPLATE_CODES
    assert final["items"] == []
    assert final["summary"] == {"block": 0, "warn": 0, "ok": True}

    applied, refused = await _applied_and_refused(db_session)
    assert writes == Counter(
        {"set_review_question": 1, "update_project_details": 1, "edit_template_draft": 3}
    )
    assert applied == writes
    assert refused == 0
