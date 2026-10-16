"""Option parity between the two MCP readers: every select or multiselect
code `get_extractions` returns is one of the `{value, label}` options
`get_template` returns for that question, under the same label."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import select

from app.models.extraction import ExtractionEntityType
from app.models.extraction_versioning import TemplateKind
from app.models.extraction_workflow import ExtractionReviewerDecisionType
from app.seed_probast_ai import _PROBAST_AI_TEMPLATE_ID
from app.services.extraction_review_service import ExtractionReviewService
from app.services.instance_seeding import ensure_instances
from app.services.template_versioning import TemplateVersionService, clone_template
from tests.integration.conftest import CHARMS_GLOBAL_ID, SEED
from tests.integration.helpers.engine_setup import run_in_extract_at
from tests.integration.mcp.tool_calls import call_tool, structured

_CHOICE_TYPES = ("select", "multiselect")


async def _published_clone(db, global_template_id: UUID, kind: TemplateKind) -> UUID:
    clone = await clone_template(
        db,
        project_id=SEED.primary_project,
        global_template_id=global_template_id,
        user_id=SEED.primary_profile,
        kind=kind,
    )
    await TemplateVersionService(db).republish(
        project_id=SEED.primary_project,
        project_template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
    )
    return clone.project_template_id


async def _all_pages(mcp_client, pat, tool: str, args: dict[str, Any]) -> list[dict]:
    pages: list[dict] = []
    cursor: str | None = None
    while True:
        page_args = args if cursor is None else {**args, "cursor": cursor}
        body = structured(await call_tool(mcp_client, pat, tool, page_args))
        pages.append(body)
        cursor = body["next_cursor"]
        if cursor is None:
            return pages


@pytest.mark.parametrize(
    ("global_template_id", "kind"),
    [
        (CHARMS_GLOBAL_ID, TemplateKind.EXTRACTION),
        (_PROBAST_AI_TEMPLATE_ID, TemplateKind.QUALITY_ASSESSMENT),
    ],
    ids=["charms", "probast_ai"],
)
async def test_extraction_options_are_template_options(
    mcp_client, pat_primary_rw, db_session, global_template_id, kind
):
    template_id = await _published_clone(db_session, global_template_id, kind)
    args = {"project_id": str(SEED.primary_project), "template_id": str(template_id)}
    sections: dict[str, dict] = {}
    for page in await _all_pages(mcp_client, pat_primary_rw, "get_template", args):
        for section in page["sections"]:
            merged = sections.setdefault(section["section_id"], {**section, "questions": []})
            merged["questions"].extend(section["questions"])
    options_by_field = {
        q["field_id"]: {o["value"]: o["label"] for o in q["options"]}
        for s in sections.values()
        for q in s["questions"]
        if q["type"] in _CHOICE_TYPES
    }

    run = await run_in_extract_at(
        db_session,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        template_id=template_id,
    )
    entity_types = list(
        (
            await db_session.execute(
                select(ExtractionEntityType).where(
                    ExtractionEntityType.project_template_id == template_id
                )
            )
        ).scalars()
    )
    instance_by_section = await ensure_instances(
        db_session,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=template_id,
        entity_types=entity_types,
        user_id=SEED.primary_profile,
    )
    review = ExtractionReviewService(db_session)
    recorded = 0
    for section in sections.values():
        if section["parent_section_id"] is not None or section["cardinality"] != "one":
            continue
        for question in section["questions"]:
            if question["type"] not in _CHOICE_TYPES:
                continue
            codes = [o["value"] for o in question["options"]]
            value = codes[0] if question["type"] == "select" else codes[:2]
            await review.record_decision(
                run_id=run.id,
                instance_id=instance_by_section[UUID(section["section_id"])],
                field_id=UUID(question["field_id"]),
                reviewer_id=SEED.primary_profile,
                decision=ExtractionReviewerDecisionType.EDIT,
                value={"value": value},
            )
            recorded += 1
    await db_session.flush()
    assert recorded, "the template has no singleton select or multiselect question"

    for response_format in ("detailed", "concise"):
        pages = await _all_pages(
            mcp_client,
            pat_primary_rw,
            "get_extractions",
            {**args, "article_id": str(SEED.primary_article), "response_format": response_format},
        )
        returned = 0
        for value_field_id, value in _returned_values(pages):
            options = options_by_field.get(value_field_id)
            if options is None:
                continue
            codes = value["value"] if isinstance(value["value"], list) else [value["value"]]
            labels = value.get("label", codes)
            labels = labels if isinstance(labels, list) else [labels]
            for code, label in zip(codes, labels, strict=True):
                assert code in options, (response_format, value_field_id, code)
                assert label == options[code], (response_format, value_field_id, code, label)
            returned += 1
        assert returned == recorded, response_format


def _returned_values(pages: list[dict]) -> list[tuple[str, dict]]:
    """`(field_id, McpValue)` for every value on every page, either format."""
    out: list[tuple[str, dict]] = []
    for page in pages:
        for article in page["articles"]:
            out += [(row["field_id"], row["value"]) for row in article["rows"] or []]
            for value_field_id, cell in (article["values"] or {}).items():
                out += [(value_field_id, value) for value in cell["values"]]
    return out
