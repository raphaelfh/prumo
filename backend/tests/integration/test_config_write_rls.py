"""RLS probes for the template-config write policies (B-7, migration 0049).

0049 tightens the four INSERT/UPDATE policies on the two live config
tables (``extraction_entity_types`` / ``extraction_fields``) from
``is_project_member`` to ``is_project_manager``, adds explicit WITH CHECK
to both UPDATEs, and adds the blocking ``template_id IS NULL`` predicate
to the entity-types pair (2026-08-08 panel, decision 1): without it a
manager JWT could write GLOBAL-catalogue sections that every tenant's
future clone imports (cross-tenant prompt injection via a cloned
``llm_description``) — only the ``ck_extraction_entity_types_template_xor``
data-model CHECK stood in the way, and RLS must not lean on a constraint
a future migration could relax.

Pattern: ``test_reviewer_ready_rls.py`` — probes run as the
``authenticated`` role with a real JWT sub set through the
``request.jwt.claims`` GUC (CI's ``supabase_stub.sql`` mirrors the real
``auth.uid()``'s GUC readers, so the probes behave identically there).

RLS refusals surface two ways and the probes assert both:
- an INSERT / UPDATE-with-check violation raises 42501
  ("row-level security policy"),
- a USING mismatch on UPDATE silently matches 0 rows.

Since 0054, ``authenticated`` no longer holds INSERT/UPDATE on either
table at all, so ``_attempt_write`` re-grants them inside its own
rolled-back transaction — see its docstring.
"""

from __future__ import annotations

import json
from typing import NamedTuple
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED


class WriteOutcome(NamedTuple):
    """Result of one write attempt under the ``authenticated`` role."""

    rowcount: int
    error: str | None


async def _attempt_write(
    db: AsyncSession, *, user_id: UUID, sql: str, params: dict[str, str]
) -> WriteOutcome:
    """Run one write as ``user_id`` under RLS, then roll it back.

    The leading commit seals any fixture rows below their own savepoint so
    the trailing rollback undoes ONLY this attempt (grant + write + role
    switch), keeping the seeded graph pristine for the next probe.

    Migration 0054 revoked INSERT/UPDATE on both tables from
    ``authenticated``, so a bare probe would now stop at the table
    privilege before any policy is consulted. Re-granting inside the
    rolled-back transaction keeps these probes aimed at the POLICY — the
    security floor, which has to keep holding if the grant is ever
    restored (a Supabase ``GRANT ALL ON ALL TABLES`` is one dashboard
    click). The revoke itself is pinned by
    ``test_config_write_grant_revoked.py``.
    """
    await db.commit()
    try:
        await db.execute(
            text(
                "GRANT INSERT, UPDATE ON public.extraction_entity_types, "
                "public.extraction_fields TO authenticated"
            )
        )
        await db.execute(
            text("SELECT set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": str(user_id), "role": "authenticated"})},
        )
        await db.execute(text("SET LOCAL ROLE authenticated"))
        result = await db.execute(text(sql), params)
        return WriteOutcome(rowcount=result.rowcount, error=None)
    except DBAPIError as exc:
        return WriteOutcome(rowcount=0, error=str(exc.orig))
    finally:
        await db.rollback()


async def _global_lineage(db: AsyncSession) -> tuple[UUID, UUID, UUID]:
    """Create a global-catalogue template + section + field (RLS bypassed).

    Runs as the table owner before any role switch; the outer-transaction
    rollback at fixture teardown removes the rows again.
    """
    global_id = (
        await db.execute(
            text(
                "INSERT INTO public.extraction_templates_global (name, framework, kind) "
                "VALUES ('rls-probe-global', 'CUSTOM', 'extraction') RETURNING id"
            )
        )
    ).scalar_one()
    entity_type_id = (
        await db.execute(
            text(
                "INSERT INTO public.extraction_entity_types "
                "(template_id, name, label, cardinality, role, sort_order) "
                "VALUES (:gid, 'probe_section', 'Probe Section', 'one', "
                "'study_section', 0) RETURNING id"
            ),
            {"gid": str(global_id)},
        )
    ).scalar_one()
    field_id = (
        await db.execute(
            text(
                "INSERT INTO public.extraction_fields "
                "(entity_type_id, name, label, field_type) "
                "VALUES (:etid, 'probe_field', 'Probe Field', 'text') RETURNING id"
            ),
            {"etid": str(entity_type_id)},
        )
    ).scalar_one()
    return UUID(str(global_id)), UUID(str(entity_type_id)), UUID(str(field_id))


