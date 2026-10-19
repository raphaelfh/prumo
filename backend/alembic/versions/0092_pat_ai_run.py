"""Add the ai_run grant to personal_access_tokens (ADR 0021).

``ai_run`` is a separate grant to start AI extraction runs, held by a PAT or
an OAuth connection row next to its ``scope``. It defaults to false, so every
existing row keeps exactly the tools it had. A row carrying the grant lives
at most 30 days (``ai_run_lifetime_check``); rows without it keep the
365-day bound of ``expires_at_check``.

Additive only; writes no rows. The table stays backend-only (0078 deny-all
posture), so there is no RLS change. Downgrade drops the CHECK, then the
column.

Revision ID: 0092_pat_ai_run
Revises: 0091_ai_usage_ledger
"""

import sqlalchemy as sa

from alembic import op

revision = "0092_pat_ai_run"
down_revision = "0091_ai_usage_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "personal_access_tokens",
        sa.Column("ai_run", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        schema="public",
    )
    op.create_check_constraint(
        "ai_run_lifetime_check",
        "personal_access_tokens",
        "NOT ai_run OR expires_at <= created_at + interval '30 days'",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ai_run_lifetime_check", "personal_access_tokens", type_="check", schema="public"
    )
    op.drop_column("personal_access_tokens", "ai_run", schema="public")
