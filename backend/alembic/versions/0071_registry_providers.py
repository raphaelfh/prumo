"""Align ``user_api_keys.provider`` with the registry's five providers.

gemini and grok were storable as keys and buildable by nothing — no code
path ever turned them into a model. The registry (``app.llm.registry``)
is now the one list of providers, and the CHECK literal must equal it
(pinned by ``tests/unit/llm/test_registry.py``). No active users exist;
their rows are deleted, not migrated.

Revision ID: 0071_registry_providers
Revises: 0070_annotation_updated_at
"""

from alembic import op

revision = "0071_registry_providers"
down_revision = "0070_annotation_updated_at"
branch_labels = None
depends_on = None

_NEW = "provider IN ('openai', 'anthropic', 'google', 'openai_compatible', 'llama_cloud')"
_OLD = "provider IN ('openai', 'anthropic', 'gemini', 'grok', 'llama_cloud')"


def upgrade() -> None:
    op.execute("DELETE FROM public.user_api_keys WHERE provider IN ('gemini', 'grok')")
    op.execute(
        "ALTER TABLE public.user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check"
    )
    op.execute(
        f"ALTER TABLE public.user_api_keys ADD CONSTRAINT user_api_keys_provider_check CHECK ({_NEW})"
    )


def downgrade() -> None:
    # google and openai_compatible are not in the old CHECK's allow-list;
    # delete any rows before re-adding it, or the ADD CONSTRAINT would fail.
    op.execute("DELETE FROM public.user_api_keys WHERE provider IN ('google', 'openai_compatible')")
    op.execute(
        "ALTER TABLE public.user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check"
    )
    op.execute(
        f"ALTER TABLE public.user_api_keys ADD CONSTRAINT user_api_keys_provider_check CHECK ({_OLD})"
    )