_INSERT_PROJECT_ENTITY_TYPE = (
    "INSERT INTO public.extraction_entity_types "
    "(project_template_id, name, label, cardinality, role, sort_order) "
    "VALUES (:tid, 'rls_probe_section', 'RLS Probe Section', 'one', "
    "'study_section', 99)"
)

_INSERT_PROJECT_FIELD = (
    "INSERT INTO public.extraction_fields "
    "(entity_type_id, name, label, field_type) "
    "VALUES (:etid, 'rls_probe_field', 'RLS Probe Field', 'text')"
)


# =================== extraction_entity_types ===================


@pytest.mark.asyncio
async def test_member_insert_entity_type_refused(db_session: AsyncSession) -> None:
    """A non-manager member must NOT insert sections (0049 manager gate)."""
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.reviewer_profile,
        sql=_INSERT_PROJECT_ENTITY_TYPE,
        params={"tid": str(SEED.primary_template)},
    )
    assert outcome.error is not None and "row-level security" in outcome.error, (
        "member-writable hole: a plain member inserted a section via "
        f"PostgREST-shaped SQL (outcome={outcome}). The INSERT policy must "
        "require is_project_manager."
    )


@pytest.mark.asyncio
async def test_member_update_entity_type_refused(db_session: AsyncSession) -> None:
    """A non-manager member's UPDATE must match 0 rows (USING gate)."""
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.reviewer_profile,
        sql=("UPDATE public.extraction_entity_types SET label = 'member-tampered' WHERE id = :id"),
        params={"id": str(SEED.primary_entity_type)},
    )
    assert outcome == WriteOutcome(rowcount=0, error=None), (
        "member-writable hole: a plain member updated a section "
        f"(outcome={outcome}). The UPDATE policy must require is_project_manager."
    )


@pytest.mark.asyncio
async def test_manager_insert_entity_type_allowed(db_session: AsyncSession) -> None:
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.primary_profile,
        sql=_INSERT_PROJECT_ENTITY_TYPE,
        params={"tid": str(SEED.primary_template)},
    )
    assert outcome == WriteOutcome(rowcount=1, error=None), (
        f"a project manager must keep inserting sections (outcome={outcome})"
    )


@pytest.mark.asyncio
async def test_manager_update_entity_type_allowed(db_session: AsyncSession) -> None:
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.primary_profile,
        sql=("UPDATE public.extraction_entity_types SET label = 'manager-renamed' WHERE id = :id"),
        params={"id": str(SEED.primary_entity_type)},
    )
    assert outcome == WriteOutcome(rowcount=1, error=None), (
        f"a project manager must keep updating sections (outcome={outcome})"
    )


@pytest.mark.asyncio
async def test_manager_global_lineage_insert_refused(db_session: AsyncSession) -> None:
    """The injection probe: a manager INSERT into the GLOBAL catalogue must
    be refused by RLS itself (panel decision 1)."""
    global_id, _, _ = await _global_lineage(db_session)
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.primary_profile,
        sql=(
            "INSERT INTO public.extraction_entity_types "
            "(template_id, name, label, cardinality, role, sort_order) "
            "VALUES (:gid, 'injected_section', 'Injected', 'one', "
            "'study_section', 99)"
        ),
        params={"gid": str(global_id)},
    )
    assert outcome.error is not None and "row-level security" in outcome.error, (
        "global-catalogue injection: a manager JWT inserted a global-lineage "
        f"section (outcome={outcome}) — every tenant's future clone would "
        "import it (cross-tenant prompt injection via llm_description)."
    )


@pytest.mark.asyncio
async def test_manager_hybrid_lineage_insert_refused(db_session: AsyncSession) -> None:
    """A hybrid row (BOTH lineage ids set) must be refused. Today the
    template_xor CHECK also stops it; the policy's ``template_id IS NULL``
    predicate is the security floor that survives a relaxed data model."""
    global_id, _, _ = await _global_lineage(db_session)
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.primary_profile,
        sql=(
            "INSERT INTO public.extraction_entity_types "
            "(template_id, project_template_id, name, label, cardinality, "
            "role, sort_order) "
            "VALUES (:gid, :tid, 'hybrid_section', 'Hybrid', 'one', "
            "'study_section', 99)"
        ),
        params={"gid": str(global_id), "tid": str(SEED.primary_template)},
    )
    assert outcome.error is not None, (
        f"hybrid-lineage section INSERT must be refused (outcome={outcome})"
    )


