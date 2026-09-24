"""Create agent_actions (spec §6.1).

Every MCP write tool records one append-only row per applied write and
per domain-rule refusal (constitution §IX traceability). ``token_id``,
``user_id`` and ``template_id`` are nullable and ``ON DELETE SET NULL``:
the audit row outlives the token, profile or template it referenced.
``project_id`` is ``ON DELETE CASCADE``: a deleted project takes its
audit trail with it, since there is nothing left to audit.

Backend-only table with the 0072 ``deny_all`` posture: RLS enabled, a
single ``deny_all`` policy, and every privilege revoked from
``authenticated`` / ``anon``. The backend's own role owns the table and
bypasses RLS; there is no PostgREST read path for audit rows.

Revision ID: 0079_agent_actions
Revises: 0078_personal_access_tokens
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision = "0079_agent_actions"
down_revision = "0078_personal_access_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_actions",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "token_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.personal_access_tokens.id",
                ondelete="SET NULL",
                name="agent_actions_token_id_fkey",
            ),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.profiles.id",
                ondelete="SET NULL",
                name="agent_actions_user_id_fkey",
            ),
            nullable=True,
        ),
        sa.Column(
            "project_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.projects.id",
                ondelete="CASCADE",
                name="agent_actions_project_id_fkey",
            ),
            nullable=False,
        ),
        sa.Column(
            "template_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.project_extraction_templates.id",
                ondelete="SET NULL",
                name="agent_actions_template_id_fkey",
            ),
            nullable=True,
        ),
        sa.Column("tool", sa.Text(), nullable=False),
        sa.Column("input", JSONB(), nullable=False),
        sa.Column("before", JSONB(), nullable=True),
        sa.Column("after", JSONB(), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.CheckConstraint("octet_length(input::text) <= 65536", name="input_size_check"),
        sa.CheckConstraint("outcome IN ('applied', 'refused')", name="outcome_check"),
        sa.CheckConstraint("(outcome = 'applied') = (error_code IS NULL)", name="error_code_check"),
        schema="public",
    )
    op.create_index(
        "ix_agent_actions_template_applied",
        "agent_actions",
        ["template_id", "created_at"],
        schema="public",
        postgresql_where=sa.text("outcome = 'applied'"),
    )
    for column in ("project_id", "token_id", "user_id"):
        op.create_index(f"ix_agent_actions_{column}", "agent_actions", [column], schema="public")
    op.execute('ALTER TABLE "public"."agent_actions" ENABLE ROW LEVEL SECURITY;')
    op.execute('CREATE POLICY "deny_all" ON "public"."agent_actions" FOR ALL USING (false);')
    op.execute('REVOKE ALL ON "public"."agent_actions" FROM "authenticated", "anon";')


def downgrade() -> None:
    op.drop_table("agent_actions", schema="public")
