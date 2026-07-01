"""extraction_fields: add allows_not_applicable / allows_not_evaluated

Opt-in "no value, on purpose" disposition flags (ADR-0016 Phase 2).
``no_information`` is universal and needs no flag; ``not_applicable`` /
``not_evaluated`` are per-field opt-ins surfaced in the template builder and the
runtime FieldInput affordance, and propagated into the frozen version snapshot.

Both columns are NOT NULL with a ``false`` server_default so existing rows
backfill cleanly (same pattern as 0035_evidence_rank).

Revision ID: 0038_field_disposition_flags
Revises: 0037_block_type_figure
Create Date: 2026-07-01

"""

import sqlalchemy as sa

from alembic import op

revision = "0038_field_disposition_flags"
down_revision = "0037_block_type_figure"
branch_labels = None
depends_on = None

_TABLE = "extraction_fields"


def upgrade() -> None:
    op.add_column(
        _TABLE,
        sa.Column(
            "allows_not_applicable",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        _TABLE,
        sa.Column(
            "allows_not_evaluated",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column(_TABLE, "allows_not_evaluated")
    op.drop_column(_TABLE, "allows_not_applicable")
