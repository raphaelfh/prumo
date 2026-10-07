"""The full pass reaches the entries of root repeating groups only — never a
singleton's instance — in template then entry order."""

from __future__ import annotations

import re
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from structlog.testing import capture_logs

from tests.fakes.recorded_llm import RecordedLlm
from tests.integration.conftest import SEED
from tests.integration.helpers.ai_extraction import (
    extraction,
    request,
    run_in_extract,
    seed_article_text,
)
from tests.integration.helpers.template_fixtures import fresh_charms


async def _entity_type(db: AsyncSession, template_id: UUID, *, cardinality: str) -> UUID:
    return (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid AND parent_entity_type_id IS NULL "
                "AND cardinality = :card ORDER BY sort_order LIMIT 1"
            ),
            {"tid": str(template_id), "card": cardinality},
        )
    ).scalar_one()


async def _instance(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
    template_id: UUID,
    entity_type_id: UUID,
    parent: UUID | None = None,
    sort_order: int = 0,
    label: str = "entry",
) -> UUID:
    instance_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances (id, project_id, article_id, template_id, "
            "entity_type_id, parent_instance_id, label, sort_order, metadata, created_by) "
            "VALUES (:id, :pid, :aid, :tid, :et, :parent, :label, :so, '{}'::jsonb, :by)"
        ),
        {
            "id": str(instance_id),
            "pid": str(project_id),
            "aid": str(article_id),
            "tid": str(template_id),
            "et": str(entity_type_id),
            "parent": str(parent) if parent else None,
            "so": sort_order,
            "label": label,
            "by": str(SEED.primary_profile),
        },
    )
    return instance_id


@pytest.mark.asyncio
async def test_the_full_pass_walks_root_entries_in_order(db_session: AsyncSession) -> None:
    project_id, template_id, _ = await fresh_charms(db_session)
    article_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) VALUES (:id, :pid, 'entries', 1)"
        ),
        {"id": str(article_id), "pid": str(project_id)},
    )
    group = await _entity_type(db_session, template_id, cardinality="many")
    singleton = await _entity_type(db_session, template_id, cardinality="one")
    # Inserted out of order: the walk follows sort_order, not insertion.
    beta = await _instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=group,
        sort_order=1,
        label="beta",
    )
    alpha = await _instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=group,
        sort_order=0,
        label="alpha",
    )
    await _instance(
        db_session,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=singleton,
    )

    run = await run_in_extract(
        db_session, project_id=project_id, article_id=article_id, template_id=template_id
    )
    await seed_article_text(db_session, project_id=project_id, article_id=article_id)
    fake = RecordedLlm()  # identifies no new entries: only the two above exist

    with capture_logs() as logs:
        await extraction(db_session, fake).run_from_request(
            request(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                run_id=run.id,
                extract_all_sections=True,
            )
        )

    # One per-entry batch per ROOT ENTRY — the singleton's instance is not one.
    batches = [e["parent_instance_id"] for e in logs if e["event"] == "batch_extraction_start"]
    assert batches == [str(alpha), str(beta)]

    # Every child-section call is scoped to the root entry it ran under.
    walked = []
    for call in fake.field_calls():
        within = re.search(r'^- Within: model "(?P<label>[^"]*)"', call.user_prompt, re.M)
        if within and (not walked or walked[-1] != within["label"]):
            walked.append(within["label"])
    assert walked == ["alpha", "beta"], "one batch per root entry, in entry order"
