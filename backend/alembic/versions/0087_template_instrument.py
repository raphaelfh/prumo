"""Stable instrument code on both template tables.

``instrument`` names the appraisal instrument a template implements
(``charms``, ``charms_mm``, ``probast``, ``probast_ai``, ``quadas2``) or
``custom``. It is set by the seed on the globals and copied on clone, so a
quality-assessment prompt names the instrument from the code rather than
from a template name a manager can edit.

``text NOT NULL DEFAULT 'custom'`` plus a CHECK on the closed set. No data
is written here: the seed converges the globals and their clones.

Downgrade drops the CHECKs and the columns.

Revision ID: 0087_template_instrument
Revises: 0086_evidence_idx_hitl_fk
"""

import sqlalchemy as sa

from alembic import op

revision = "0087_template_instrument"
down_revision = "0086_evidence_idx_hitl_fk"
branch_labels = None
depends_on = None

_TABLES = ("extraction_templates_global", "project_extraction_templates")

# SHORT constraint name: the naming convention expands it to
# ck_<table>_instrument.
_CONSTRAINT = "instrument"
_CHECK = "instrument IN ('charms', 'charms_mm', 'probast', 'probast_ai', 'quadas2', 'custom')"


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column("instrument", sa.Text(), nullable=False, server_default=sa.text("'custom'")),
            schema="public",
        )
        op.create_check_constraint(_CONSTRAINT, table, _CHECK, schema="public")


def downgrade() -> None:
    for table in _TABLES:
        op.drop_constraint(_CONSTRAINT, table, type_="check", schema="public")
        op.drop_column(table, "instrument", schema="public")
