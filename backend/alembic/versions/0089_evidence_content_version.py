"""Evidence records the article version its position was anchored against.

``extraction_evidence.content_version`` is the ``article_files.content_version``
a grounded row's ``position`` was anchored against; NULL means unknown (a row
written before this column) and reads current. A reparse re-anchors the file's
grounded AI rows or leaves them stale (an older version than the file's).

A partial btree on ``article_file_id`` serves the per-file reparse read.
Nullable column, no data written; no grant or policy change (evidence writes
are backend-only since 0081).

Downgrade drops the index, then the column.

Revision ID: 0089_evidence_content_version
Revises: 0088_protocol_revision
"""

import sqlalchemy as sa

from alembic import op

revision = "0089_evidence_content_version"
down_revision = "0088_protocol_revision"
branch_labels = None
depends_on = None

_INDEX = "idx_extraction_evidence_article_file_id"


def upgrade() -> None:
    op.add_column(
        "extraction_evidence",
        sa.Column("content_version", sa.Integer(), nullable=True),
        schema="public",
    )
    op.create_index(
        _INDEX,
        "extraction_evidence",
        ["article_file_id"],
        schema="public",
        postgresql_where=sa.text("article_file_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(_INDEX, table_name="extraction_evidence", schema="public")
    op.drop_column("extraction_evidence", "content_version", schema="public")
