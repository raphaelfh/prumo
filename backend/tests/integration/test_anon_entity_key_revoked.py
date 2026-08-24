"""Migration 0060 — the anon RPC oracle 0058 opened is closed again.

0058 granted ``can_read_entity_type`` to ``anon`` so the SELECT policy
could be evaluated for anonymous callers. PostgREST exposes any granted
function at ``/rest/v1/rpc/<name>``, so the publishable anon key was
enough to call it — and it returns a boolean, making it an oracle for
"is this user a member of the project owning this entity type?".

Supabase's ``anon_security_definer_function_executable`` advisor caught
it, and it was the only SECURITY DEFINER function in ``public`` that
``anon`` could execute. These tests pin the revoke so a future GRANT
cannot silently reopen it.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio

_CONFIG_TABLES = ("public.extraction_entity_types", "public.extraction_fields")


async def test_anon_cannot_execute_the_entity_key_helper(db_session: AsyncSession) -> None:
    """The oracle itself."""
    granted = (
        await db_session.execute(
            text(
                "SELECT has_function_privilege("
                "  'anon', 'public.can_read_entity_type(uuid,uuid)', 'EXECUTE')"
            )
        )
    ).scalar_one()
    assert granted is False


async def test_no_security_definer_function_is_anon_executable(
    db_session: AsyncSession,
) -> None:
    """Defence in depth: the CLASS stays empty, not just this one function.

    Before 0058 no SECURITY DEFINER function in ``public`` was callable by
    ``anon``. Pinning the class catches the next helper that repeats the
    mistake, not only this one.
    """
    leaked = (
        (
            await db_session.execute(
                text(
                    "SELECT p.proname FROM pg_proc p "
                    "JOIN pg_namespace n ON n.oid = p.pronamespace "
                    "WHERE n.nspname = 'public' AND p.prosecdef "
                    "  AND has_function_privilege('anon', p.oid, 'EXECUTE') "
                    "ORDER BY 1"
                )
            )
        )
        .scalars()
        .all()
    )
    assert leaked == [], f"anon can execute SECURITY DEFINER function(s): {leaked}"


@pytest.mark.parametrize("table", _CONFIG_TABLES)
async def test_anon_cannot_select_the_config_tables(db_session: AsyncSession, table: str) -> None:
    """A clean table-level denial, not a confusing function-permission error."""
    granted = (
        await db_session.execute(
            text("SELECT has_table_privilege('anon', :table, 'SELECT')"),
            {"table": table},
        )
    ).scalar_one()
    assert granted is False


@pytest.mark.parametrize("table", _CONFIG_TABLES)
async def test_authenticated_still_reads_the_config_tables(
    db_session: AsyncSession, table: str
) -> None:
    """The app's real callers are unaffected — only anon loses access."""
    granted = (
        await db_session.execute(
            text("SELECT has_table_privilege('authenticated', :table, 'SELECT')"),
            {"table": table},
        )
    ).scalar_one()
    assert granted is True


async def test_authenticated_still_executes_the_entity_key_helper(
    db_session: AsyncSession,
) -> None:
    """The RLS policy still needs it for signed-in callers."""
    granted = (
        await db_session.execute(
            text(
                "SELECT has_function_privilege("
                "  'authenticated', 'public.can_read_entity_type(uuid,uuid)', 'EXECUTE')"
            )
        )
    ).scalar_one()
    assert granted is True
