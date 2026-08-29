"""extraction_fields: add allows_no_information

The third ADR-0016 disposition flag. ``no_information`` shipped as UNIVERSAL —
hardcoded in ``FieldInput`` while its ``not_applicable`` / ``not_evaluated``
siblings were per-field opt-ins (migration 0038). PROBAST+AI 2.1.0 puts the
instrument's own "NI" back into the signaling answer set, where a separate
marker button would duplicate the scale; the flag is what turns the button off
on exactly those fields, making all three dispositions uniformly flag-gated.

Unlike its siblings the server_default is ``true``: every existing field was
markable before this migration, and a backfill to ``false`` would silently
retire the affordance app-wide. Same reason the absent-key default is ``true``
in ``template_diff.FIELD_ATTRIBUTE_DEFAULTS`` and in every wire schema.

Revision ID: 0062_allows_no_information
Revises: 0061_rls_initplan_config_reads
Create Date: 2026-08-29

"""

import sqlalchemy as sa

from alembic import op

revision = "0062_allows_no_information"
down_revision = "0061_rls_initplan_config_reads"
branch_labels = None
depends_on = None

_TABLE = "extraction_fields"


def upgrade() -> None:
    op.add_column(
        _TABLE,
        sa.Column(
            "allows_no_information",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column(_TABLE, "allows_no_information")
