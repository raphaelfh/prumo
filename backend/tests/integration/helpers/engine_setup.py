"""Shared setup for the per-project engine surface (C1b).

The engine suites all drive the same seeded coordinate through the same
pieces: an ASGI client bound to the test session, a fresh run at that
coordinate, a run-scoped pin, and a project engine choice. Shared rather
than copied — the endpoint gate, the model-extraction pin and the freeze
suite are supposed to describe ONE surface, and private copies of the
setup drift until they stop proving the same contract.

The ``get_supabase`` override is unconditional: endpoints that never ask
for the client are unaffected, and the ones that do must not reach a real
Supabase from the suite.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from unittest.mock import MagicMock
from uuid import UUID

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_supabase
from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.repositories import ExtractionRunRepository
from app.schemas.llm_endpoint import LlmEndpointCreateRequest
from app.schemas.llm_engine import LlmEngineAlternate, LlmEngineStored
from app.schemas.llm_target import LlmTarget
from app.services.llm_endpoint_service import LlmEndpointService
from app.services.llm_engine_service import LlmEngineService
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED


def client_as(profile_id: str, db_session: AsyncSession) -> AsyncClient:
    """An ASGI client authenticated as ``profile_id``, on the test session."""

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=profile_id,
            email=f"{profile_id}@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

    def override_get_supabase() -> MagicMock:
        return MagicMock()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_supabase] = override_get_supabase
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest_asyncio.fixture
async def client_as_manager(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    try:
        async with client_as(str(SEED.primary_profile), db_session) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client_as_reviewer(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    try:
        async with client_as(str(SEED.reviewer_profile), db_session) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client_as_outsider(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    try:
        async with client_as(str(SEED.outsider_profile), db_session) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


async def run_in_extract(db: AsyncSession) -> ExtractionRun:
    """A fresh run at the seeded coordinate, advanced to EXTRACT.

    The coordinate is cleared first: one live run per coordinate is a DB
    invariant (partial unique index), so a leftover from an earlier test
    would break the create instead of failing the assertion under test.
    """
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


async def pin_run(
    db: AsyncSession, run: ExtractionRun, provider: str, model: str, mode: str = "fast"
) -> None:
    """Pre-pin the run the way a prior attempt's freeze write would have.

    ``mode`` fills both frozen mode fields (the freeze is a request-echo;
    execution truth lives on the section snapshot, never here).
    """
    await ExtractionRunRepository(db).freeze_engine(
        run.id,
        LlmTarget(
            provider=provider, model=model, mode_requested=mode, mode_executed=mode
        ).model_dump(),
    )


async def set_project_engine(
    db: AsyncSession,
    provider: str,
    model: str,
    mode: str = "fast",
    alternates: list[LlmEngineAlternate] | None = None,
    endpoint_id: UUID | None = None,
) -> LlmEngineStored:
    """The seeded project's engine choice, written by the primary manager."""
    return await LlmEngineService(db).set_for_project(
        project_id=SEED.primary_project,
        provider=provider,
        model=model,
        mode=mode,  # type: ignore[arg-type]
        updated_by=SEED.primary_profile,
        alternates=alternates,
        endpoint_id=endpoint_id,
    )


async def make_endpoint(
    db: AsyncSession,
    *,
    project_id: UUID | None = None,
    label: str = "engine-suite-endpoint",
    allowed_models: list[str] | None = None,
    validation_status: str = "ok",
    output_mode: str | None = "tool",
) -> UUID:
    """A project endpoint in the given probe state, for endpoint-engine tests.

    Created through the real service (Fernet, SSRF-vetted literal public
    IP), then armed directly on the row — the B4 suite's
    ``_arm_probe_state`` approach: the probe itself is B5's contract, not
    this surface's.
    """
    service = LlmEndpointService(db)
    read = await service.create(
        project_id=project_id or SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=LlmEndpointCreateRequest(
            label=label,
            base_url="https://8.8.8.8/v1",
            api_key=SecretStr("sk-engine-suite"),
            allowed_models=allowed_models if allowed_models is not None else ["endpoint-model-x"],
        ),
    )
    row = await service.get(project_id or SEED.primary_project, read.id)
    row.validation_status = validation_status
    row.capabilities = {"output_mode": output_mode, "models_seen": []}
    await db.flush()
    return read.id
