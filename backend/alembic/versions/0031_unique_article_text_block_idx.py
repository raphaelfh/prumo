"""unique (article_file_id, page_number, block_index) on article_text_blocks

Revision ID: 0031_unique_atb_idx
Revises: 0030_drop_instance_status
Create Date: 2026-06-22

Makes concurrent re-parse tasks (delete-then-insert) fail loudly instead
of silently duplicating rows for the same (article_file_id, page, block_index).
The non-unique index created in 0006 is replaced by a UNIQUE one on the same
columns, preserving ordered-read performance.
"""

from alembic import op

revision = "0031_unique_atb_idx"
down_revision = "0030_drop_instance_status"
branch_labels = None
depends_on = None

_OLD_INDEX = "idx_article_text_blocks_file_page_block"  # from 0006
_UQ = "uq_article_text_blocks_file_page_block"


def upgrade() -> None:
    # 1. Collapse any pre-existing duplicates (keep one row per triple) so the
    #    constraint can be created. Concurrent parses before this migration may
    #    have produced dups.
    op.execute(
        """
        DELETE FROM article_text_blocks a
        USING article_text_blocks b
        WHERE a.ctid < b.ctid
          AND a.article_file_id = b.article_file_id
          AND a.page_number = b.page_number
          AND a.block_index = b.block_index
        """
    )
    # 2. Replace the non-unique read index with a UNIQUE one (same columns, so
    #    ordered reads keep their index).
    op.drop_index(_OLD_INDEX, table_name="article_text_blocks")
    op.create_index(
        _UQ,
        "article_text_blocks",
        ["article_file_id", "page_number", "block_index"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(_UQ, table_name="article_text_blocks")
    op.create_index(
        _OLD_INDEX,
        "article_text_blocks",
        ["article_file_id", "page_number", "block_index"],
        unique=False,
    )
