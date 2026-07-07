"""Unblock whole-graph instance deletes: evidence CASCADE + deferred guards.

A PostgREST-direct ``DELETE FROM extraction_instances`` on an instance with
AI-extracted suggestions aborts today ("Error removing instance" in the
extraction form): the instance cascade deletes its proposal records, whose
``ON DELETE SET NULL`` action on ``extraction_evidence`` strips the evidence
row of its only workflow target — and the ``workflow_target_present`` CHECK
(run_id + at least one of proposal/reviewer/consensus) rejects the update
mid-cascade. Article and project deletes hit the same wall through the
``articles → extraction_instances`` branch.

Two coordinated changes:

1. The three evidence target FKs become ``ON DELETE CASCADE``. Evidence
   points at exactly one workflow target (architecture reference,
   "Evidence"); when that target dies, SET NULL can never satisfy the
   CHECK, so following the target is the only coherent action.

2. The three RESTRICT guards on the same cascade diamond
   (``reviewer_decisions.proposal_record_id`` from 0011, the
   reviewer_states and consensus_decisions composite decision FKs from
   0005/#81) become ``NO ACTION DEFERRABLE INITIALLY DEFERRED``. RESTRICT
   is checked per cascaded row — it aborts an atomic whole-graph delete
   even though every referencing row dies in the same statement (the 0040
   finding, reproduced by ``test_instance_delete_cascade.py``). The
   deferred check runs at COMMIT instead: a standalone delete of a
   referenced proposal/decision still fails (the 0011 guarantee), while
   the instance/article/project cascade — which removes referencing rows
   in the same transaction — passes.

All six constraints ship under their live literal names (baseline defaults
plus the 0005/0011 recreations), so both directions use raw SQL — see the
constraint-naming note in docs/reference/migrations.md.

Revision ID: 0044_instance_delete_cascade
Revises: 0043_min_one_manager_guard
"""

from alembic import op

revision = "0044_instance_delete_cascade"
down_revision = "0043_min_one_manager_guard"
branch_labels = None
depends_on = None

_EVIDENCE = "public.extraction_evidence"

# (table, constraint, FK columns, referenced table (columns))
_EVIDENCE_TARGET_FKS = [
    (
        "extraction_evidence_proposal_record_id_fkey",
        "proposal_record_id",
        "public.extraction_proposal_records (id)",
    ),
    (
        "extraction_evidence_reviewer_decision_id_fkey",
        "reviewer_decision_id",
        "public.extraction_reviewer_decisions (id)",
    ),
    (
        "extraction_evidence_consensus_decision_id_fkey",
        "consensus_decision_id",
        "public.extraction_consensus_decisions (id)",
    ),
]

_GUARD_FKS = [
    (
        "public.extraction_reviewer_decisions",
        "extraction_reviewer_decisions_proposal_record_id_fkey",
        "(proposal_record_id)",
        "public.extraction_proposal_records (id)",
    ),
    (
        "public.extraction_reviewer_states",
        "fk_extraction_reviewer_states_decision_run_match",
        "(run_id, current_decision_id)",
        "public.extraction_reviewer_decisions (run_id, id)",
    ),
    (
        "public.extraction_consensus_decisions",
        "fk_extraction_consensus_decisions_selected_run_match",
        "(run_id, selected_decision_id)",
        "public.extraction_reviewer_decisions (run_id, id)",
    ),
]


def upgrade() -> None:
    for name, column, referenced in _EVIDENCE_TARGET_FKS:
        op.execute(f'ALTER TABLE {_EVIDENCE} DROP CONSTRAINT "{name}"')
        op.execute(
            f'ALTER TABLE {_EVIDENCE} ADD CONSTRAINT "{name}" '
            f'FOREIGN KEY ("{column}") REFERENCES {referenced} '
            "ON DELETE CASCADE"
        )
    for table, name, columns, referenced in _GUARD_FKS:
        op.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{name}"')
        op.execute(
            f'ALTER TABLE {table} ADD CONSTRAINT "{name}" '
            f"FOREIGN KEY {columns} REFERENCES {referenced} "
            "ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED"
        )


def downgrade() -> None:
    for table, name, columns, referenced in _GUARD_FKS:
        op.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{name}"')
        op.execute(
            f'ALTER TABLE {table} ADD CONSTRAINT "{name}" '
            f"FOREIGN KEY {columns} REFERENCES {referenced} "
            "ON DELETE RESTRICT"
        )
    for name, column, referenced in _EVIDENCE_TARGET_FKS:
        op.execute(f'ALTER TABLE {_EVIDENCE} DROP CONSTRAINT "{name}"')
        op.execute(
            f'ALTER TABLE {_EVIDENCE} ADD CONSTRAINT "{name}" '
            f'FOREIGN KEY ("{column}") REFERENCES {referenced} '
            "ON DELETE SET NULL"
        )
