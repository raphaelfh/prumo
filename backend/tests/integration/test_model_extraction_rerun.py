"""Re-running AI model extraction must not fork the entity.

The reported bug: run 1 identifies a model and names it "XGBoost", run 2
identifies the same model and names it "Gradient Boosting", and the two
half-filled instances never meet in consensus. Reviewers never disagreed —
the machine forked the entity twice.

These tests drive ``_create_model_instances`` against a real database.
Only the run-pinned tree lookup is patched, because a version snapshot is
orthogonal to the behaviour under test.
"""

from __future__ import annotations

import json
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.extractor import LlmUsage
from app.services.entity_key import MissingEntityKeyError
from app.services.model_extraction_service import ModelExtractionService
from tests.integration.conftest import SEED

pytestmark = pytest.mark.asyncio


async def _model_container(db: AsyncSession, *, with_key: bool) -> UUID:
    """A model container under the seeded template, optionally keyed."""
    entity_type_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, sort_order, entry_label) "
            "VALUES (:id, :tpl, :name, 'Prediction Models', 'many', 'model_container', 95, 'model')"
        ),
        {
            "id": entity_type_id,
            "tpl": SEED.primary_template,
            "name": f"rerun_models_{entity_type_id.hex[:8]}",
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, sort_order, is_entity_key) "
            "VALUES (:id, :et, 'model_name', 'Model Name', 'text', 0, :key)"
        ),
        {"id": uuid4(), "et": entity_type_id, "key": with_key},
    )
    await db.flush()
    return entity_type_id


def _service(db: AsyncSession) -> ModelExtractionService:
    return ModelExtractionService(
        db=db, user_id=str(SEED.primary_profile), storage=MagicMock(), trace_id="rerun-probe"
    )


async def _count(db: AsyncSession, entity_type_id: UUID) -> int:
    return (
        await db.execute(
            text(
                "SELECT count(*) FROM public.extraction_instances "
                "WHERE article_id = :art AND entity_type_id = :et"
            ),
            {"art": SEED.primary_article, "et": entity_type_id},
        )
    ).scalar_one()


async def _run_extraction(
    service: ModelExtractionService, entity_type_id: UUID, names: list[str]
) -> list:
    run = SimpleNamespace(id=uuid4(), version_id=uuid4(), template_id=SEED.primary_template)
    with (
        patch(
            "app.services.model_extraction_service.entity_types_for_version",
            AsyncMock(return_value=[]),
        ),
        patch.object(
            ModelExtractionService,
            "_get_model_container_entity_type_id",
            AsyncMock(return_value=str(entity_type_id)),
        ),
    ):
        created, _ = await service._create_model_instances(
            project_id=SEED.primary_project,
            article_id=SEED.primary_article,
            template_id=SEED.primary_template,
            models=[{"name": n} for n in names],
            run=run,
        )
    return created


async def test_a_second_run_reuses_the_instance_it_already_created(
    db_session: AsyncSession,
) -> None:
    """THE regression. Without the fix this creates two instances."""
    entity_type_id = await _model_container(db_session, with_key=True)
    service = _service(db_session)

    first = await _run_extraction(service, entity_type_id, ["XGBoost"])
    second = await _run_extraction(service, entity_type_id, ["XGBoost"])

    assert await _count(db_session, entity_type_id) == 1, "the re-run forked the entity"
    assert second[0].id == first[0].id


async def test_a_rerun_matches_regardless_of_case_and_spacing(
    db_session: AsyncSession,
) -> None:
    entity_type_id = await _model_container(db_session, with_key=True)
    service = _service(db_session)

    await _run_extraction(service, entity_type_id, ["XGBoost"])
    await _run_extraction(service, entity_type_id, ["  xgboost "])

    assert await _count(db_session, entity_type_id) == 1


async def test_a_genuinely_new_model_is_still_created(db_session: AsyncSession) -> None:
    """Reuse must not become 'never create'."""
    entity_type_id = await _model_container(db_session, with_key=True)
    service = _service(db_session)

    await _run_extraction(service, entity_type_id, ["XGBoost"])
    await _run_extraction(service, entity_type_id, ["XGBoost", "LightGBM"])

    assert await _count(db_session, entity_type_id) == 2


async def test_the_identity_is_materialized_on_the_instance(
    db_session: AsyncSession,
) -> None:
    """Matching reads this, never a reviewer-scoped field value."""
    entity_type_id = await _model_container(db_session, with_key=True)
    await _run_extraction(_service(db_session), entity_type_id, ["XGBoost"])
    stored = (
        await db_session.execute(
            text(
                "SELECT metadata FROM public.extraction_instances "
                "WHERE article_id = :art AND entity_type_id = :et"
            ),
            {"art": SEED.primary_article, "et": entity_type_id},
        )
    ).scalar_one()
    metadata = stored if isinstance(stored, dict) else json.loads(stored)
    assert metadata["entity_key"] == "xgboost"


def _kickoff_patches(entity_type_id: UUID) -> list:
    """Drive ``extract`` for real up to identification: the article text
    comes from a stub instead of storage, the pinned tree is empty so the
    container resolves to the live row under test."""
    return [
        patch(
            "app.services.model_extraction_service.build_prompt_input",
            AsyncMock(return_value=("Model A is a logistic regression.", None)),
        ),
        patch(
            "app.services.model_extraction_service.entity_types_for_version",
            AsyncMock(return_value=[]),
        ),
        patch.object(
            ModelExtractionService,
            "_get_model_container_entity_type_id",
            AsyncMock(return_value=str(entity_type_id)),
        ),
    ]


async def _kickoff(service: ModelExtractionService) -> None:
    await service.extract(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        template_id=SEED.primary_template,
    )


async def _run_count(db: AsyncSession) -> int:
    return (
        await db.execute(
            text("SELECT count(*) FROM public.extraction_runs WHERE article_id = :art"),
            {"art": SEED.primary_article},
        )
    ).scalar_one()


async def test_a_kickoff_flushes_its_run_row_before_identifying(
    db_session: AsyncSession,
) -> None:
    """Positive control for the refusal test below: on a fresh coordinate the
    real kickoff creates and flushes the run before identification, so a run
    row is what a refusal has to leave behind — or not."""
    entity_type_id = await _model_container(db_session, with_key=True)
    assert await _run_count(db_session) == 0
    with ExitStack() as stack:
        for p in _kickoff_patches(entity_type_id):
            stack.enter_context(p)
        stack.enter_context(
            patch.object(
                ModelExtractionService,
                "_identify_models",
                AsyncMock(return_value=([{"name": "XGBoost"}], LlmUsage())),
            )
        )
        await _kickoff(_service(db_session))
    assert await _run_count(db_session) == 1


async def test_an_unkeyed_container_is_refused_not_duplicated(
    db_session: AsyncSession,
) -> None:
    """A keyless container refuses before any write or LLM call, and no run
    row survives the refusal: the service rolls back and fails the run it
    resolved on the way, and the models route answers the typed 409 with
    ``rollback; raise`` on top — mirrored here after the raise."""
    entity_type_id = await _model_container(db_session, with_key=False)
    assert await _run_count(db_session) == 0
    with ExitStack() as stack:
        for p in _kickoff_patches(entity_type_id):
            stack.enter_context(p)
        with pytest.raises(MissingEntityKeyError):
            await _kickoff(_service(db_session))
    assert await _count(db_session, entity_type_id) == 0
    assert await _run_count(db_session) == 0, "the service's rollback_and_fail left a run row"
    await db_session.rollback()
    assert await _run_count(db_session) == 0
