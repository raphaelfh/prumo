"""get_setup_readiness: review-question, template and lint items.

The fixture is CHARMS cloned and published into the cross-project seed, with
`review_type` set and an empty review question. Live-tree problems are
inserted with raw SQL (`add_question` refuses a select without options); the
live-table triggers stamp `config_draft_since`, so the draft is open.

In-memory SDK client, so the tool lines register coverage; one service-level
test calls `build_setup_readiness` directly."""

from __future__ import annotations

from typing import Any, get_args
from uuid import UUID, uuid4

import pytest
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import TemplateKind
from app.schemas.llm_connection import ProjectConnectionCreateRequest, UserConnectionCreateRequest
from app.schemas.mcp_readiness import ReadinessCode
from app.schemas.template_lint import LintCode
from app.services import llm_connection_service, project_setup_readiness
from app.services.hitl_config_service import HitlConfigService
from app.services.llm_connection_service import (
    ConnectionUnavailableError,
    LlmConnectionService,
    MissingCredentialError,
)
from app.services.llm_engine_service import EngineRetiredError, LlmEngineService
from app.services.parser_settings_service import ParserSettingsService
from app.services.project_setup_readiness import build_setup_readiness
from app.services.template_versioning import clone_template
from app.utils.app_urls import editor_url, settings_url
from app.utils.compact_json import RESULT_CAP, compact_json
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import fresh_charms
from tests.integration.mcp.tool_calls import call_tool, structured

PROBAST_GLOBAL_ID = UUID("00b00000-0000-0000-0000-000000000001")


async def _readiness(mcp_client, pat, project_id: UUID) -> dict[str, Any]:
    body = structured(
        await call_tool(mcp_client, pat, "get_setup_readiness", {"project_id": str(project_id)})
    )
    assert len(compact_json(body)) <= RESULT_CAP
    return body


def _codes(body: dict[str, Any]) -> set[str]:
    return {item["code"] for item in body["items"]}


def _items(body: dict[str, Any], code: str) -> list[dict[str, Any]]:
    return [item for item in body["items"] if item["code"] == code]


async def _first_section_id(db: AsyncSession, template_id: UUID) -> UUID:
    return (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid ORDER BY sort_order LIMIT 1"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()


async def _add_select_without_options(db: AsyncSession, template_id: UUID) -> None:
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order, "
            " llm_description) "
            "VALUES (:id, :etid, 'readiness_pick', 'Readiness pick', 'select', false, 999, "
            " 'Pick one.')"
        ),
        {"id": str(uuid4()), "etid": str(await _first_section_id(db, template_id))},
    )


async def _add_repeating_section_without_key(db: AsyncSession, template_id: UUID) -> None:
    section = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, parent_entity_type_id, "
            " sort_order, is_required, entry_label) "
            "VALUES (:id, :tid, 'readiness_arms', 'Readiness arms', 'many', NULL, 999, false, "
            " 'Arm')"
        ),
        {"id": str(section), "tid": str(template_id)},
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order, "
            " llm_description) "
            "VALUES (:id, :etid, 'arm_dose', 'Arm dose', 'text', false, 0, 'The dose.')"
        ),
        {"id": str(uuid4()), "etid": str(section)},
    )
    await db.flush()


async def _configure_engine(db: AsyncSession, project_id: UUID) -> UUID:
    """A catalogue engine for the project and the caller's own key for it."""
    await LlmEngineService(db).set_for_project(
        project_id=project_id,
        provider="openai",
        model="gpt-5.6-terra",
        mode="fast",
        updated_by=SEED.primary_profile,
    )
    read = await LlmConnectionService(db).create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(
            provider="openai", label="readiness user key", api_key=SecretStr("sk-readiness")
        ),
    )
    return read.id


