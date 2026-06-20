"""api key llama_cloud

Revision ID: 0028_api_key_llama_cloud
Revises: 0027_project_is_phi
Create Date: 2026-06-20

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0028_api_key_llama_cloud"
down_revision: str | None = "0027_project_is_phi"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("user_api_keys_provider_check", "user_api_keys", schema="public")
    op.create_check_constraint(
        "user_api_keys_provider_check",
        "user_api_keys",
        "provider IN ('openai', 'anthropic', 'gemini', 'grok', 'llama_cloud')",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint("user_api_keys_provider_check", "user_api_keys", schema="public")
    op.create_check_constraint(
        "user_api_keys_provider_check",
        "user_api_keys",
        "provider IN ('openai', 'anthropic', 'gemini', 'grok')",
        schema="public",
    )
