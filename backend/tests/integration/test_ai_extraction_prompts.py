"""What the model is asked: prompt pair by run kind, the instrument's name,
run-constant blocks, chunking, and the template's assessor-owned exclusions.

Driven through ``AiExtraction.run_from_request``; the recorded model fake
keeps every prompt and the output schema each call carried.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.prompts import quality_assessment, section_extraction
from app.models.extraction import ExtractionRun
from app.services.template_versioning import TemplateVersionService
from tests.fakes.recorded_llm import RecordedLlm
from tests.integration.conftest import SEED
from tests.integration.helpers.ai_extraction import (
    extraction,
    request,
    run_in_extract,
    seed_article_text,
)
from tests.integration.helpers.template_fixtures import add_field, add_section

pytestmark = pytest.mark.asyncio


async def _section(db: AsyncSession, name: str, *fields: str, publish: bool = True) -> UUID:
    section = await add_section(db, SEED.primary_template, name)
    for field in fields:
        await add_field(db, section, field)
    if publish:
        await TemplateVersionService(db).republish(
            project_id=SEED.primary_project,
            project_template_id=SEED.primary_template,
            user_id=SEED.primary_profile,
        )
    return section


async def _template(db: AsyncSession, *, schema: Any = None, **columns: Any) -> None:
    sets = {**columns, **({"schema": json.dumps(schema)} if schema is not None else {})}
    assignments = ", ".join(
        f"{c} = CAST(:{c} AS jsonb)" if c == "schema" else f"{c} = :{c}" for c in sets
    )
    await db.execute(
        text(f"UPDATE project_extraction_templates SET {assignments} WHERE id = :id"),  # noqa: S608
        {**sets, "id": SEED.primary_template},
    )


async def _ask(
    db: AsyncSession, run: ExtractionRun, fake: RecordedLlm | None = None, **shape: Any
) -> RecordedLlm:
    fake = fake or RecordedLlm()
    await seed_article_text(db, "ARTICLE BODY")
    await extraction(db, fake).run_from_request(request(run_id=run.id, **shape))
    return fake


# --------------------------------------------------------------------------
# The prompt pair follows the run kind
# --------------------------------------------------------------------------


async def test_an_extraction_run_asks_the_extraction_prompt(db_session: AsyncSession) -> None:
    run = await run_in_extract(db_session)

    fake = await _ask(db_session, run, entity_type_id=SEED.primary_entity_type)

    (call,) = fake.field_calls()
    assert call.prompt_name == section_extraction.NAME
    assert "extracting structured data" in call.system_prompt
    assert "Section: participants" in call.user_prompt
    assert "ARTICLE BODY" in call.user_prompt


@pytest.mark.parametrize(
    ("name", "framework", "named"),
    [("PROBAST+AI", "CUSTOM", "PROBAST+AI"), ("   ", "CHARMS", "CHARMS")],
    ids=["template-name", "blank-name-falls-back-to-framework"],
)
async def test_a_quality_assessment_run_names_its_instrument(
    db_session: AsyncSession, name: str, framework: str, named: str
) -> None:
    """Every QA template is ``framework='CUSTOM'``: interpolating the enum
    produced "assessing a study using CUSTOM". The template's NAME wins."""
    await _template(db_session, kind="quality_assessment", name=name, framework=framework)
    run = await run_in_extract(db_session)
    assert run.kind == "quality_assessment"

    fake = await _ask(db_session, run)

    (call,) = fake.field_calls()
    assert call.prompt_name == quality_assessment.NAME
    assert named in call.system_prompt
    assert named in call.user_prompt
    assert "using CUSTOM" not in call.system_prompt


async def test_both_run_constant_blocks_lead_the_prompt_in_order(
    db_session: AsyncSession,
) -> None:
    """The review question frames the task; the template's general
    instruction is the more specific guidance, so it sits closest to it."""
    await db_session.execute(
        text(
            "UPDATE projects SET review_type = 'predictive_model', "
            "picots_config_ai_review = CAST(:p AS jsonb) WHERE id = :id"
        ),
        {
            "p": json.dumps(
                {"population": {"description": "Adults", "inclusion": [], "exclusion": []}}
            ),
            "id": SEED.primary_project,
        },
    )
    await _template(db_session, llm_template_instruction="BE CONCISE")
    await TemplateVersionService(db_session).republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    run = await run_in_extract(db_session)

    fake = await _ask(db_session, run, entity_type_id=SEED.primary_entity_type)

    prompt = fake.field_calls()[0].user_prompt
    assert prompt.startswith("Review question and scope:\n- Population: Adults\n\n")
    assert prompt.index("Review question") < prompt.index("BE CONCISE") < prompt.index("Section:")


