"""Record the origin of agent-started batches (ADR 0021).

``extraction_batches`` gains ``agent_token_id`` (the credential that started
the batch, ``ON DELETE SET NULL``), ``agent_engine`` (the approved engine
identity) and ``agent_plan_digest`` (the approved plan). Engine and digest
are set together, and a token is never set without them
(``agent_fields_check``); one digest names at most one batch (a partial
unique index). Two partial indexes serve the per-credential lookup and the
per-project daily agent count. ``ai_usage_ledger`` gains a nullable
``agent_token_id`` with the same ``SET NULL`` key and a partial index.

Additive only; writes no rows. Both tables are already backend-only, so
there is no RLS or grant change. Downgrade drops everything in reverse.

Revision ID: 0093_batch_agent_origin
Revises: 0092_pat_ai_run
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision = "0093_batch_agent_origin"
down_revision = "0092_pat_ai_run"
branch_labels = None
depends_on = None

_TOKEN_FKEYS = {
    "extraction_batches": "extraction_batches_agent_token_id_fkey",
    "ai_usage_ledger": "ai_usage_ledger_agent_token_id_fkey",
}


def upgrade() -> None:
    for table, fkey in _TOKEN_FKEYS.items():
        op.add_column(
            table,
            sa.Column("agent_token_id", PG_UUID(as_uuid=True), nullable=True),
            schema="public",
        )
        op.create_foreign_key(
            fkey,
            table,
            "personal_access_tokens",
            ["agent_token_id"],
            ["id"],
            source_schema="public",
            referent_schema="public",
            ondelete="SET NULL",
        )
    op.add_column(
        "extraction_batches", sa.Column("agent_engine", JSONB(), nullable=True), schema="public"
    )
    op.add_column(
        "extraction_batches",
        sa.Column("agent_plan_digest", sa.Text(), nullable=True),
        schema="public",
    )
    op.create_check_constraint(
        "agent_fields_check",
        "extraction_batches",
        "(agent_engine IS NULL) = (agent_plan_digest IS NULL) "
        "AND (agent_token_id IS NULL OR agent_plan_digest IS NOT NULL)",
        schema="public",
    )
    op.create_index(
        "uq_extraction_batches_agent_plan_digest",
        "extraction_batches",
        ["agent_plan_digest"],
        unique=True,
        schema="public",
        postgresql_where=sa.text("agent_plan_digest IS NOT NULL"),
    )
    op.create_index(
        "ix_extraction_batches_agent_token_id",
        "extraction_batches",
        ["agent_token_id"],
        schema="public",
        postgresql_where=sa.text("agent_token_id IS NOT NULL"),
    )
    op.create_index(
        "ix_extraction_batches_agent_project_created",
        "extraction_batches",
        ["project_id", "created_at"],
        schema="public",
        postgresql_where=sa.text("agent_plan_digest IS NOT NULL"),
    )
    op.create_index(
        "ix_ai_usage_ledger_agent_token_id",
        "ai_usage_ledger",
        ["agent_token_id"],
        schema="public",
        postgresql_where=sa.text("agent_token_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_ai_usage_ledger_agent_token_id", "ai_usage_ledger", schema="public")
    for index in (
        "ix_extraction_batches_agent_project_created",
        "ix_extraction_batches_agent_token_id",
        "uq_extraction_batches_agent_plan_digest",
    ):
        op.drop_index(index, "extraction_batches", schema="public")
    op.drop_constraint("agent_fields_check", "extraction_batches", type_="check", schema="public")
    op.drop_column("extraction_batches", "agent_plan_digest", schema="public")
    op.drop_column("extraction_batches", "agent_engine", schema="public")
    for table, fkey in reversed(_TOKEN_FKEYS.items()):
        op.drop_constraint(fkey, table, type_="foreignkey", schema="public")
        op.drop_column(table, "agent_token_id", schema="public")
