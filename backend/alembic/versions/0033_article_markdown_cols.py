"""article_files: add content_markdown + content_version; drop dead text_raw/text_html.

Revision ID: 0033_article_markdown_cols
Revises: 0032_optional_rationale
Create Date: 2026-06-24
"""

import sqlalchemy as sa

from alembic import op

revision = "0033_article_markdown_cols"
down_revision = "0032_optional_rationale"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "article_files",
        sa.Column("content_markdown", sa.Text(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_files",
        sa.Column(
            "content_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        schema="public",
    )
    op.drop_column("article_files", "text_raw", schema="public")
    op.drop_column("article_files", "text_html", schema="public")


def downgrade() -> None:
    op.add_column(
        "article_files",
        sa.Column("text_html", sa.Text(), nullable=True),
        schema="public",
    )
    op.add_column(
        "article_files",
        sa.Column("text_raw", sa.Text(), nullable=True),
        schema="public",
    )
    op.drop_column("article_files", "content_version", schema="public")
    op.drop_column("article_files", "content_markdown", schema="public")
