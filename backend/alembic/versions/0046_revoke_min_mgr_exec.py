"""Revoke EXECUTE on enforce_min_one_manager from PUBLIC/anon/authenticated

Revision ID: 0046_revoke_min_mgr_exec
Revises: 0045_one_live_run_guard
Create Date: 2026-07-07

``public.enforce_min_one_manager()`` (migration 0043) is a SECURITY DEFINER
*trigger* function — invoked only by ``trg_project_members_min_one_manager``,
never as an RPC. ``CREATE FUNCTION`` grants EXECUTE to PUBLIC by default, so
``anon`` and ``authenticated`` inherit it and become callable via PostgREST's
``/rest/v1/rpc`` surface. Supabase flags that as two
"security_definer_function_executable" advisors (anon + authenticated).

The grant is not load-bearing: a trigger fires its function regardless of the
invoking role's EXECUTE privilege — unlike the ``is_project_*`` helpers, which
RLS policy expressions DO invoke in the caller's role and therefore must keep
EXECUTE. Revoking it clears both advisors with no functional change, proven by
``tests/integration/test_min_one_manager_exec_grant.py`` (the guard still
raises PM001 for an ``authenticated`` caller after the revoke). The function
also can't be RPC-called anyway: a trigger-returning function raises "trigger
functions can only be called as triggers" on direct invocation.

REVOKE FROM PUBLIC removes the inherited path; ``anon, authenticated`` are
named too for explicit intent (harmless no-ops if no direct grant exists).

downgrade() restores the CREATE-FUNCTION default (EXECUTE to PUBLIC).
"""

from alembic import op

revision = "0046_revoke_min_mgr_exec"
down_revision = "0045_one_live_run_guard"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "REVOKE EXECUTE ON FUNCTION public.enforce_min_one_manager() "
        "FROM PUBLIC, anon, authenticated;"
    )


def downgrade() -> None:
    op.execute("GRANT EXECUTE ON FUNCTION public.enforce_min_one_manager() TO PUBLIC;")