async def _parse_every_article(db: AsyncSession, project_id: UUID) -> None:
    await db.execute(
        text(
            "INSERT INTO public.article_files "
            "(id, project_id, article_id, file_type, storage_key, file_role, extraction_status) "
            "SELECT gen_random_uuid(), a.project_id, a.id, 'pdf', 'readiness/' || a.id, 'MAIN', "
            " 'parsed' FROM public.articles a WHERE a.project_id = :pid"
        ),
        {"pid": str(project_id)},
    )


async def _fixture(db: AsyncSession) -> tuple[UUID, UUID]:
    """A published CHARMS clone whose live tree has two blocking problems; the
    engine, reviewers, article text and parser are configured."""
    project_id, template_id, _schema = await fresh_charms(db)
    await db.execute(
        text("UPDATE public.projects SET review_type = 'prognostic' WHERE id = :pid"),
        {"pid": str(project_id)},
    )
    await _configure_engine(db, project_id)
    await _parse_every_article(db, project_id)
    await _add_select_without_options(db, template_id)
    await _add_repeating_section_without_key(db, template_id)
    return project_id, template_id


async def _add_reviewer(db: AsyncSession, project_id: UUID) -> None:
    await db.execute(
        text(
            "INSERT INTO public.project_members (id, project_id, user_id, role) "
            "VALUES (gen_random_uuid(), :pid, :uid, 'reviewer') "
            "ON CONFLICT (project_id, user_id) DO NOTHING"
        ),
        {"pid": str(project_id), "uid": str(SEED.reviewer_profile)},
    )


async def _unpublish(db: AsyncSession, template_id: UUID) -> None:
    await db.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )


async def test_protocol_and_lint_items(mcp_client, pat_primary_rw, db_session):
    project_id, template_id = await _fixture(db_session)

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    assert _codes(body) == {
        "REVIEW_QUESTION_EMPTY",
        "SELECT_WITHOUT_OPTIONS",
        "REPEATING_SECTION_WITHOUT_ENTITY_KEY",
        "DRAFT_PENDING_PUBLISH",
    }
    assert body["draft_detail_hidden"] is False
    assert body["project_name"] == "Integration Test — Cross-Project"
    assert body["summary"] == {"block": 2, "warn": 2, "ok": False}
    [question] = _items(body, "REVIEW_QUESTION_EMPTY")
    assert question["status"] == "warn"
    assert question["next_step"] == "call set_review_question"
    assert question["subject"] is None
    [select] = _items(body, "SELECT_WITHOUT_OPTIONS")
    [repeating] = _items(body, "REPEATING_SECTION_WITHOUT_ENTITY_KEY")
    for lint in (select, repeating):
        assert lint["tree"] == "draft"
        assert lint["status"] == "block"
        assert lint["next_step"] == "edit_template_draft"
        assert lint["subject"]["id"] == str(template_id)
    assert "Readiness pick" in select["message"]
    assert "Readiness arms" in repeating["message"]
    [draft] = _items(body, "DRAFT_PENDING_PUBLISH")
    assert draft["next_step"] == (
        f"a manager publishes in prumo at {editor_url(project_id, 'extraction')}"
    )
    # Item order: review question first, then the template, then its lint.
    assert [i["code"] for i in body["items"]][:2] == [
        "REVIEW_QUESTION_EMPTY",
        "DRAFT_PENDING_PUBLISH",
    ]


async def test_reviewer_sees_no_draft_items(mcp_client, pat_reviewer_rw, db_session):
    project_id, _template_id = await _fixture(db_session)
    await _add_reviewer(db_session, project_id)

    body = await _readiness(mcp_client, pat_reviewer_rw, project_id)

    assert body["draft_detail_hidden"] is True
    assert "REVIEW_QUESTION_EMPTY" in _codes(body)  # precondition: items are computed
    assert "DRAFT_PENDING_PUBLISH" not in _codes(body)
    assert all(item["tree"] != "draft" for item in body["items"])


