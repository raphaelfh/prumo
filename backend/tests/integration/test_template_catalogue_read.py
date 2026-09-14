"""HTTP reads of the template catalogue: the global catalogue offered for
import and a project's own templates. These replace the browser's direct
PostgREST reads of ``extraction_templates_global`` and
``project_extraction_templates`` (constitution §VI). ``db_client`` shares
``db_session``, so rows created here are visible without a commit."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.main import app
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionTemplateGlobal,
    TemplateKind,
)
from tests.integration.conftest import SEED
from tests.integration.helpers import template_fixtures

auth_as_reviewer = template_fixtures.auth_as_reviewer

GLOBAL_CATALOGUE = "/api/v1/templates/global"
PROJECT_TEMPLATES = "/api/v1/projects/{pid}/templates"


@pytest_asyncio.fixture
async def auth_as_outsider(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    """JWT sub = a profile with no project membership."""
    del db_session  # fixture ordering only: the seed must run first
    async for user_id in template_fixtures.authenticated_as(SEED.outsider_profile, "o@example.com"):
        yield user_id


async def _global_template(
    db: AsyncSession, *, name: str, kind: TemplateKind, sections: int, is_global: bool = True
) -> UUID:
    template = ExtractionTemplateGlobal(
        name=name, framework="CUSTOM", version="1.0.0", kind=kind.value, is_global=is_global
    )
    db.add(template)
    await db.flush()
    for order in range(sections):
        db.add(
            ExtractionEntityType(
                template_id=template.id,
                name=f"section_{order}",
                label=f"Section {order}",
                cardinality="one",
                sort_order=order,
            )
        )
    await db.flush()
    return template.id


@pytest.mark.asyncio
async def test_global_catalogue_lists_only_the_requested_kind_with_section_counts(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_reviewer: UUID
) -> None:
    del auth_as_reviewer  # consumed for its dependency-override side effect
    qa_id = await _global_template(
        db_session, name="Catalogue QA probe", kind=TemplateKind.QUALITY_ASSESSMENT, sections=2
    )
    extraction_id = await _global_template(
        db_session, name="Catalogue extraction probe", kind=TemplateKind.EXTRACTION, sections=1
    )

    r = await db_client.get(GLOBAL_CATALOGUE, params={"kind": "quality_assessment"})

    assert r.status_code == 200, r.text
    rows = r.json()["data"]
    by_id = {row["id"]: row for row in rows}
    assert str(qa_id) in by_id
    assert by_id[str(qa_id)]["entity_types_count"] == 2
    assert by_id[str(qa_id)]["name"] == "Catalogue QA probe"
    assert str(extraction_id) not in by_id
    assert {row["kind"] for row in rows} == {"quality_assessment"}
    assert "schema" not in by_id[str(qa_id)]


@pytest.mark.asyncio
async def test_global_catalogue_hides_retired_templates(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_reviewer: UUID
) -> None:
    del auth_as_reviewer  # consumed for its dependency-override side effect
    retired_id = await _global_template(
        db_session,
        name="Retired QA probe",
        kind=TemplateKind.QUALITY_ASSESSMENT,
        sections=1,
        is_global=False,
    )

    r = await db_client.get(GLOBAL_CATALOGUE, params={"kind": "quality_assessment"})

    assert r.status_code == 200, r.text
    assert str(retired_id) not in {row["id"] for row in r.json()["data"]}


@pytest.mark.asyncio
@pytest.mark.parametrize("params", [{}, {"kind": "bogus"}], ids=["missing-kind", "unknown-kind"])
async def test_global_catalogue_requires_a_valid_kind(
    db_client: AsyncClient, auth_as_reviewer: UUID, params: dict[str, str]
) -> None:
    del auth_as_reviewer  # consumed for its dependency-override side effect
    r = await db_client.get(GLOBAL_CATALOGUE, params=params)
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_global_catalogue_requires_authentication(db_client: AsyncClient) -> None:
    # db_client authenticates every request by default; drop that override so
    # the request carries no token (db_client clears overrides on teardown).
    assert app.dependency_overrides.pop(get_current_user, None) is not None
    r = await db_client.get(GLOBAL_CATALOGUE, params={"kind": "extraction"})
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_project_templates_lists_active_and_inactive_rows_of_the_project(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_reviewer: UUID
) -> None:
    del auth_as_reviewer  # consumed for its dependency-override side effect
    await db_session.execute(
        text("UPDATE public.project_extraction_templates SET is_active = false WHERE id = :tid"),
        {"tid": str(SEED.primary_template)},
    )

    r = await db_client.get(
        PROJECT_TEMPLATES.format(pid=SEED.primary_project), params={"kind": "extraction"}
    )

    assert r.status_code == 200, r.text
    rows = r.json()["data"]
    by_id = {row["id"]: row for row in rows}
    assert str(SEED.primary_template) in by_id, "the seeded template must be listed"
    seeded = by_id[str(SEED.primary_template)]
    assert seeded["is_active"] is False
    assert "schema" in seeded
    assert {row["project_id"] for row in rows} == {str(SEED.primary_project)}
    assert {row["kind"] for row in rows} == {"extraction"}


@pytest.mark.asyncio
async def test_project_templates_filters_by_kind(
    db_client: AsyncClient, auth_as_reviewer: UUID
) -> None:
    del auth_as_reviewer  # consumed for its dependency-override side effect
    r = await db_client.get(
        PROJECT_TEMPLATES.format(pid=SEED.primary_project), params={"kind": "quality_assessment"}
    )

    assert r.status_code == 200, r.text
    ids = {row["id"] for row in r.json()["data"]}
    assert str(SEED.primary_template) not in ids


@pytest.mark.asyncio
async def test_project_templates_refuses_a_non_member(
    db_client: AsyncClient, auth_as_outsider: UUID
) -> None:
    del auth_as_outsider  # consumed for its dependency-override side effect
    r = await db_client.get(
        PROJECT_TEMPLATES.format(pid=SEED.primary_project), params={"kind": "extraction"}
    )
    assert r.status_code == 403, r.text