async def test_an_oversized_section_is_split_across_calls_and_merged(
    db_session: AsyncSession,
) -> None:
    names = [f"f{i:02d}" for i in range(30)]
    section = await _section(db_session, "wide_section", *names)
    run = await run_in_extract(db_session)
    fake = RecordedLlm(fields={name: {"value": name.upper()} for name in names})

    await _ask(db_session, run, fake, entity_type_id=section)

    calls = fake.field_calls()
    assert len(calls) >= 2, "an OpenAI strict schema caps the properties per call"
    assert sorted(n for c in calls for n in c.field_names) == names
    landed = (
        await db_session.execute(
            text("SELECT count(*) FROM extraction_proposal_records WHERE run_id = :r"),
            {"r": run.id},
        )
    ).scalar_one()
    assert landed == 30
    await db_session.refresh(run)
    tokens = run.results["provenance"]["sections"][str(section)]["tokens"]
    assert tokens["total"] == 15 * len(calls), "usage summed across the chunks"


# --------------------------------------------------------------------------
# Assessor-owned coordinates never reach the model
# --------------------------------------------------------------------------

_SPEC = {
    "derived_judgments": [
        {
            "id": "dev_d1_quality",
            "label": "Development D1: quality",
            "rule": "signaling_worst",
            "target": {"section": "dev_d1_participants", "field": "quality_concern"},
            "rationale": {"section": "dev_d1_participants", "field": "quality_concern_rationale"},
            "inputs": [{"section": "dev_d1_participants", "field": "q1"}],
        },
        {
            "id": "overall",
            "label": "Overall",
            "rule": "signaling_worst",
            "target": {"section": "overall_judgement", "field": "summary_quality"},
            "inputs": [],
        },
    ]
}


async def test_the_spec_named_judgments_are_subtracted_on_every_path(
    db_session: AsyncSession,
) -> None:
    """Exactly the spec's target + rationale drop (anti-over-exclusion: the
    signaling questions and descriptions stay), on the top-level sweep; an
    all-summary section spends no call at all."""
    await _section(
        db_session,
        "dev_d1_participants",
        "desc_data_sources",
        "q1",
        "quality_concern",
        "quality_concern_rationale",
    )
    await _section(db_session, "overall_judgement", "summary_quality")
    await _template(db_session, schema=_SPEC)
    run = await run_in_extract(db_session)

    fake = await _ask(db_session, run)

    asked = {
        call.user_prompt.split("Section: ")[1].split("\n")[0]: call.field_names
        for call in fake.field_calls()
    }
    assert asked["dev_d1_participants"] == ["desc_data_sources", "q1"]
    assert "overall_judgement" not in asked


async def test_the_live_fallback_path_is_filtered_too(db_session: AsyncSession) -> None:
    """A section outside the run's pin (the re-pin race) is read live and sent
    without a pinned field list — the leak a call-site filter cannot cover."""
    await _template(db_session, schema=_SPEC)
    run = await run_in_extract(db_session)
    section = await _section(
        db_session, "dev_d1_participants", "q1", "quality_concern", publish=False
    )

    fake = await _ask(db_session, run, entity_type_id=section)

    assert [c.field_names for c in fake.field_calls()] == [["q1"]]


async def test_a_stale_exclusion_filters_nothing(db_session: AsyncSession) -> None:
    """A spec pointer no live field answers to (a rename) fails OPEN: nothing
    is dropped, and the dangling reference is logged, never silently honoured."""
    section = await _section(db_session, "dev_d1_participants", "q1", "quality_score")
    await _template(db_session, schema=_SPEC)
    run = await run_in_extract(db_session)

    fake = await _ask(db_session, run, entity_type_id=section)

    assert [c.field_names for c in fake.field_calls()] == [["q1", "quality_score"]]


async def test_a_study_type_classification_never_narrows_the_ask(
    db_session: AsyncSession,
) -> None:
    """Scope rules decide what a value COUNTS for (form, derived judgments,
    export) — never what the model is asked: a section the rules exclude for
    the stored study type is still asked in full."""
    classifier = await _section(db_session, "assessment_scope", "study_type")
    evaluation = await _section(db_session, "eval_d1_participants", "risk_of_bias")
    await _template(
        db_session,
        schema={
            "scope_rules": {
                "classifier": {"section": "assessment_scope", "field": "study_type"},
                "excludes": {"development_only": ["eval_d1_participants"]},
            }
        },
    )
    run = await run_in_extract(db_session)
    await _ask(
        db_session,
        run,
        RecordedLlm(fields={"study_type": {"value": "development_only"}}),
        entity_type_id=classifier,
    )

    fake = await _ask(db_session, run, entity_type_id=evaluation)

    assert [c.field_names for c in fake.field_calls()] == [["risk_of_bias"]]