async def test_disabled_switch_reports_disabled_only(mcp_client, pat_primary_rw, db_session):
    project_id, _template_id = await _fixture(db_session)
    await db_session.execute(
        text(
            "UPDATE public.projects SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), "
            "'{ai_context}', '{\"picots\": false}'::jsonb) WHERE id = :pid"
        ),
        {"pid": str(project_id)},
    )

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    [disabled] = _items(body, "REVIEW_QUESTION_DISABLED")
    assert disabled["status"] == "warn"
    assert disabled["next_step"] == "call set_review_question"
    assert "REVIEW_QUESTION_EMPTY" not in _codes(body)


async def test_no_active_extraction_template_blocks(mcp_client, pat_primary_rw, db_session):
    project_id, template_id = await _fixture(db_session)
    await db_session.execute(
        text("UPDATE public.project_extraction_templates SET is_active = false WHERE id = :tid"),
        {"tid": str(template_id)},
    )

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    [missing] = _items(body, "NO_ACTIVE_EXTRACTION_TEMPLATE")
    assert missing["status"] == "block"
    assert missing["next_step"] == editor_url(project_id, "extraction")
    assert body["summary"]["ok"] is False
    # An inactive template gets no per-template or lint items.
    assert all(item["subject"] is None for item in body["items"])


async def test_review_type_missing_warns(mcp_client, pat_primary_rw, db_session):
    project_id, _template_id = await _fixture(db_session)
    await db_session.execute(
        text("UPDATE public.projects SET review_type = NULL WHERE id = :pid"),
        {"pid": str(project_id)},
    )

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    [missing] = _items(body, "REVIEW_TYPE_MISSING")
    assert missing["status"] == "warn"
    assert missing["next_step"] == "call update_project_details with review_type"


async def test_unpublished_template_blocks(mcp_client, pat_primary_rw, db_session):
    project_id, template_id = await _fixture(db_session)
    await _unpublish(db_session, template_id)

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    [unpublished] = _items(body, "TEMPLATE_NOT_PUBLISHED")
    assert unpublished["status"] == "block"
    assert unpublished["subject"] == {
        "kind": "template",
        "id": str(template_id),
        "name": "CHARMS",
    }
    assert unpublished["next_step"] == editor_url(project_id, "extraction")
    assert not [i for i in body["items"] if i["tree"] == "published"]
    assert [i for i in body["items"] if i["tree"] == "draft"]  # draft lint still runs


async def test_narrow_baseline_warns(mcp_client, pat_primary_rw, db_session):
    from tests.integration.helpers.template_fixtures import force_narrow_baseline

    project_id, template_id = await _fixture(db_session)
    await force_narrow_baseline(
        db_session, template_id, await _first_section_id(db_session, template_id)
    )

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    [narrow] = _items(body, "TEMPLATE_NARROW_BASELINE")
    assert narrow["status"] == "warn"
    assert narrow["subject"]["kind"] == "template"
    assert narrow["subject"]["id"] == str(template_id)


async def test_published_lint_points_to_the_editor(mcp_client, pat_primary_rw, db_session):
    project_id, template_id, _schema = await fresh_charms(db_session)
    await _add_select_without_options(db_session, template_id)
    from app.services.template_versioning import TemplateVersionService

    await TemplateVersionService(db_session).republish(
        project_id=project_id, project_template_id=template_id, user_id=SEED.primary_profile
    )

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    # No draft is open, so the draft tree equals the published one: listed once.
    assert "DRAFT_PENDING_PUBLISH" not in _codes(body)
    [published] = _items(body, "SELECT_WITHOUT_OPTIONS")
    assert published["tree"] == "published"
    assert published["next_step"] == editor_url(project_id, "extraction")
    assert "Readiness pick" in published["message"]


