"""RLS probes for the template-config READ policies (migration 0058).

Sibling of ``test_config_write_rls.py``, which covers the write side of
the same two tables. 0058 replaces the two ``USING (true)`` SELECT
policies on ``extraction_entity_types`` / ``extraction_fields`` with
``public.can_read_entity_type``: global-catalogue rows
(``project_template_id IS NULL``) stay world-readable so the import
dialog can list them, and project-lineage rows require
``is_project_member``.

The bug being pinned: neither policy carried a ``TO`` clause
(``pg_policy.polroles`` = PUBLIC) and baseline grants SELECT to ``anon``
as well as ``authenticated``, so *unauthenticated* callers could read
every project's sections, fields and authored ``llm_description`` through
``/rest/v1/extraction_fields``. ``test_anon_cannot_read_project_*``
is therefore the probe that matters most — it fails against the old
policy for the anon case specifically, which no member/non-member probe
would catch.

Pattern: ``test_config_write_rls.py`` — probes run under a switched role
with the JWT sub set through the ``request.jwt.claims`` GUC (CI's
``supabase_stub.sql`` creates ``anon``/``authenticated`` and mirrors the
real ``auth.uid()``'s GUC readers, so these behave identically there).

Like its write sibling, each probe re-GRANTs SELECT inside its own
rolled-back transaction. The probes are aimed at the POLICY — the
security floor, which has to keep holding if a grant is ever widened (a
Supabase ``GRANT ALL ON ALL TABLES`` is one dashboard click).
"""

from __future__ import annotations

import json
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED

pytestmark = pytest.mark.asyncio


async def _read_as(
    db: AsyncSession,
    *,
    user_id: UUID | None,
    sql: str,
    params: dict[str, str],
) -> int:
    """Count rows visible for one SELECT under RLS, then roll back.

    ``user_id=None`` probes the ``anon`` role with no ``request.jwt.*``
    GUC set at all — the unauthenticated PostgREST caller, where
    ``auth.uid()`` resolves to NULL.

    The leading commit seals the seeded rows below their own savepoint so
    the trailing rollback undoes ONLY this probe (grant + role switch).
    """
    await db.commit()
    try:
        await db.execute(
            text(
                "GRANT SELECT ON public.extraction_entity_types, "
                "public.extraction_fields TO anon, authenticated"
            )
        )
        if user_id is None:
            await db.execute(text("SET LOCAL ROLE anon"))
        else:
            await db.execute(
                text("SELECT set_config('request.jwt.claims', :claims, true)"),
                {"claims": json.dumps({"sub": str(user_id), "role": "authenticated"})},
            )
            await db.execute(text("SET LOCAL ROLE authenticated"))
        return len((await db.execute(text(sql), params)).all())
    finally:
        await db.rollback()


async def _global_lineage(db: AsyncSession) -> tuple[UUID, UUID]:
    """Create a global-catalogue section + field (RLS bypassed).

    Runs as the table owner before any role switch; the outer-transaction
    rollback at fixture teardown removes the rows again. Mirrors the
    helper of the same name in ``test_config_write_rls.py``.
    """
    global_id = (
        await db.execute(
            text(
                "INSERT INTO public.extraction_templates_global (name, framework, kind) "
                "VALUES ('rls-read-probe-global', 'CUSTOM', 'extraction') RETURNING id"
            )
        )
    ).scalar_one()
    entity_type_id = (
        await db.execute(
            text(
                "INSERT INTO public.extraction_entity_types "
                "(template_id, name, label, cardinality, role, sort_order) "
                "VALUES (:gid, 'read_probe_section', 'Read Probe Section', 'one', "
                "'study_section', 0) RETURNING id"
            ),
            {"gid": str(global_id)},
        )
    ).scalar_one()
    field_id = (
        await db.execute(
            text(
                "INSERT INTO public.extraction_fields "
                "(entity_type_id, name, label, field_type, llm_description) "
                "VALUES (:etid, 'read_probe_field', 'Read Probe Field', 'text', "
                "'global prompt — the import dialog must still list this') RETURNING id"
            ),
            {"etid": str(entity_type_id)},
        )
    ).scalar_one()
    return UUID(str(entity_type_id)), UUID(str(field_id))