@pytest.mark.asyncio
async def test_manager_cannot_repoint_entity_type_to_global(
    db_session: AsyncSession,
) -> None:
    """UPDATE re-point of a project section into the global catalogue must
    fail the policy check (belt-and-braces WITH CHECK, panel decision 3)."""
    global_id, _, _ = await _global_lineage(db_session)
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.primary_profile,
        sql=(
            "UPDATE public.extraction_entity_types "
            "SET template_id = :gid, project_template_id = NULL "
            "WHERE id = :id"
        ),
        params={"gid": str(global_id), "id": str(SEED.primary_entity_type)},
    )
    assert outcome.error is not None and "row-level security" in outcome.error, (
        "global-catalogue injection via UPDATE re-point succeeded "
        f"(outcome={outcome}); the UPDATE policy must check the NEW row."
    )


@pytest.mark.asyncio
async def test_manager_global_lineage_update_refused(db_session: AsyncSession) -> None:
    """Global-lineage sections stay invisible to manager UPDATEs."""
    _, entity_type_id, _ = await _global_lineage(db_session)
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.primary_profile,
        sql=("UPDATE public.extraction_entity_types SET label = 'tampered-global' WHERE id = :id"),
        params={"id": str(entity_type_id)},
    )
    assert outcome == WriteOutcome(rowcount=0, error=None), (
        f"a manager must not update global-catalogue sections (outcome={outcome})"
    )


# =================== extraction_fields ===================


@pytest.mark.asyncio
async def test_member_insert_field_refused(db_session: AsyncSession) -> None:
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.reviewer_profile,
        sql=_INSERT_PROJECT_FIELD,
        params={"etid": str(SEED.primary_entity_type)},
    )
    assert outcome.error is not None and "row-level security" in outcome.error, (
        "member-writable hole: a plain member inserted a field "
        f"(outcome={outcome}). The INSERT policy must require is_project_manager."
    )


@pytest.mark.asyncio
async def test_member_update_field_refused(db_session: AsyncSession) -> None:
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.reviewer_profile,
        sql=("UPDATE public.extraction_fields SET label = 'member-tampered' WHERE id = :id"),
        params={"id": str(SEED.primary_field)},
    )
    assert outcome == WriteOutcome(rowcount=0, error=None), (
        "member-writable hole: a plain member updated a field "
        f"(outcome={outcome}). The UPDATE policy must require is_project_manager."
    )


@pytest.mark.asyncio
async def test_manager_insert_field_allowed(db_session: AsyncSession) -> None:
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.primary_profile,
        sql=_INSERT_PROJECT_FIELD,
        params={"etid": str(SEED.primary_entity_type)},
    )
    assert outcome == WriteOutcome(rowcount=1, error=None), (
        f"a project manager must keep inserting fields (outcome={outcome})"
    )


@pytest.mark.asyncio
async def test_manager_update_field_allowed(db_session: AsyncSession) -> None:
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.primary_profile,
        sql=("UPDATE public.extraction_fields SET label = 'manager-renamed' WHERE id = :id"),
        params={"id": str(SEED.primary_field)},
    )
    assert outcome == WriteOutcome(rowcount=1, error=None), (
        f"a project manager must keep updating fields (outcome={outcome})"
    )


@pytest.mark.asyncio
async def test_manager_global_lineage_field_insert_refused(
    db_session: AsyncSession,
) -> None:
    """Fields hang off the et→pet chain, which already excludes global
    lineage; pin that a manager cannot add fields to a global section."""
    _, entity_type_id, _ = await _global_lineage(db_session)
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.primary_profile,
        sql=_INSERT_PROJECT_FIELD,
        params={"etid": str(entity_type_id)},
    )
    assert outcome.error is not None and "row-level security" in outcome.error, (
        "global-catalogue injection: a manager JWT added a field to a "
        f"global-lineage section (outcome={outcome})"
    )


@pytest.mark.asyncio
async def test_manager_global_lineage_field_update_refused(
    db_session: AsyncSession,
) -> None:
    _, _, field_id = await _global_lineage(db_session)
    outcome = await _attempt_write(
        db_session,
        user_id=SEED.primary_profile,
        sql=("UPDATE public.extraction_fields SET label = 'tampered-global' WHERE id = :id"),
        params={"id": str(field_id)},
    )
    assert outcome == WriteOutcome(rowcount=0, error=None), (
        f"a manager must not update global-catalogue fields (outcome={outcome})"
    )
