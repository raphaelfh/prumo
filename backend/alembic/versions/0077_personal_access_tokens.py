"""Create personal_access_tokens (spec §4.1, ADR 0020).

A second auth carrier for the ``/mcp`` mount: a header-capable researcher
client presents a long-lived bearer secret instead of a Supabase JWT. Only
the SHA-256 hash of the secret is stored — the plaintext is shown once at
creation and never persisted — so a leaked row cannot be replayed into a
credential, only compared against.

Backend-only table with the 0072 ``deny_all`` posture: RLS enabled, a
single ``deny_all`` policy, and every privilege revoked from
``authenticated`` / ``anon``. The backend's own role owns the table and
bypasses RLS; there is no PostgREST read path for token rows.

Revision ID: 0077_personal_access_tokens
Revises: 0076_extraction_batches
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision = "0077_personal_access_tokens"
down_revision = "0076_extraction_batches"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "personal_access_tokens",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.profiles.id",
                ondelete="CASCADE",
                name="personal_access_tokens_user_id_fkey",
            ),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("token_prefix", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 80", name="name_check"),
        sa.CheckConstraint("scope IN ('read', 'read_write')", name="scope_check"),
        sa.CheckConstraint(
            "expires_at > created_at AND expires_at <= created_at + interval '365 days'",
            name="expires_at_check",
        ),
        sa.UniqueConstraint("token_hash", name="personal_access_tokens_token_hash_key"),
        schema="public",
    )
    op.create_index(
        "ix_personal_access_tokens_active_user",
        "personal_access_tokens",
        ["user_id"],
        schema="public",
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.execute('ALTER TABLE "public"."personal_access_tokens" ENABLE ROW LEVEL SECURITY;')
    op.execute(
        'CREATE POLICY "deny_all" ON "public"."personal_access_tokens" FOR ALL USING (false);'
    )
    op.execute('REVOKE ALL ON "public"."personal_access_tokens" FROM "authenticated", "anon";')


def downgrade() -> None:
    op.drop_table("personal_access_tokens", schema="public")
