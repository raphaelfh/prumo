"""Protect published rows: instance FK CASCADE -> RESTRICT.

An ``extraction_instances`` DELETE arrives PostgREST-direct (no API stage
guard); with CASCADE it silently destroyed ``extraction_published_states``
rows — the canonical published record — and could leave a FINALIZED run
with zero published rows (``advance_stage`` invariant, constitution §IX
append-only). With RESTRICT a published instance becomes undeletable;
deleting a never-published instance still works.

The baseline ships this FK under its Postgres-default literal name, so
both directions use raw SQL with that literal — routing through
``op.create_foreign_key`` would apply the naming convention and mangle
the name, breaking downgrade (see the constraint-naming convention note
in docs/reference/migrations.md).

Revision ID: 0040_published_state_restrict
Revises: 0039_absent_reason_backfill
"""

from alembic import op

revision = "0040_published_state_restrict"
down_revision = "0039_absent_reason_backfill"
branch_labels = None
depends_on = None

_FK = "extraction_published_states_instance_id_fkey"
_TABLE = "public.extraction_published_states"


def upgrade() -> None:
    op.execute(f'ALTER TABLE {_TABLE} DROP CONSTRAINT "{_FK}"')
    op.execute(
        f'ALTER TABLE {_TABLE} ADD CONSTRAINT "{_FK}" '
        'FOREIGN KEY ("instance_id") '
        'REFERENCES "public"."extraction_instances"("id") '
        "ON DELETE RESTRICT"
    )


def downgrade() -> None:
    op.execute(f'ALTER TABLE {_TABLE} DROP CONSTRAINT "{_FK}"')
    op.execute(
        f'ALTER TABLE {_TABLE} ADD CONSTRAINT "{_FK}" '
        'FOREIGN KEY ("instance_id") '
        'REFERENCES "public"."extraction_instances"("id") '
        "ON DELETE CASCADE"
    )
