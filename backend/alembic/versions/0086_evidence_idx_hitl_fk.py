"""Evidence workflow-link indexes and HITL config scope foreign keys.

``extraction_evidence`` gains a btree index on each of its three workflow
links (proposal record, reviewer decision, consensus decision), so the
``ON DELETE CASCADE`` from those tables and the per-target evidence reads
stop scanning the table. ``idx_extraction_evidence_run_id`` already exists
from the baseline and is left alone. Plain ``CREATE INDEX``, not
CONCURRENTLY: Alembic runs each migration in one transaction (0050, 0080
precedent).

``extraction_hitl_configs.scope_id`` points at a project or a template
depending on ``scope_kind`` and had no foreign key, so deleting a project
or a template orphaned its configuration. Two stored generated columns
split it by kind (``scope_project_id``, ``scope_template_id``; NULL for the
other kind) and each carries an ``ON DELETE CASCADE`` foreign key. Being
generated, they need no backfill and no writer change. Orphan rows that
already exist are deleted first, else the foreign keys could not be added.

Downgrade drops the foreign keys, the two columns and the three indexes.
The deleted orphan rows are not restored.

Revision ID: 0086_evidence_idx_hitl_fk
Revises: 0085_freeze_qa_rules
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision = "0086_evidence_idx_hitl_fk"
down_revision = "0085_freeze_qa_rules"
branch_labels = None
depends_on = None

_EVIDENCE_LINKS = ("proposal_record_id", "reviewer_decision_id", "consensus_decision_id")
#: (column, scope kind, foreign key name, referenced table)
_SCOPES = (
    ("scope_project_id", "project", "fk_hitl_configs_scope_project", "projects"),
    (
        "scope_template_id",
        "template",
        "fk_hitl_configs_scope_template",
        "project_extraction_templates",
    ),
)

DELETE_ORPHANS_SQL = """
DELETE FROM public.extraction_hitl_configs h
WHERE (h.scope_kind = 'project'
       AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = h.scope_id))
   OR (h.scope_kind = 'template'
       AND NOT EXISTS (SELECT 1 FROM public.project_extraction_templates t WHERE t.id = h.scope_id))
"""


def upgrade() -> None:
    op.execute(DELETE_ORPHANS_SQL)
    for column in _EVIDENCE_LINKS:
        op.create_index(
            f"idx_extraction_evidence_{column}",
            "extraction_evidence",
            [column],
            schema="public",
        )
    for column, kind, fk_name, referred in _SCOPES:
        op.add_column(
            "extraction_hitl_configs",
            sa.Column(
                column,
                PG_UUID(as_uuid=True),
                sa.Computed(
                    f"CASE WHEN scope_kind = '{kind}'::hitl_config_scope_kind THEN scope_id END",
                    persisted=True,
                ),
                nullable=True,
            ),
            schema="public",
        )
        op.create_foreign_key(
            fk_name,
            "extraction_hitl_configs",
            referred,
            [column],
            ["id"],
            source_schema="public",
            referent_schema="public",
            ondelete="CASCADE",
        )


def downgrade() -> None:
    for column, _kind, fk_name, _referred in _SCOPES:
        op.drop_constraint(fk_name, "extraction_hitl_configs", type_="foreignkey", schema="public")
        op.drop_column("extraction_hitl_configs", column, schema="public")
    for column in _EVIDENCE_LINKS:
        op.drop_index(
            f"idx_extraction_evidence_{column}", table_name="extraction_evidence", schema="public"
        )