async def test_quality_assessment_template_items(mcp_client, pat_primary_rw, db_session):
    project_id, _template_id = await _fixture(db_session)
    clone = await clone_template(
        db_session,
        project_id=project_id,
        global_template_id=PROBAST_GLOBAL_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.QUALITY_ASSESSMENT,
    )
    qa_id = clone.project_template_id
    await _add_select_without_options(db_session, qa_id)

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    qa_items = [i for i in body["items"] if (i["subject"] or {}).get("id") == str(qa_id)]
    qa_codes = {(i["code"], i["tree"]) for i in qa_items}
    assert ("SELECT_WITHOUT_OPTIONS", "draft") in qa_codes
    assert ("DRAFT_PENDING_PUBLISH", None) in qa_codes
    [draft] = [i for i in qa_items if i["code"] == "DRAFT_PENDING_PUBLISH"]
    assert draft["next_step"].endswith(editor_url(project_id, "quality_assessment"))

    await _unpublish(db_session, qa_id)
    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    unpublished = [
        i for i in _items(body, "TEMPLATE_NOT_PUBLISHED") if i["subject"]["id"] == str(qa_id)
    ]
    assert len(unpublished) == 1
    assert unpublished[0]["next_step"] == editor_url(project_id, "quality_assessment")


async def test_result_within_cap_on_200_questions(mcp_client, pat_primary_rw, db_session):
    project_id, template_id = await _fixture(db_session)
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order) "
            "SELECT gen_random_uuid(), :etid, 'bare_' || n, "
            " 'Bare question ' || n || ' ' || repeat('x', 150), 'text', false, 1000 + n "
            "FROM generate_series(1, 200) AS n"
        ),
        {"etid": str(await _first_section_id(db_session, template_id))},
    )

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    [guidance] = _items(body, "QUESTION_WITHOUT_AI_GUIDANCE")
    assert guidance["tree"] == "draft"
    assert "and 195 more" in guidance["message"]
    assert len(guidance["message"]) <= 500


def test_readiness_codes_cover_every_lint_code():
    assert set(get_args(LintCode)) <= set(get_args(ReadinessCode))


async def test_build_setup_readiness_service(db_session):
    project_id, template_id = await _fixture(db_session)

    manager = await build_setup_readiness(
        db_session, project_id=project_id, user_id=SEED.primary_profile, is_manager=True
    )
    reviewer = await build_setup_readiness(
        db_session, project_id=project_id, user_id=SEED.primary_profile, is_manager=False
    )

    assert manager.protocol_revision >= 0
    assert manager.summary.block == 2
    assert not manager.draft_detail_hidden
    assert reviewer.draft_detail_hidden
    assert [i.code for i in reviewer.items] == ["REVIEW_QUESTION_EMPTY"]
    assert reviewer.summary.ok is True
    assert manager.untrusted_fields == ["project_name", "items[].subject.name", "items[].message"]
    assert {i.subject.id for i in manager.items if i.subject} == {template_id}


# --- engine, reviewers, parser and article text (project-level items) -------


def _no_global_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(llm_connection_service, "global_key_for", lambda _p: None)


async def _clear_project(db: AsyncSession, project_id: UUID) -> None:
    """A fully configured fixture: the review question filled, the live tree
    clean (published as is)."""
    from app.services.template_versioning import TemplateVersionService

    await db.execute(
        text(
            "UPDATE public.projects SET picots_config_ai_review = CAST(:p AS jsonb) WHERE id = :pid"
        ),
        {
            "p": '{"population": {"description": "Adults with heart failure", '
            '"inclusion": [], "exclusion": []}}',
            "pid": str(project_id),
        },
    )
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND is_active"
            ),
            {"pid": str(project_id)},
        )
    ).scalar_one()
    await TemplateVersionService(db).republish(
        project_id=project_id, project_template_id=template_id, user_id=SEED.primary_profile
    )


