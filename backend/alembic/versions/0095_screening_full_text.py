"""Add the full-text phase and the ``not_retrieved`` decision to screening.

``screening_assignments.phase`` accepts ``full_text`` beside ``title_abstract``;
``screening_decisions.decision`` and ``screening_arbitrations.decision`` accept
``not_retrieved`` (the full text could not be obtained). The three CHECKs are
dropped and re-created with the widened expressions; no row is written.

Downgrade deletes what the narrow CHECKs would refuse: first every ruling that
is ``not_retrieved`` or selected a ``not_retrieved`` decision (the deferred
composite FK would otherwise leave a ruling pointing at a deleted decision),
then every ``not_retrieved`` decision, then every ``full_text`` assignment
(its remaining decisions and rulings cascade). The append-only trigger lets the
owner delete, which is the migration role.

The number is provisional: it is renumbered against ``origin/dev``'s head at
merge time.

Revision ID: 0095_screening_full_text
Revises: 0094_screening_v1
"""

from alembic import op

revision = "0095_screening_full_text"
down_revision = "0094_screening_v1"
branch_labels = None
depends_on = None

_PHASE_WIDE = "phase IN ('title_abstract', 'full_text')"
_PHASE_NARROW = "phase IN ('title_abstract')"
_DECISION_WIDE = "decision IN ('include', 'exclude', 'maybe', 'not_retrieved')"
_DECISION_NARROW = "decision IN ('include', 'exclude', 'maybe')"

# (table, short constraint name, wide expression, narrow expression)
_CHECKS = (
    ("screening_assignments", "phase", _PHASE_WIDE, _PHASE_NARROW),
    ("screening_decisions", "decision", _DECISION_WIDE, _DECISION_NARROW),
    ("screening_arbitrations", "decision", _DECISION_WIDE, _DECISION_NARROW),
)


def _replace(table: str, name: str, expression: str) -> None:
    # The create helper prefixes the short name (``ck_<table>_<name>``); a raw
    # DROP names the full constraint.
    op.execute(f"ALTER TABLE public.{table} DROP CONSTRAINT ck_{table}_{name}")
    op.create_check_constraint(name, table, expression, schema="public")


def upgrade() -> None:
    for table, name, wide, _ in _CHECKS:
        _replace(table, name, wide)


def downgrade() -> None:
    op.execute(
        "DELETE FROM public.screening_arbitrations WHERE decision = 'not_retrieved' "
        "OR selected_decision_id IN "
        "(SELECT id FROM public.screening_decisions WHERE decision = 'not_retrieved')"
    )
    op.execute("DELETE FROM public.screening_decisions WHERE decision = 'not_retrieved'")
    op.execute("DELETE FROM public.screening_assignments WHERE phase = 'full_text'")
    # The composite FK is deferred: fire its pending checks now, or the ALTER TABLE
    # below fails with "pending trigger events".
    op.execute("SET CONSTRAINTS ALL IMMEDIATE")
    for table, name, _, narrow in _CHECKS:
        _replace(table, name, narrow)
