"""project is_phi

Revision ID: 0027_project_is_phi
Revises: 0026_widen_template_snapshot
Create Date: 2026-06-20

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0027_project_is_phi"
down_revision: str | None = "0026_widen_template_snapshot"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("is_phi", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("projects", "is_phi", schema="public")
