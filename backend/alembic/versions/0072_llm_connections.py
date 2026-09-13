"""Create llm_connections and user_project_engines (spec §2, §3.1).

One table replaces ``user_api_keys`` (owner-readable through PostgREST —
a user's ciphertext reached the browser) and ``project_llm_endpoints``:
a connection is a provider, a credential and, for a host-bearing
provider, a host. ``user_project_engines`` holds each member's own engine
for new runs; no row means "follow the project default".

Both are SECRETS/decision tables with the ``project_llm_endpoints``
posture (migration 0055): RLS enabled, ``deny_all`` policy, every
privilege revoked from ``authenticated`` and ``anon``. The backend's own
role owns them and bypasses RLS.

The old tables are dropped by 0073 once every reader has moved; this
revision is additive so each task of the slice-2 plan stays green.

Revision ID: 0072_llm_connections
Revises: 0071_registry_providers
Create Date: 2026-09-13
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision = "0072_llm_connections"
down_revision = "0071_registry_providers"
branch_labels = None
depends_on = None

# Literals, not registry imports: a migration must never change meaning
# when app code moves on. tests/integration/test_migration_roundtrip.py
# asserts the live CHECK equals the registry at head.
#
# CHECK names are SHORT: env.py hands Base.metadata's naming convention to
# alembic, so op.create_table expands "provider_check" to
# ck_llm_connections_provider_check — the same name the model declares.
_PROVIDER_CHECK = (
    "provider IN ('openai', 'anthropic', 'google', 'openai_compatible', 'llama_cloud')"
)
_SCOPES_CHECK = "scope = 'user' OR provider IN ('openai', 'anthropic', 'google', 'llama_cloud')"
_BASE_URL_CHECK = (
    "((base_url IS NOT NULL) = (provider IN ('openai_compatible'))) "
    "AND (base_url IS NULL OR scope = 'user')"
)


def _deny_all(table: str) -> None:
    op.execute(f'ALTER TABLE "public"."{table}" ENABLE ROW LEVEL SECURITY;')
    op.execute(f'CREATE POLICY "deny_all" ON "public"."{table}" FOR ALL USING (false);')
    op.execute(f'REVOKE ALL ON "public"."{table}" FROM "authenticated", "anon";')


def upgrade() -> None:
    op.create_table(
        "llm_connections",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column(
            "user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.profiles.id", ondelete="CASCADE", name="llm_connections_user_id_fkey"
            ),
            nullable=True,
        ),
        sa.Column(
            "project_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.projects.id", ondelete="CASCADE", name="llm_connections_project_id_fkey"
            ),
            nullable=True,
        ),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("base_url", sa.Text(), nullable=True),
        sa.Column("encrypted_api_key", sa.Text(), nullable=True),
        sa.Column("allowed_models", JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("capabilities", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("validation_status", sa.Text(), server_default="unverified", nullable=False),
        sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.profiles.id", ondelete="RESTRICT", name="llm_connections_created_by_fkey"
            ),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(_PROVIDER_CHECK, name="provider_check"),
        sa.CheckConstraint(_SCOPES_CHECK, name="scopes_check"),
        sa.CheckConstraint("scope IN ('user', 'project')", name="scope_check"),
        sa.CheckConstraint(
            "(scope = 'user' AND user_id IS NOT NULL AND project_id IS NULL) "
            "OR (scope = 'project' AND project_id IS NOT NULL AND user_id IS NULL)",
            name="owner_check",
        ),
        sa.CheckConstraint(_BASE_URL_CHECK, name="base_url_check"),
        sa.CheckConstraint("char_length(label) BETWEEN 1 AND 80", name="label_check"),
        sa.CheckConstraint(
            "validation_status IN ('unverified', 'ok', 'failed')",
            name="validation_status_check",
        ),
        schema="public",
    )
    op.create_index(
        "ix_public_llm_connections_user_id", "llm_connections", ["user_id"], schema="public"
    )
    op.create_index(
        "ix_public_llm_connections_project_id", "llm_connections", ["project_id"], schema="public"
    )
    op.create_index(
        "uq_llm_connections_user_identity",
        "llm_connections",
        ["user_id", "provider", "label"],
        unique=True,
        schema="public",
        postgresql_where=sa.text("scope = 'user'"),
    )
    op.create_index(
        "uq_llm_connections_project_identity",
        "llm_connections",
        ["project_id", "provider", "label"],
        unique=True,
        schema="public",
        postgresql_where=sa.text("scope = 'project'"),
    )
    op.create_index(
        "uq_llm_connections_user_hosted_provider",
        "llm_connections",
        ["user_id", "provider"],
        unique=True,
        schema="public",
        postgresql_where=sa.text("scope = 'user' AND base_url IS NULL"),
    )
    _deny_all("llm_connections")

    op.create_table(
        "user_project_engines",
        sa.Column(
            "user_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.profiles.id", ondelete="CASCADE", name="user_project_engines_user_id_fkey"
            ),
            primary_key=True,
        ),
        sa.Column(
            "project_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.projects.id",
                ondelete="CASCADE",
                name="user_project_engines_project_id_fkey",
            ),
            primary_key=True,
        ),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column(
            "connection_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.llm_connections.id",
                ondelete="SET NULL",
                name="user_project_engines_connection_id_fkey",
            ),
            nullable=True,
        ),
        sa.Column("mode", sa.Text(), server_default="fast", nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("mode IN ('fast', 'verified')", name="mode_check"),
        schema="public",
    )
    _deny_all("user_project_engines")


def downgrade() -> None:
    # Policies, indexes and constraints fall with their tables.
    op.drop_table("user_project_engines", schema="public")
    op.drop_table("llm_connections", schema="public")
