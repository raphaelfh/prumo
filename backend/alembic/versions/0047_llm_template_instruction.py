"""Add llm_template_instruction to both template tables (spec Phase A).

Nullable TEXT + CHECK <= 4000 chars. No backfill: absent ≡ NULL by
design — the snapshot builder emits the key only when non-NULL, so
legacy templates republish byte-identically (no phantom v+1).

Downgrade restores the schema only, not the data: manager-authored
instruction text is dropped with the column (0033/0042 philosophy).

Revision ID: 0047_llm_template_instruction
Revises: 0046_revoke_min_mgr_exec
"""

import sqlalchemy as sa

from alembic import op

revision = "0047_llm_template_instruction"
down_revision = "0046_revoke_min_mgr_exec"
branch_labels = None
depends_on = None

_TABLES = ("extraction_templates_global", "project_extraction_templates")

# SHORT constraint name: the metadata naming convention (propagated into
# op.* by env.py) expands it to ck_<table>_llm_instruction_len. Passing a
# pre-expanded ck_ literal would double-wrap and md5-truncate silently.
_CONSTRAINT = "llm_instruction_len"


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column("llm_template_instruction", sa.Text(), nullable=True),
            schema="public",
        )
        op.create_check_constraint(
            _CONSTRAINT,
            table,
            "char_length(llm_template_instruction) <= 4000",
            schema="public",
        )


def downgrade() -> None:
    for table in _TABLES:
        op.drop_constraint(_CONSTRAINT, table, type_="check", schema="public")
        op.drop_column(table, "llm_template_instruction", schema="public")
