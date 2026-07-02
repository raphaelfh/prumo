"""drop dead article blob columns

Drops the three dead BLOB columns from public.articles (spec
2026-06-20-parse-to-markdown-end-to-end-design, decision 2):
``pdf_extracted_text`` (legacy raw pypdf dump, superseded by
``article_text_blocks`` + ``article_files.content_markdown``),
``semantic_abstract_text`` (redundant with ``articles.abstract``)
and ``semantic_fulltext_text``. None has a live consumer.

Revision ID: 0042_drop_article_blob_columns
Revises: 0041_reviewer_ready_select_rls
Create Date: 2026-07-02

"""

import sqlalchemy as sa

from alembic import op

revision = "0042_drop_article_blob_columns"
down_revision = "0041_reviewer_ready_select_rls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("articles", "pdf_extracted_text")
    op.drop_column("articles", "semantic_abstract_text")
    op.drop_column("articles", "semantic_fulltext_text")


def downgrade() -> None:
    # Structural reverse only — the dropped text payloads are not recoverable.
    op.add_column("articles", sa.Column("semantic_fulltext_text", sa.Text(), nullable=True))
    op.add_column("articles", sa.Column("semantic_abstract_text", sa.Text(), nullable=True))
    op.add_column("articles", sa.Column("pdf_extracted_text", sa.Text(), nullable=True))
