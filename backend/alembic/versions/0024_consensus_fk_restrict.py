"""Fix composite FK fk_extraction_consensus_decisions_selected_run_match (#81).

The ``(run_id, selected_decision_id)`` FK on ``extraction_consensus_decisions``
(added in 0012) used ``ON DELETE SET NULL``. But ``run_id`` is ``NOT NULL``, so a
composite SET NULL would try to null ``run_id`` as well and abort with a
not-null violation whenever a referenced reviewer decision is directly deleted —
the cascade fails instead of cleaning up. SET NULL was also incoherent with the
``select_existing_has_decision`` CHECK (which forbids a null
``selected_decision_id`` for select_existing rows).

Re-create the constraint with ``ON DELETE RESTRICT`` (matching the sibling
reviewer-states composite FK). Normal run/project deletion still CASCADE-drops
both sides in one statement; RESTRICT only blocks a *direct* delete of a
referenced reviewer decision, which is the correct, fail-loud behaviour.

Revision ID: 0024_consensus_fk_restrict
Revises: 0023_workflow_article_coherence
Create Date: 2026-06-04
"""

from alembic import op

revision = "0024_consensus_fk_restrict"
down_revision = "0023_workflow_article_coherence"
branch_labels = None
depends_on = None

_CONSTRAINT = "fk_extraction_consensus_decisions_selected_run_match"
_TABLE = "public.extraction_consensus_decisions"
_REF = "public.extraction_reviewer_decisions (run_id, id)"


def _recreate(on_delete: str) -> None:
    op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS {_CONSTRAINT}")
    op.execute(
        f"""
        ALTER TABLE {_TABLE}
        ADD CONSTRAINT {_CONSTRAINT}
        FOREIGN KEY (run_id, selected_decision_id)
        REFERENCES {_REF}
        ON DELETE {on_delete}
        """
    )


def upgrade() -> None:
    _recreate("RESTRICT")


def downgrade() -> None:
    _recreate("SET NULL")
