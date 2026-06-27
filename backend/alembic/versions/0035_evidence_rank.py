"""evidence rank

Revision ID: 0035_evidence_rank
Revises: 0034_evidence_attr_label
Create Date: 2026-06-27

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0035_evidence_rank"
down_revision = "0034_evidence_attr_label"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "extraction_evidence",
        sa.Column("rank", sa.Integer(), server_default="0", nullable=False),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("extraction_evidence", "rank", schema="public")
