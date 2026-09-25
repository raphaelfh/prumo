"""edit_template_draft isolation (spec §8): a draft edit must stay invisible
to every reviewer/AI-facing read until a manager republishes."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.extractor import LlmUsage
from app.services.extraction_run_read_service import build_run_view
from app.services.section_extraction_service import SectionExtractionService
from app.services.template_version_service import TemplateVersionService
from tests.integration.conftest import SEED, open_session
from tests.integration.helpers.template_fixtures import ARTICLE_ID, fresh_charms
from tests.integration.mcp.tool_calls import call_tool, structured


def _top_level_section(schema: dict) -> dict:
    return next(
        et
        for et in schema["entity_types"]
        if et.get("parent_entity_type_id") is None and et.get("cardinality") == "one"
    )


async def test_draft_ops_stay_invisible_until_publish(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section = _top_level_section(schema)
    section_id = section["id"]
    field = section["fields"][0]
    field_id = field["id"]
    old_label = field["label"]
    old_description = (
        await db_session.execute(
            text("SELECT llm_description FROM public.extraction_fields WHERE id = :id"),
            {"id": field_id},
        )
    ).scalar_one()

    active_version_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active IS TRUE"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()

    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    instance_count_before = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_instances "
                "WHERE article_id = :a AND template_id = :t"
            ),
            {"a": str(ARTICLE_ID), "t": str(template_id)},
        )
    ).scalar_one()

    ops = [
        {
            "op": "add_question",
            "section_id": section_id,
            "label": "Isolation probe",
            "type": "text",
            "instructions": "NEW",
        },
        {
            "op": "update_question",
            "field_id": field_id,
            "label": "Reworded",
            "instructions": "REWORDED",
        },
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    body = structured(result)
    new_field_id = UUID(body["applied"][0]["field_id"])

    # 1. active version unchanged.
    active_after = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active IS TRUE"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()
    assert active_after == active_version_id

    # 2. re-opening the session materializes no new instances.
    await open_session(
        db_session,
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    instance_count_after = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_instances "
                "WHERE article_id = :a AND template_id = :t"
            ),
            {"a": str(ARTICLE_ID), "t": str(template_id)},
        )
    ).scalar_one()
    assert instance_count_after == instance_count_before

    # 3. build_run_view excludes the new field and keeps the old label.
    view = await build_run_view(
        db_session, session.run_id, caller_id=SEED.primary_profile, can_see_peers=True
    )
    rendered_section = next(et for et in view.entity_types if str(et.id) == section_id)
    rendered_field_ids = {f.id for f in rendered_section.fields}
    assert new_field_id not in rendered_field_ids
    rendered_field = next(f for f in rendered_section.fields if str(f.id) == field_id)
    assert rendered_field.label == old_label

    # 4. the extraction prompt path draws from the same frozen view.
    service = SectionExtractionService(
        db=db_session,
        user_id=str(SEED.primary_profile),
        storage=MagicMock(),
        trace_id="mcp-isolation",
    )
    service._assemble_prompt_text = AsyncMock(return_value="ARTICLE TEXT")  # type: ignore[method-assign]
    service._extract_with_llm = AsyncMock(return_value=({}, LlmUsage()))  # type: ignore[method-assign]
    await service.extract_section(
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        entity_type_id=UUID(section_id),
        run_id=session.run_id,
    )
    kwargs = service._extract_with_llm.call_args.kwargs
    sent_ids = {f.id for f in kwargs["fields_override"]}
    assert new_field_id not in sent_ids
    sent_field = next(f for f in kwargs["fields_override"] if str(f.id) == field_id)
    assert sent_field.label == old_label
    assert sent_field.llm_description == old_description

    # 5. the field's `name` never changes on a reword.
    row_name = (
        await db_session.execute(
            text("SELECT name FROM public.extraction_fields WHERE id = :id"), {"id": field_id}
        )
    ).scalar_one()
    assert row_name == field["name"]

    # Republish: now everything is visible.
    await TemplateVersionService(db_session).republish(
        project_id=project_id, project_template_id=template_id, user_id=SEED.primary_profile
    )
    view_after_publish = await build_run_view(
        db_session, session.run_id, caller_id=SEED.primary_profile, can_see_peers=True
    )
    published_section = next(
        et for et in view_after_publish.entity_types if str(et.id) == section_id
    )
    published_field_ids = {f.id for f in published_section.fields}
    assert new_field_id in published_field_ids
    published_field = next(f for f in published_section.fields if str(f.id) == field_id)
    assert published_field.label == "Reworded"
