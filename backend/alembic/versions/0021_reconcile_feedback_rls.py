"""Reconcile out-of-band RLS drift on feedback_reports (issue #185).

Migration 0020 locked `feedback_reports` to service-role-only by dropping
`feedback_reports_insert` and `feedback_reports_select_own`. The expected
end-state after 0001 -> 0020 is therefore **zero permissive policies** — the
API/worker reach the table as `service_role`, which bypasses RLS.

The migration-drift detector (#185) found four policies on the table that no
migration authored:

  - feedback_reports_insert  (should have been dropped by 0020)
  - feedback_reports_select  (never created by any migration)
  - feedback_reports_update  (never created by any migration)
  - feedback_reports_delete  (never created by any migration)

They were added out-of-band (Supabase dashboard / MCP). A lingering permissive
`insert` policy is the security-relevant one: it lets an authenticated user
INSERT straight into the table, bypassing `POST /api/v1/feedback` (which
validates, enriches, and queues the report for Linear) so the row is never
forwarded.

By the time this migration was written, prod had already self-reconciled
(pg_policies showed 0 policies on both feedback tables, RLS still enabled).
This migration therefore codifies the canonical state in version control and
cleans any non-prod environment that still carries the stray policies — the
`IF EXISTS` clauses make it a safe no-op where they are already gone.

Per the project rule, this reconciliation runs through Alembic, never through
the Supabase MCP/dashboard (which is what caused the drift in the first place).

Revision ID: 0021_reconcile_feedback_rls
Revises: 0020_feedback_outbox
Create Date: 2026-06-04
"""

from alembic import op

revision = "0021_reconcile_feedback_rls"
down_revision = "0020_feedback_outbox"
branch_labels = None
depends_on = None


# Every permissive policy that must NOT exist on feedback_reports.
_STRAY_POLICIES = (
    "feedback_reports_insert",
    "feedback_reports_select",
    "feedback_reports_update",
    "feedback_reports_delete",
    # also drop the legacy own-row read in case an older env still has it
    "feedback_reports_select_own",
)


def upgrade() -> None:
    # RLS must stay enabled; ENABLE is idempotent (no-op if already on).
    op.execute("ALTER TABLE public.feedback_reports ENABLE ROW LEVEL SECURITY;")
    for policy in _STRAY_POLICIES:
        op.execute(f'DROP POLICY IF EXISTS "{policy}" ON public.feedback_reports;')


def downgrade() -> None:
    # Intentionally empty. This migration asserts the *absence* of policies that
    # no migration ever created; recreating them on downgrade would re-introduce
    # the exact drift (and security gap) it reconciles. RLS stays enabled.
    pass
