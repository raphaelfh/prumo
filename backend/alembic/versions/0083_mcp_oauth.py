"""Storage for OAuth connections to the MCP server (ADR 0022).

``personal_access_tokens`` gains ``kind``: ``'pat'`` (a personal access
token, as before) or ``'oauth'`` (one OAuth connection of a user to a
registered client, carrying the connection's scope, expiry and revocation).
An OAuth row stores no secret of its own (``token_hash`` / ``token_prefix``
are NULL; ``kind_shape_check`` enforces the split) and names its client in
``oauth_client_id``. At most one unrevoked connection per user × client.

Three new tables:

- ``mcp_oauth_clients``: clients registered through dynamic client
  registration (name, redirect URIs, registered scopes).
- ``mcp_oauth_requests``: pending authorization requests awaiting the
  user's consent, and the authorization code minted once one is approved.
- ``mcp_oauth_tokens``: access and refresh tokens issued for a connection.

All three are backend-only with the 0078 posture: RLS enabled, a single
``deny_all`` policy, every privilege revoked from ``authenticated`` /
``anon``. Codes and tokens are stored only as their SHA-256 hex digest.

``downgrade`` deletes every OAuth connection first (their requests and
tokens cascade). ``agent_actions`` rows written through an OAuth connection
survive, but the existing ``ON DELETE SET NULL`` clears their ``token_id``:
credential attribution (including the draft label) is lost for those rows.

Revision ID: 0083_mcp_oauth
Revises: 0082_pat_project_scope
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision = "0083_mcp_oauth"
down_revision = "0082_pat_project_scope"
branch_labels = None
depends_on = None

_PAT = "personal_access_tokens"
_NEW_TABLES = ("mcp_oauth_clients", "mcp_oauth_requests", "mcp_oauth_tokens")
# SHORT names: the "ck" convention expands them to ck_personal_access_tokens_<name>.
_KIND_CHECK = "kind_check"
_SHAPE_CHECK = "kind_shape_check"
_CLIENT_FK = "personal_access_tokens_oauth_client_id_fkey"
_UQ_USER_CLIENT = "uq_personal_access_tokens_oauth_user_client"
_IX_CLIENT = "ix_personal_access_tokens_oauth_client"


def _deny_all(table: str) -> None:
    op.execute(f'ALTER TABLE "public"."{table}" ENABLE ROW LEVEL SECURITY;')
    op.execute(f'CREATE POLICY "deny_all" ON "public"."{table}" FOR ALL USING (false);')
    op.execute(f'REVOKE ALL ON "public"."{table}" FROM "authenticated", "anon";')


def upgrade() -> None:
    op.create_table(
        "mcp_oauth_clients",
        sa.Column("client_id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("client_name", sa.Text(), nullable=False),
        sa.Column("redirect_uris", pg.ARRAY(sa.Text()), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("char_length(client_name) BETWEEN 1 AND 80", name="client_name_check"),
        sa.CheckConstraint(
            "cardinality(redirect_uris) BETWEEN 1 AND 5", name="redirect_uris_check"
        ),
        schema="public",
    )

    op.add_column(
        _PAT,
        sa.Column("kind", sa.Text(), server_default=sa.text("'pat'"), nullable=False),
        schema="public",
    )
    op.add_column(
        _PAT,
        sa.Column(
            "oauth_client_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey(
                "public.mcp_oauth_clients.client_id", ondelete="CASCADE", name=_CLIENT_FK
            ),
            nullable=True,
        ),
        schema="public",
    )
    for column in ("token_hash", "token_prefix"):
        op.alter_column(_PAT, column, existing_type=sa.Text(), nullable=True, schema="public")
    op.create_check_constraint(_KIND_CHECK, _PAT, "kind IN ('pat', 'oauth')", schema="public")
    op.create_check_constraint(
        _SHAPE_CHECK,
        _PAT,
        "(kind = 'pat' AND token_hash IS NOT NULL AND token_prefix IS NOT NULL"
        " AND oauth_client_id IS NULL)"
        " OR (kind = 'oauth' AND oauth_client_id IS NOT NULL AND token_hash IS NULL"
        " AND token_prefix IS NULL)",
        schema="public",
    )
    op.create_index(
        _UQ_USER_CLIENT,
        _PAT,
        ["user_id", "oauth_client_id"],
        unique=True,
        schema="public",
        postgresql_where=sa.text("kind = 'oauth' AND revoked_at IS NULL"),
    )
    op.create_index(
        _IX_CLIENT,
        _PAT,
        ["oauth_client_id"],
        schema="public",
        postgresql_where=sa.text("oauth_client_id IS NOT NULL"),
    )

    op.create_table(
        "mcp_oauth_requests",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "client_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("public.mcp_oauth_clients.client_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("redirect_uri_provided_explicitly", sa.Boolean(), nullable=False),
        sa.Column("code_challenge", sa.Text(), nullable=False),
        sa.Column("state", sa.Text(), nullable=True),
        sa.Column("requested_scopes", pg.ARRAY(sa.Text()), nullable=False),
        sa.Column("resource", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "user_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("public.profiles.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "connection_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("public.personal_access_tokens.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("code_hash", sa.Text(), nullable=True, unique=True),
        sa.Column("code_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("code_used_at", sa.DateTime(timezone=True), nullable=True),
        schema="public",
    )
    op.create_index(
        "ix_mcp_oauth_requests_client_id", "mcp_oauth_requests", ["client_id"], schema="public"
    )
    op.create_index(
        "ix_mcp_oauth_requests_connection_id",
        "mcp_oauth_requests",
        ["connection_id"],
        schema="public",
    )

    op.create_table(
        "mcp_oauth_tokens",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "connection_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("public.personal_access_tokens.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("resource", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('access', 'refresh')", name="kind_check"),
        schema="public",
    )
    op.create_index(
        "ix_mcp_oauth_tokens_connection_id", "mcp_oauth_tokens", ["connection_id"], schema="public"
    )

    for table in _NEW_TABLES:
        _deny_all(table)


def downgrade() -> None:
    # OAuth connections cannot exist without `kind`; their requests and tokens cascade.
    op.execute("DELETE FROM public.personal_access_tokens WHERE kind = 'oauth'")
    op.drop_index(_IX_CLIENT, table_name=_PAT, schema="public")
    op.drop_index(_UQ_USER_CLIENT, table_name=_PAT, schema="public")
    for check in (_SHAPE_CHECK, _KIND_CHECK):
        op.drop_constraint(
            op.f(f"ck_personal_access_tokens_{check}"), _PAT, type_="check", schema="public"
        )
    op.drop_constraint(_CLIENT_FK, _PAT, type_="foreignkey", schema="public")
    op.drop_column(_PAT, "oauth_client_id", schema="public")
    op.drop_column(_PAT, "kind", schema="public")
    for column in ("token_hash", "token_prefix"):
        op.alter_column(_PAT, column, existing_type=sa.Text(), nullable=False, schema="public")
    for table in reversed(_NEW_TABLES):
        op.drop_table(table, schema="public")
