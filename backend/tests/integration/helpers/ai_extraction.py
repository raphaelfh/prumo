"""Driving ``AiExtraction.run_from_request`` end to end against Postgres.

The model is the recorded fake (``tests/fakes/recorded_llm.py``); everything
else is real: the run gate, the pinned tree, the article text assembled from
seeded ``article_text_blocks`` (so evidence anchors resolve), the landing.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.schemas.extraction import SectionExtractionRequest
from app.services.ai_extraction import AiExtraction
from app.services.engine_credentials import EngineCredentials
from app.services.run_lifecycle_service import RunLifecycleService
from tests.fakes.recorded_llm import RecordedLlm
from tests.integration.conftest import SEED

#: Offline credentials: ``build_model`` constructs a client, the fake answers.
TEST_CREDENTIALS = EngineCredentials("sk-test", None, None, None, None)

_BBOX = {"x": 0.0, "y": 0.0, "width": 400.0, "height": 12.0}


def extraction(
    db: AsyncSession,
    llm: RecordedLlm,
    *,
    user_id: UUID = SEED.primary_profile,
    attempt_id: UUID | None = None,
    owns_transactions: bool = False,
    storage: Any = None,
) -> AiExtraction:
    """The real service with the model call faked."""
    return AiExtraction(
        db,
        str(user_id),
        storage,
        "ai-extraction-test",
        TEST_CREDENTIALS,
        attempt_id=attempt_id,
        owns_transactions=owns_transactions,
        llm=llm,
    )


def request(**overrides: Any) -> SectionExtractionRequest:
    """A request on the seeded coordinate."""
    return SectionExtractionRequest(
        **{
            "project_id": SEED.primary_project,
            "article_id": SEED.primary_article,
            "template_id": SEED.primary_template,
            **overrides,
        }
    )


async def run_in_extract(
    db: AsyncSession,
    *,
    project_id: UUID = SEED.primary_project,
    article_id: UUID = SEED.primary_article,
    template_id: UUID = SEED.primary_template,
) -> ExtractionRun:
    """A run on the coordinate, advanced to EXTRACT."""
    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=SEED.primary_profile,
    )
    run = await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=SEED.primary_profile
    )
    await db.flush()
    return run


async def seed_article_text(
    db: AsyncSession,
    *paragraphs: str,
    article_id: UUID = SEED.primary_article,
    project_id: UUID = SEED.primary_project,
) -> UUID:
    """Make ``paragraphs`` the article's latest PDF, parsed into text blocks.

    The prompt input is assembled from these blocks and evidence quotes anchor
    to them, so no storage or parser runs. Returns the file id.
    """
    file_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.article_files "
            "(id, project_id, article_id, file_type, storage_key, original_filename, "
            " extraction_status, created_at) "
            "VALUES (:id, :pid, :aid, 'application/pdf', :key, 'article.pdf', 'parsed', "
            " now() + interval '1 day')"
        ),
        {
            "id": file_id,
            "pid": project_id,
            "aid": article_id,
            "key": f"seed/{file_id}.pdf",
        },
    )
    offset = 0
    for index, paragraph in enumerate(paragraphs or ("An article.",)):
        await db.execute(
            text(
                "INSERT INTO public.article_text_blocks "
                "(id, article_file_id, page_number, block_index, text, char_start, char_end, "
                " bbox, block_type) "
                "VALUES (:id, :fid, 1, :idx, :text, :start, :end, CAST(:bbox AS jsonb), "
                " 'paragraph')"
            ),
            {
                "id": uuid4(),
                "fid": file_id,
                "idx": index,
                "text": paragraph,
                "start": offset,
                "end": offset + len(paragraph),
                "bbox": json.dumps(_BBOX),
            },
        )
        offset += len(paragraph) + 1
    await db.flush()
    return file_id
