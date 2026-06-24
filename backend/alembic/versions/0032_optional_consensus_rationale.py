"""Relax consensus manual_override CHECK: rationale optional

Revision ID: 0032_optional_rationale
Revises: 0031_unique_atb_idx
Create Date: 2026-06-24

Phase B (decision F) of the consensus-view rework: a consensus
``manual_override`` needs only a ``value`` — the ``rationale`` becomes
optional. Relaxes the DB CHECK ``manual_override_complete`` on
``public.extraction_consensus_decisions`` from
``value IS NOT NULL AND rationale IS NOT NULL`` to ``value IS NOT NULL``.

Autogenerate does not detect CHECK-constraint *expression* changes, so this
migration is hand-written. The service guard in ``ExtractionConsensusService``
is relaxed in lockstep so the two enforcement points stay identical.

Reversibility caveat: ``downgrade`` recreates the stricter constraint. If any
``manual_override`` rows were written with ``rationale IS NULL`` after this
migration, recreating the strict CHECK will fail (those rows violate it). That
is the expected, documented limitation of relaxing a constraint — backfill or
delete the NULL-rationale rows before downgrading in production.
"""

from alembic import op

revision = "0032_optional_rationale"
down_revision = "0031_unique_atb_idx"
branch_labels = None
depends_on = None

_TABLE = "extraction_consensus_decisions"
_CONSTRAINT = "manual_override_complete"
_NEW_EXPR = "mode <> 'manual_override' OR value IS NOT NULL"
_OLD_EXPR = "mode <> 'manual_override' OR (value IS NOT NULL AND rationale IS NOT NULL)"


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check", schema="public")
    op.create_check_constraint(_CONSTRAINT, _TABLE, _NEW_EXPR, schema="public")


def downgrade() -> None:
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check", schema="public")
    op.create_check_constraint(_CONSTRAINT, _TABLE, _OLD_EXPR, schema="public")