async def test_fully_configured_seed_is_clear(mcp_client, pat_primary_rw, db_session, monkeypatch):
    _no_global_key(monkeypatch)
    project_id, _template_id, _schema = await fresh_charms(db_session)
    await db_session.execute(
        text("UPDATE public.projects SET review_type = 'prognostic' WHERE id = :pid"),
        {"pid": str(project_id)},
    )
    await _configure_engine(db_session, project_id)
    await _parse_every_article(db_session, project_id)
    await _clear_project(db_session, project_id)

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    assert body["items"] == []
    assert body["summary"] == {"block": 0, "warn": 0, "ok": True}
    assert body["items_truncated"] is False


async def test_revoked_byok_reports_no_credential(
    mcp_client, pat_primary_rw, db_session, monkeypatch
):
    _no_global_key(monkeypatch)
    project_id, _template_id = await _fixture(db_session)
    connection_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.llm_connections WHERE scope = 'user' "
                "AND user_id = :uid AND label = 'readiness user key'"
            ),
            {"uid": str(SEED.primary_profile)},
        )
    ).scalar_one()
    await LlmConnectionService(db_session).delete_user(
        user_id=SEED.primary_profile, connection_id=connection_id
    )

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    [missing] = _items(body, "ENGINE_NO_CREDENTIAL")
    assert missing["status"] == "block"
    assert missing["subject"] is None
    assert missing["next_step"] == settings_url(project_id)
    assert "ENGINE_RETIRED" not in _codes(body)


async def test_retired_engine_reports_retired(mcp_client, pat_primary_rw, db_session):
    project_id, _template_id = await _fixture(db_session)
    await db_session.execute(
        text(
            "UPDATE public.projects SET settings = COALESCE(settings, '{}'::jsonb) "
            '|| CAST(\'{"llm_engine": {"provider": "openai", "model": "gpt-long-gone"}}\' '
            "AS jsonb) WHERE id = :pid"
        ),
        {"pid": str(project_id)},
    )

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    [retired] = _items(body, "ENGINE_RETIRED")
    assert retired["status"] == "block"
    assert retired["next_step"] == settings_url(project_id)
    assert "gpt-long-gone" in retired["message"]
    assert "ENGINE_NO_CREDENTIAL" not in _codes(body)


async def test_reviewers_short(mcp_client, pat_primary_rw, db_session):
    project_id, _template_id = await _fixture(db_session)
    body = await _readiness(mcp_client, pat_primary_rw, project_id)
    assert "HITL_REVIEWERS_SHORT" not in _codes(body)  # default needs 1, the manager counts

    await HitlConfigService(db_session).upsert_for_project(
        project_id, reviewer_count=3, consensus_rule="unanimous", arbitrator_id=None
    )
    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    [short] = _items(body, "HITL_REVIEWERS_SHORT")
    assert short["status"] == "warn"
    assert "3" in short["message"] and "1" in short["message"]


async def test_articles_without_text(mcp_client, pat_primary_rw, db_session):
    project_id, _template_id = await _fixture(db_session)
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (gen_random_uuid(), :pid, 'Readiness unparsed article', 1)"
        ),
        {"pid": str(project_id)},
    )
    total = (
        await db_session.execute(
            text("SELECT count(*) FROM public.articles WHERE project_id = :pid"),
            {"pid": str(project_id)},
        )
    ).scalar_one()

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    [missing] = _items(body, "ARTICLES_WITHOUT_TEXT")
    assert missing["status"] == "warn"
    assert f"{total - 1} of {total}" in missing["message"]


async def test_parser_key_missing(mcp_client, pat_primary_rw, db_session, monkeypatch):
    _no_global_key(monkeypatch)
    project_id, _template_id = await _fixture(db_session)
    body = await _readiness(mcp_client, pat_primary_rw, project_id)
    assert "PARSER_KEY_MISSING" not in _codes(body)  # parser is not llamaparse yet

    await ParserSettingsService(db_session).set_for_project(
        project_id=project_id, parser_type="llamaparse"
    )
    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    [missing] = _items(body, "PARSER_KEY_MISSING")
    assert missing["status"] == "warn"
    assert missing["next_step"] == settings_url(project_id)


