"""article_text_blocks block_type: add 'figure'

Revision ID: 0037_block_type_figure
Revises: 0036_text_block_cell_grid
Create Date: 2026-06-28

"""

from alembic import op

revision = "0037_block_type_figure"
down_revision = "0036_text_block_cell_grid"
branch_labels = None
depends_on = None

_CONSTRAINT = "article_text_blocks_block_type_valid"
_TABLE = "public.article_text_blocks"

_TYPES_WITH_FIGURE = (
    "'paragraph', 'heading', 'list_item', 'table_cell', "
    "'figure_caption', 'header', 'footer', 'figure'"
)
_TYPES_BASELINE = (
    "'paragraph', 'heading', 'list_item', 'table_cell', 'figure_caption', 'header', 'footer'"
)


def upgrade() -> None:
    op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT {_CONSTRAINT}")
    op.execute(
        f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_CONSTRAINT} "
        f"CHECK (block_type IN ({_TYPES_WITH_FIGURE}))"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT {_CONSTRAINT}")
    op.execute(
        f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_CONSTRAINT} "
        f"CHECK (block_type IN ({_TYPES_BASELINE}))"
    )
