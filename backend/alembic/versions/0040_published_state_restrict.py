"""Protect published rows: instance FK CASCADE -> deferred NO ACTION.

An ``extraction_instances`` DELETE arrives PostgREST-direct (no API stage
guard); with CASCADE it silently destroyed ``extraction_published_states``
rows — the canonical published record — and could leave a FINALIZED run
with zero published rows (``advance_stage`` invariant, constitution §IX
append-only).

Why DEFERRABLE INITIALLY DEFERRED NO ACTION instead of RESTRICT: the
schema has a cascade diamond — ``articles → extraction_instances``
(CASCADE) and ``articles → extraction_runs → extraction_published_states``
(CASCADE) — and Postgres fires the instances branch first. RESTRICT is
checked immediately per cascaded row, so a plain RESTRICT aborts every
legitimate article/project delete that ever had a published run
(reproduced empirically in the 2026-07-02 hardening review). A deferred
NO ACTION check runs at COMMIT instead: by then the runs branch has
cascaded the published rows away, so article/project deletes pass —
while a bare PostgREST instance DELETE still fails at its own
transaction commit (PostgREST wraps each request in a transaction),
keeping the published record undestructible from the client.

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
        "ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED"
    )


def downgrade() -> None:
    op.execute(f'ALTER TABLE {_TABLE} DROP CONSTRAINT "{_FK}"')
    op.execute(
        f'ALTER TABLE {_TABLE} ADD CONSTRAINT "{_FK}" '
        'FOREIGN KEY ("instance_id") '
        'REFERENCES "public"."extraction_instances"("id") '
        "ON DELETE CASCADE"
    )
