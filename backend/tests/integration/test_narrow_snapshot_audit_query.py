"""The narrow-baseline audit against a real database (B-9x).

The classifier is unit-tested; this covers the part that can only be wrong
against Postgres — the join, the `is_active` filter, and the fact that a
planted narrow baseline is actually FOUND.

It also makes permanent the mutation proof I ran by hand: a clean estate
reporting "0 affected" demonstrates nothing on its own.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.narrow_snapshot_audit import (
    NarrowEra,
    audit_active_baselines,
    format_findings,
)
from tests.integration.helpers.template_fixtures import fresh_charms

PRE_0017 = {"entity_types": [{"id": "sec-1", "label": "Old", "fields": [{"id": "f-1"}]}]}
PRE_0026 = {
    "entity_types": [
        {
            "id": "sec-2",
            "label": "Newer",
            "role": "study_section",
            "fields": [{"id": "f-2", "name": "x"}],
        }
    ]
}


async def _set_active_schema(db: AsyncSession, template_id, payload: dict) -> None:
    await db.execute(
        text(
            "UPDATE public.extraction_template_versions SET schema = CAST(:s AS jsonb) "
            "WHERE project_template_id = :t AND is_active"
        ),
        {"s": json.dumps(payload), "t": str(template_id)},
    )
    await db.flush()


@pytest.mark.asyncio
async def test_a_healthy_estate_reports_nothing(db_session: AsyncSession) -> None:
    await fresh_charms(db_session)
    assert await audit_active_baselines(db_session) == []


@pytest.mark.asyncio
async def test_a_planted_pre_0017_baseline_is_found(db_session: AsyncSession) -> None:
    project_id, template_id, _ = await fresh_charms(db_session)
    await _set_active_schema(db_session, template_id, PRE_0017)

    findings = await audit_active_baselines(db_session)

    assert [f.template_id for f in findings] == [template_id]
    assert findings[0].project_id == project_id
    assert findings[0].classification.era is NarrowEra.PRE_0017_NO_ROLE
    assert findings[0].classification.narrow_entity_type_ids == ("sec-1",)


@pytest.mark.asyncio
async def test_a_planted_pre_0026_baseline_is_found(db_session: AsyncSession) -> None:
    """The era 0026's own backfill skipped, because it keyed on the role probe."""
    _, template_id, _ = await fresh_charms(db_session)
    await _set_active_schema(db_session, template_id, PRE_0026)

    findings = await audit_active_baselines(db_session)

    assert findings[0].classification.era is NarrowEra.PRE_0026_NARROW_FIELDS


@pytest.mark.asyncio
async def test_only_the_ACTIVE_version_is_audited(db_session: AsyncSession) -> None:
    """History is append-only, so old narrow versions are expected and fine.

    Auditing them would report every template that has ever been migrated.
    """
    _, template_id, _ = await fresh_charms(db_session)
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "SELECT gen_random_uuid(), :t, 99, CAST(:s AS jsonb), published_by, false "
            "FROM public.extraction_template_versions "
            "WHERE project_template_id = :t AND is_active"
        ),
        {"t": str(template_id), "s": json.dumps(PRE_0017)},
    )
    await db_session.flush()

    assert await audit_active_baselines(db_session) == []


@pytest.mark.asyncio
async def test_the_report_names_the_remedy(db_session: AsyncSession) -> None:
    """An operator has to be able to act on it, not just be told it is broken."""
    _, template_id, _ = await fresh_charms(db_session)
    await _set_active_schema(db_session, template_id, PRE_0017)

    findings = await audit_active_baselines(db_session)
    report = format_findings(findings, total=1)

    assert str(template_id) in report
    assert NarrowEra.PRE_0017_NO_ROLE.label in report
    assert "Republish the current configuration" in report
    assert "1 template(s) of 1" in report


def test_the_report_is_honest_about_an_empty_estate() -> None:
    assert "0 template(s) of 7" in format_findings([], total=7)
