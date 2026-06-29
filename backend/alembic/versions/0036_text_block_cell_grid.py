"""article_text_blocks native cell grid

Revision ID: 0036_text_block_cell_grid
Revises: 0035_evidence_rank
Create Date: 2026-06-28

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0036_text_block_cell_grid"
down_revision = "0035_evidence_rank"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "article_text_blocks",
        sa.Column("row_index", sa.Integer(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_text_blocks",
        sa.Column("col_index", sa.Integer(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_text_blocks",
        sa.Column("row_span", sa.Integer(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_text_blocks",
        sa.Column("col_span", sa.Integer(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_text_blocks",
        sa.Column("is_header", sa.Boolean(), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("article_text_blocks", "is_header", schema="public")
    op.drop_column("article_text_blocks", "col_span", schema="public")
    op.drop_column("article_text_blocks", "row_span", schema="public")
    op.drop_column("article_text_blocks", "col_index", schema="public")
    op.drop_column("article_text_blocks", "row_index", schema="public")
