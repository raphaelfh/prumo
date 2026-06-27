"""evidence attribution_label

Revision ID: 0034_evidence_attr_label
Revises: 0033_article_markdown_cols
Create Date: 2026-06-27

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0034_evidence_attr_label"
down_revision = "0033_article_markdown_cols"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "extraction_evidence",
        sa.Column("attribution_label", sa.Text(), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("extraction_evidence", "attribution_label", schema="public")
