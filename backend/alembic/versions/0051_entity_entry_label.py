"""Group entry noun: ``extraction_entity_types.entry_label`` (B-8).

The "prediction models" container becomes a generic repeating group
whose entry noun is data: ``entry_label`` (TEXT NULL, no CHECK, no
server_default) is interpolated into config-editor and run-view copy
("one entry per {noun}", "Add {noun}…"). It is meaningful only for
``role='model_container'`` rows; consumers fall back to ``'model'``
when NULL.

Backfill: one UPDATE stamps ``entry_label='model'`` WHERE
``role='model_container'`` — the noun every existing container
implicitly had. The predicate is deliberately role-only so it covers
BOTH lineages (global catalogue ``template_id IS NOT NULL`` and project
clones ``project_template_id IS NOT NULL``) in one statement; keep it
role-only. Re-running after a downgrade re-stamps the freshly re-added
column (the drop discarded the data), so the round trip is idempotent.

The backfill runs with ``trg_extraction_entity_types_mark_draft``
DISABLED (the 0048 docstring WARNING: an every-row backfill would
stamp ``config_draft_since`` on EVERY project template, flipping every
chip to "Unpublished changes" and 409-ing drift-path re-imports). The
stamped value matches what publish would snapshot anyway — this is
backfill noise, not user drift (contrast 0050's heal, which kept the
trigger enabled because renames are genuine drift).

Migration 0026's embedded snapshot SQL is intentionally NOT touched:
the column post-dates 0026's slot in the chain, so referencing it there
would break a fresh-DB ``upgrade head`` with UndefinedColumn at 0026
(exemption precedent: ``llm_template_instruction``, see the
``extraction_snapshot.py`` docstring). The live snapshot builder gains
the key separately (B-8 T2).

Downgrade drops the column.

Revision ID: 0051_entity_entry_label
Revises: 0050_field_name_unique_heal
"""

import sqlalchemy as sa

from alembic import op

revision = "0051_entity_entry_label"
down_revision = "0050_field_name_unique_heal"
branch_labels = None
depends_on = None

_TRIGGER = "trg_extraction_entity_types_mark_draft"


def upgrade() -> None:
    op.add_column(
        "extraction_entity_types",
        sa.Column("entry_label", sa.String(), nullable=True),
        schema="public",
    )
    # Every-row-backfill DML: keep the 0048 draft marker quiet (see docstring).
    op.execute(f"ALTER TABLE public.extraction_entity_types DISABLE TRIGGER {_TRIGGER}")
    op.execute(
        "UPDATE public.extraction_entity_types "
        "SET entry_label = 'model' "
        "WHERE role = 'model_container'"
    )
    op.execute(f"ALTER TABLE public.extraction_entity_types ENABLE TRIGGER {_TRIGGER}")


def downgrade() -> None:
    op.drop_column("extraction_entity_types", "entry_label", schema="public")
