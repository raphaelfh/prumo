"""Create ai_usage_ledger: one append-only row per model call.

Each row records the call's provider, model, key scope, pass kind, prompt
version, token counts (``total_tokens`` is a stored generated column),
outcome and provider request id. ``project_id`` is ``ON DELETE CASCADE``;
``owner_id``, ``run_id``, ``attempt_id`` and ``batch_id`` are nullable and
``ON DELETE SET NULL`` so the usage outlives what it names. ``key_scope`` is
nullable: an env-default call made before credentials resolve has no scope.

Backend-only table with the 0072 ``deny_all`` posture: RLS enabled, a single
``deny_all`` policy, and every privilege revoked from ``authenticated`` /
``anon``. The backend's own role owns the table and bypasses RLS.

Additive only; writes no rows. Downgrade drops the table (indexes and the
policy go with it).

Revision ID: 0091_ai_usage_ledger
Revises: 0090_entity_key_unique
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision = "0091_ai_usage_ledger"
down_revision = "0090_entity_key_unique"
branch_labels = None
depends_on = None


def _link(column: str, target: str, ondelete: str, *, nullable: bool = True) -> sa.Column:
    return sa.Column(
        column,
        PG_UUID(as_uuid=True),
        sa.ForeignKey(
            f"public.{target}.id", ondelete=ondelete, name=f"ai_usage_ledger_{column}_fkey"
        ),
        nullable=nullable,
    )


def upgrade() -> None:
    op.create_table(
        "ai_usage_ledger",
        sa.Column(
            "id",
            PG_UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        _link("project_id", "projects", "CASCADE", nullable=False),
        _link("owner_id", "profiles", "SET NULL"),
        _link("run_id", "extraction_runs", "SET NULL"),
        _link("attempt_id", "extraction_attempts", "SET NULL"),
        _link("batch_id", "extraction_batches", "SET NULL"),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("key_scope", sa.Text(), nullable=True),
        sa.Column("pass_kind", sa.Text(), nullable=False),
        sa.Column("prompt_version", sa.Text(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False),
        sa.Column("completion_tokens", sa.Integer(), nullable=False),
        sa.Column(
            "total_tokens",
            sa.Integer(),
            sa.Computed("prompt_tokens + completion_tokens", persisted=True),
        ),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("request_id", sa.Text(), nullable=True),
        # SHORT names: the "ck" convention expands them to ck_ai_usage_ledger_<name>.
        sa.CheckConstraint(
            "key_scope IS NULL OR key_scope IN ('user_byok', 'project_shared', 'global_service')",
            name="key_scope",
        ),
        sa.CheckConstraint(
            "pass_kind IN ('extract', 'identify', 'verify', 'entailment')", name="pass_kind"
        ),
        sa.CheckConstraint("outcome IN ('ok', 'failed')", name="outcome"),
        sa.CheckConstraint("prompt_tokens >= 0", name="prompt_tokens_nonneg"),
        sa.CheckConstraint("completion_tokens >= 0", name="completion_tokens_nonneg"),
        schema="public",
    )
    op.create_index(
        "ix_ai_usage_ledger_project_created",
        "ai_usage_ledger",
        ["project_id", "created_at"],
        schema="public",
    )
    op.create_index(
        "ix_ai_usage_ledger_owner_created",
        "ai_usage_ledger",
        ["owner_id", "created_at"],
        schema="public",
    )
    for column in ("run_id", "attempt_id", "batch_id"):
        op.create_index(
            f"ix_ai_usage_ledger_{column}",
            "ai_usage_ledger",
            [column],
            schema="public",
            postgresql_where=sa.text(f"{column} IS NOT NULL"),
        )
    op.execute('ALTER TABLE "public"."ai_usage_ledger" ENABLE ROW LEVEL SECURITY;')
    op.execute('CREATE POLICY "deny_all" ON "public"."ai_usage_ledger" FOR ALL USING (false);')
    op.execute('REVOKE ALL ON "public"."ai_usage_ledger" FROM "authenticated", "anon";')


def downgrade() -> None:
    op.drop_table("ai_usage_ledger", schema="public")
