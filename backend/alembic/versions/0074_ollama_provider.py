"""Allow the ``ollama`` provider (Ollama Cloud) on ``llm_connections``.

The registry gained a hosted provider, so the provider CHECK and the
project-scope CHECK must name it (asserted equal to the registry at head by
``tests/integration/test_migration_roundtrip.py``). Literals, not registry
imports: a migration must never change meaning when app code moves on.

Revision ID: 0074_ollama_provider
Revises: 0073_drop_legacy_credentials
"""

from alembic import op

revision = "0074_ollama_provider"
down_revision = "0073_drop_legacy_credentials"
branch_labels = None
depends_on = None

_TABLE = "public.llm_connections"
_PROVIDER = "ck_llm_connections_provider_check"
_SCOPES = "ck_llm_connections_scopes_check"

_NEW_PROVIDER = (
    "provider IN ('openai', 'anthropic', 'google', 'ollama', 'openai_compatible', 'llama_cloud')"
)
_NEW_SCOPES = (
    "scope = 'user' OR provider IN ('openai', 'anthropic', 'google', 'ollama', 'llama_cloud')"
)
_OLD_PROVIDER = "provider IN ('openai', 'anthropic', 'google', 'openai_compatible', 'llama_cloud')"
_OLD_SCOPES = "scope = 'user' OR provider IN ('openai', 'anthropic', 'google', 'llama_cloud')"


def _replace_checks(provider: str, scopes: str) -> None:
    op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS {_PROVIDER}")
    op.execute(f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_PROVIDER} CHECK ({provider})")
    op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS {_SCOPES}")
    op.execute(f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_SCOPES} CHECK ({scopes})")


def upgrade() -> None:
    _replace_checks(_NEW_PROVIDER, _NEW_SCOPES)


def downgrade() -> None:
    # The old CHECK does not allow 'ollama': remove those connections first or
    # ADD CONSTRAINT fails. user_project_engines.connection_id is ON DELETE SET
    # NULL, so an engine pinned to one reads as retired rather than blocking.
    op.execute(f"DELETE FROM {_TABLE} WHERE provider = 'ollama'")
    _replace_checks(_OLD_PROVIDER, _OLD_SCOPES)
