"""api key llama_cloud

Revision ID: 0027_api_key_llama_cloud
Revises: 0026_widen_template_snapshot
Create Date: 2026-06-20

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0027_api_key_llama_cloud"
down_revision = "0026_widen_template_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE public.user_api_keys DROP CONSTRAINT user_api_keys_provider_check")
    op.execute(
        "ALTER TABLE public.user_api_keys ADD CONSTRAINT user_api_keys_provider_check "
        "CHECK (provider IN ('openai', 'anthropic', 'gemini', 'grok', 'llama_cloud'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE public.user_api_keys DROP CONSTRAINT user_api_keys_provider_check")
    op.execute(
        "ALTER TABLE public.user_api_keys ADD CONSTRAINT user_api_keys_provider_check "
        "CHECK (provider IN ('openai', 'anthropic', 'gemini', 'grok'))"
    )
