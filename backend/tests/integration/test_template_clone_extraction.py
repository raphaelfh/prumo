"""Integration tests for extraction global template clone (CHARMS).

Validates the optimized clone path: batch-loaded global fields, combined
counts query, and API response parity with global catalogue row counts.
"""

from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app

CHARMS_GLOBAL_ID = UUID("000c0000-0000-0000-0000-000000000001")


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """JWT sub must be a real profile id (FK on project_extraction_templates)."""
    raw = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if raw is None:
        pytest.skip("No profile rows available in test database")
    profile_id = UUID(str(raw))

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    yield profile_id


async def _pick_article(db: AsyncSession) -> tuple[UUID, UUID] | None:
    raw = (await db.execute(text("SELECT id, project_id FROM public.articles LIMIT 1"))).first()
    if raw is None:
        return None
    return UUID(str(raw[0])), UUID(str(raw[1]))


async def _global_extraction_catalog_counts(
    db: AsyncSession,
    global_template_id: UUID,
) -> tuple[int, int]:
    """Entity-type and field counts for rows still linked to the global template."""
    row = (
        await db.execute(
            text(
                """
                SELECT
                    (
                        SELECT COUNT(*)::bigint
                        FROM public.extraction_entity_types et
                        WHERE et.template_id = CAST(:tid AS uuid)
                    ),
                    (
                        SELECT COUNT(*)::bigint
                        FROM public.extraction_fields f
                        INNER JOIN public.extraction_entity_types et
                            ON et.id = f.entity_type_id
                        WHERE et.template_id = CAST(:tid AS uuid)
                    )
                """
            ),
            {"tid": str(global_template_id)},
        )
    ).one()
    return int(row[0]), int(row[1])


async def _wipe_charms_clone(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID | None,
) -> None:
    """Remove CHARMS project clone (and dependent runs/instances) for a clean clone test."""
    article_clause = "AND article_id = :aid" if article_id is not None else ""
    params: dict[str, object] = {
        "pid": str(project_id),
        "gid": str(CHARMS_GLOBAL_ID),
    }
    if article_id is not None:
        params["aid"] = str(article_id)

    await db.execute(
        text(
            f"""
            DELETE FROM public.extraction_runs
            WHERE project_id = CAST(:pid AS uuid) {article_clause}
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = CAST(:pid AS uuid)
                  AND global_template_id = CAST(:gid AS uuid)
              )
            """
        ),
        params,
    )
    await db.execute(
        text(
            f"""
            DELETE FROM public.extraction_instances
            WHERE project_id = CAST(:pid AS uuid) {article_clause}
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = CAST(:pid AS uuid)
                  AND global_template_id = CAST(:gid AS uuid)
              )
            """
        ),
        params,
    )
    await db.execute(
        text(
            "DELETE FROM public.project_extraction_templates "
            "WHERE project_id = CAST(:pid AS uuid) AND global_template_id = CAST(:gid AS uuid)"
        ),
        {"pid": str(project_id), "gid": str(CHARMS_GLOBAL_ID)},
    )
    await db.commit()


@pytest.mark.asyncio
async def test_clone_extraction_charms_response_matches_global_catalog_counts(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Clone CHARMS into a project; API counts must match global entity/field totals."""
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    expected_et, expected_fields = await _global_extraction_catalog_counts(
        db_session, CHARMS_GLOBAL_ID
    )
    if expected_et == 0 or expected_fields == 0:
        pytest.skip("CHARMS global catalogue not seeded (seed_charms did not insert)")

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article

    await _wipe_charms_clone(db_session, project_id=project_id, article_id=article_id)

    url = f"/api/v1/projects/{project_id}/templates/clone"
    payload = {"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"}

    res = await db_client.post(url, json=payload)
    assert res.status_code == 201, res.text
    data = res.json()["data"]
    assert data["created"] is True
    assert data["entity_type_count"] == expected_et
    assert data["field_count"] == expected_fields
    assert UUID(data["project_template_id"])
    assert UUID(data["version_id"])


@pytest.mark.asyncio
async def test_clone_extraction_charms_is_idempotent(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Second clone call returns the same template with matching counts."""
    from app.seed import seed_charms

    await seed_charms(db_session)
    await db_session.commit()

    expected_et, expected_fields = await _global_extraction_catalog_counts(
        db_session, CHARMS_GLOBAL_ID
    )
    if expected_et == 0:
        pytest.skip("CHARMS global catalogue not seeded")

    article = await _pick_article(db_session)
    if article is None:
        pytest.skip("Need an article + project")
    article_id, project_id = article

    await _wipe_charms_clone(db_session, project_id=project_id, article_id=article_id)

    url = f"/api/v1/projects/{project_id}/templates/clone"
    payload = {"global_template_id": str(CHARMS_GLOBAL_ID), "kind": "extraction"}

    first = await db_client.post(url, json=payload)
    assert first.status_code == 201, first.text
    first_body = first.json()["data"]

    second = await db_client.post(url, json=payload)
    assert second.status_code == 201, second.text
    second_body = second.json()["data"]

    assert second_body["project_template_id"] == first_body["project_template_id"]
    assert second_body["created"] is False
    assert second_body["entity_type_count"] == expected_et
    assert second_body["field_count"] == expected_fields
    assert second_body["entity_type_count"] == first_body["entity_type_count"]
    assert second_body["field_count"] == first_body["field_count"]
