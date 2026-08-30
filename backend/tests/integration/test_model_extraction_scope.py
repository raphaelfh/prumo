"""BOLA: /extraction/models binds its request coordinate like its sibling.

``POST /api/v1/extraction/models`` checked project membership and nothing
else. ``runId`` went straight to ``ModelExtractionService``, whose ``run_id``
branch reads the run and checks only its STAGE — so a foreign run in stage
``extract`` skipped ``create_run`` entirely, the one place article↔project and
template↔project are bound.

That is worse than the section endpoint's hole was: it yields a cross-tenant
READ (another project's article text goes to the LLM and derived model names
come back in the 200 body) and a cross-tenant ``ExtractionInstance`` WRITE.
The 0023 coherence trigger does not cover ``extraction_instances``.

Both kickoff endpoints now share ``assert_kickoff_scope``, so this suite and
``test_section_extraction_scope.py`` are asserting one implementation.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import model_extraction as me
from tests.integration.conftest import SEED, first_entity_type_id
from tests.integration.helpers import engine_setup
from tests.integration.helpers.template_fixtures import ARTICLE_ID as FIXTURE_ARTICLE_ID
from tests.integration.helpers.template_fixtures import fresh_charms

client_as_manager = engine_setup.client_as_manager
client_as_reviewer = engine_setup.client_as_reviewer
client_as_outsider = engine_setup.client_as_outsider

_URL = "/api/v1/extraction/models"


def _payload(**over: str) -> dict:
    return {
        "projectId": str(SEED.primary_project),
        "articleId": str(SEED.primary_article),
        "templateId": str(SEED.primary_template),
        **over,
    }


def _stub_service(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Stub the service seam only — the scope gate must run for real.

    A rejected request must never reach it; no LLM or PDF is involved.
    """
    service = MagicMock(extract_models=AsyncMock())
    monkeypatch.setattr(me, "ModelExtractionService", MagicMock(return_value=service))
    return service


async def _foreign_run(db: AsyncSession):
    """A run in EXTRACT belonging to ANOTHER project's article + template."""
    project_id, template_id, _ = await fresh_charms(db)
    return await engine_setup.run_in_extract_at(
        db,
        project_id=project_id,
        article_id=FIXTURE_ARTICLE_ID,
        template_id=template_id,
    )


@pytest.mark.asyncio
async def test_foreign_run_id_is_rejected(
    client_as_reviewer: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The cross-tenant case: a run in a project the caller has no part in.

    The reviewer profile belongs to the primary project only, so a 403 here
    is a real tenant boundary.
    """
    service = _stub_service(monkeypatch)
    foreign_run = await _foreign_run(db_session)

    r = await client_as_reviewer.post(_URL, json=_payload(runId=str(foreign_run.id)))

    service.extract_models.assert_not_called()
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_run_id_must_match_the_body_coordinate(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A caller who IS a member of both projects still cannot mix coordinates."""
    service = _stub_service(monkeypatch)
    foreign_run = await _foreign_run(db_session)

    r = await client_as_manager.post(_URL, json=_payload(runId=str(foreign_run.id)))

    assert r.status_code == 400, r.text
    assert r.json()["error"]["message"] == (
        "runId does not match projectId, articleId, and templateId"
    )
    service.extract_models.assert_not_called()


@pytest.mark.asyncio
async def test_unknown_run_id_is_404(
    client_as_manager: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _stub_service(monkeypatch)

    r = await client_as_manager.post(_URL, json=_payload(runId=str(uuid4())))

    service.extract_models.assert_not_called()
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_foreign_template_is_rejected_on_the_no_run_branch(
    client_as_reviewer: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same template↔project binding the section endpoint gained."""
    service = _stub_service(monkeypatch)
    _, foreign_template, _ = await fresh_charms(db_session)
    await first_entity_type_id(db_session, foreign_template)

    r = await client_as_reviewer.post(_URL, json=_payload(templateId=str(foreign_template)))

    assert r.status_code == 400, r.text
    assert r.json()["error"]["message"] == "templateId does not belong to projectId"
    service.extract_models.assert_not_called()


@pytest.mark.asyncio
async def test_outsider_gets_403_before_the_coordinate_check(
    client_as_outsider: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _stub_service(monkeypatch)

    r = await client_as_outsider.post(_URL, json=_payload(templateId=str(UUID(int=0))))

    service.extract_models.assert_not_called()
    assert r.status_code == 403, r.text