_SELECT_ENTITY_TYPE = "SELECT id FROM public.extraction_entity_types WHERE id = :id"
_SELECT_FIELD = "SELECT id, llm_description FROM public.extraction_fields WHERE id = :id"


# =================== project lineage — members only ===================


async def test_member_can_read_project_entity_type(db_session: AsyncSession) -> None:
    visible = await _read_as(
        db_session,
        user_id=SEED.primary_profile,
        sql=_SELECT_ENTITY_TYPE,
        params={"id": str(SEED.primary_entity_type)},
    )
    assert visible == 1, "a project member must still read their own template's sections"


async def test_member_can_read_project_field(db_session: AsyncSession) -> None:
    visible = await _read_as(
        db_session,
        user_id=SEED.primary_profile,
        sql=_SELECT_FIELD,
        params={"id": str(SEED.primary_field)},
    )
    assert visible == 1, "a project member must still read their own template's fields"


async def test_outsider_cannot_read_project_entity_type(
    db_session: AsyncSession,
) -> None:
    visible = await _read_as(
        db_session,
        user_id=SEED.outsider_profile,
        sql=_SELECT_ENTITY_TYPE,
        params={"id": str(SEED.primary_entity_type)},
    )
    assert visible == 0, "a non-member must not read another project's sections"


async def test_outsider_cannot_read_project_field(db_session: AsyncSession) -> None:
    visible = await _read_as(
        db_session,
        user_id=SEED.outsider_profile,
        sql=_SELECT_FIELD,
        params={"id": str(SEED.primary_field)},
    )
    assert visible == 0, "a non-member must not read another project's fields or prompts"


# =================== the unauthenticated leak ===================


async def test_anon_cannot_read_project_entity_type(db_session: AsyncSession) -> None:
    visible = await _read_as(
        db_session,
        user_id=None,
        sql=_SELECT_ENTITY_TYPE,
        params={"id": str(SEED.primary_entity_type)},
    )
    assert visible == 0, "an unauthenticated caller must not read project sections"


async def test_anon_cannot_read_project_field(db_session: AsyncSession) -> None:
    visible = await _read_as(
        db_session,
        user_id=None,
        sql=_SELECT_FIELD,
        params={"id": str(SEED.primary_field)},
    )
    assert visible == 0, (
        "an unauthenticated caller must not read project fields — this is the leak "
        "0058 closes; the anon key alone used to be enough"
    )


# =================== global catalogue — stays open ===================


async def test_global_entity_type_readable_by_outsider(
    db_session: AsyncSession,
) -> None:
    entity_type_id, _ = await _global_lineage(db_session)
    visible = await _read_as(
        db_session,
        user_id=SEED.outsider_profile,
        sql=_SELECT_ENTITY_TYPE,
        params={"id": str(entity_type_id)},
    )
    assert visible == 1, "the import dialog lists global sections for every authenticated user"


async def test_global_field_readable_by_outsider(db_session: AsyncSession) -> None:
    _, field_id = await _global_lineage(db_session)
    visible = await _read_as(
        db_session,
        user_id=SEED.outsider_profile,
        sql=_SELECT_FIELD,
        params={"id": str(field_id)},
    )
    assert visible == 1, "global-catalogue fields stay readable by every authenticated user"


async def test_global_catalogue_listing_readable_by_outsider(
    db_session: AsyncSession,
) -> None:
    """The listing shape the import dialog actually issues.

    ``templateService.ts:529`` reads entity types by GLOBAL ``template_id``
    for every ``is_global`` extraction template — an unfiltered listing, not
    a lookup by id. A policy that scoped those rows would blank that picker.

    The global row is created here rather than read from the seed: the
    integration fixture seeds a minimum graph only, and ``app.seed`` (which
    installs the CHARMS catalogue) does not run in CI.
    """
    await _global_lineage(db_session)
    visible = await _read_as(
        db_session,
        user_id=SEED.outsider_profile,
        sql=(
            "SELECT et.id FROM public.extraction_entity_types et "
            "WHERE et.template_id IS NOT NULL LIMIT 5"
        ),
        params={},
    )
    assert visible > 0, "global catalogue rows must remain readable to non-members"
