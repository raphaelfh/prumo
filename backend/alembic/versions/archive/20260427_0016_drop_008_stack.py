"""drop 008 evaluation_* tables and enums

Revision ID: 20260427_0016
Revises: 20260427_0015
Create Date: 2026-04-27

NOTE: downgrade is a no-op. Recreating the 008 stack from scratch is not
supported because the 008 stack was a skeleton that has been fully replaced
by the extraction-centric HITL stack. To restore 008, check out a commit
prior to 20260426_0009 and migrate from there.
"""

from alembic import op

revision: str = "20260427_0016"
down_revision: str | None = "20260427_0015"
branch_labels = None
depends_on = None


_TABLES_IN_DROP_ORDER = [
    "evidence_records",
    "published_states",
    "consensus_decision_records",
    "reviewer_states",
    "reviewer_decision_records",
    "proposal_records",
    "evaluation_run_targets",
    "evaluation_runs",
    "evaluation_items",
    "evaluation_schema_versions",
    "evaluation_schemas",
]

_ENUMS_TO_DROP = [
    "evaluation_schema_version_status",
    "evaluation_item_type",
    "evaluation_run_status",
    "evaluation_run_stage",
    "evaluation_proposal_source_type",
    "reviewer_decision_type",
    "consensus_decision_mode",
    "published_state_status",
    "evidence_entity_type",
]


def upgrade() -> None:
    for table_name in _TABLES_IN_DROP_ORDER:
        op.execute(f"DROP TABLE IF EXISTS public.{table_name} CASCADE;")
    for enum_name in _ENUMS_TO_DROP:
        op.execute(f"DROP TYPE IF EXISTS {enum_name};")


def downgrade() -> None:
    # No-op. See module docstring.
    pass