async def test_parser_key_check_never_decrypts_or_writes(db_session, monkeypatch):
    _no_global_key(monkeypatch)
    project_id, _template_id = await _fixture(db_session)
    await ParserSettingsService(db_session).set_for_project(
        project_id=project_id, parser_type="llamaparse"
    )
    read = await LlmConnectionService(db_session).create_project(
        project_id=project_id,
        created_by=SEED.primary_profile,
        payload=ProjectConnectionCreateRequest(
            provider="llama_cloud", label="readiness parser key", api_key=SecretStr("llx-test")
        ),
    )
    await db_session.commit()

    def _boom(*_a: object, **_k: object) -> None:
        raise AssertionError("readiness must not decrypt")

    monkeypatch.setattr(LlmConnectionService, "decrypt_key", _boom)

    result = await build_setup_readiness(
        db_session, project_id=project_id, user_id=SEED.primary_profile, is_manager=True
    )

    assert "PARSER_KEY_MISSING" not in {i.code for i in result.items}
    assert not db_session.dirty
    assert not db_session.new
    last_used = (
        await db_session.execute(
            text("SELECT last_used_at FROM public.llm_connections WHERE id = :cid"),
            {"cid": str(read.id)},
        )
    ).scalar_one()
    assert last_used is None


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (EngineRetiredError("The engine openai:gone is no longer available."), "ENGINE_RETIRED"),
        (MissingCredentialError("openai"), "ENGINE_NO_CREDENTIAL"),
        (ConnectionUnavailableError("The connection is gone."), "ENGINE_NO_CREDENTIAL"),
    ],
    ids=["retired", "missing-credential", "connection-unavailable"],
)
async def test_engine_errors_map_to_items(db_session, monkeypatch, error, code):
    project_id, _template_id = await _fixture(db_session)

    async def _raise(*_a: object, **_k: object) -> None:
        raise error

    monkeypatch.setattr(project_setup_readiness, "assert_engine_ready", _raise)

    result = await build_setup_readiness(
        db_session, project_id=project_id, user_id=SEED.primary_profile, is_manager=True
    )

    engine_items = [i for i in result.items if i.code.startswith("ENGINE_")]
    assert [(i.code, i.status) for i in engine_items] == [(code, "block")]
    assert engine_items[0].next_step == settings_url(project_id)


async def test_result_is_capped_on_many_active_templates(
    mcp_client, pat_primary_rw, db_session, monkeypatch
):
    _no_global_key(monkeypatch)
    project_id, template_id = await _fixture(db_session)
    await ParserSettingsService(db_session).set_for_project(
        project_id=project_id, parser_type="llamaparse"
    )
    await db_session.execute(
        text(
            "INSERT INTO public.project_extraction_templates "
            "(id, project_id, name, framework, version, kind, schema, is_active, created_by) "
            "SELECT gen_random_uuid(), :pid, 'Unpublished ' || n || ' ' || repeat('n', 70), "
            " 'CUSTOM', '1.0', 'quality_assessment', '{}'::jsonb, true, :uid "
            "FROM generate_series(1, 150) AS n"
        ),
        {"pid": str(project_id), "uid": str(SEED.primary_profile)},
    )

    body = await _readiness(mcp_client, pat_primary_rw, project_id)

    assert body["items_truncated"] is True
    # Project-level items survive the trim; the summary counts every item.
    assert {"REVIEW_QUESTION_EMPTY", "PARSER_KEY_MISSING"} <= _codes(body)
    assert body["summary"]["block"] >= 150 + 2
    assert len(body["items"]) < body["summary"]["block"] + body["summary"]["warn"]
    # The extraction template's items come before the QA ones that were trimmed.
    assert any((i["subject"] or {}).get("id") == str(template_id) for i in body["items"])
