"""Create the screening tables and close client writes on the sync tables.

``screening_assignments`` enrolls one article in one screening phase of its
project (``title_abstract`` only, for now); ``screening_decisions`` holds each
reviewer's include / exclude / maybe; ``screening_arbitrations`` holds the
arbitrator's ruling, optionally selecting one decision of the same assignment
(composite FK, deferred NO ACTION as in 0044: never a composite SET NULL,
which would null the NOT NULL ``assignment_id`` — the 0024 bug — and deferred
so the assignment cascade removes decision and ruling in one statement).

Backend-only, with the 0072 ``deny_all`` posture (RLS enabled, a single
``deny_all`` policy, every privilege revoked from ``authenticated`` /
``anon``): screening is blind, so the API alone decides which decisions a
reviewer may see. A member-read RLS policy would let any reviewer read the
others' decisions through PostgREST, reopening the leak 0025 closed for
extraction.

Decisions and arbitrations are INSERT-only (constitution §IX: human
selections are append-only; the current one is the latest row): the 0081
``refuse_append_only_change`` trigger refuses UPDATE and DELETE from any role
but the owner, which keeps cascades working.

The PRISMA flow reads ``article_sync_runs`` / ``article_sync_events``, so
their counts must come only from the backend: nothing in ``frontend/`` writes
them (``grep -rn article_sync frontend`` lists only generated types), and
this migration revokes the client roles' INSERT / UPDATE / DELETE. Members
keep SELECT.

Additive only; writes no rows. Downgrade restores ``authenticated``'s writes
on the sync tables (anon never held a migration grant) and drops the three
tables (indexes, policies and triggers go with them).

Revision ID: 0094_screening_v1
Revises: 0093_batch_agent_origin
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.schema import SchemaItem

from alembic import op

revision = "0094_screening_v1"
down_revision = "0093_batch_agent_origin"
branch_labels = None
depends_on = None

_TABLES = ("screening_assignments", "screening_decisions", "screening_arbitrations")
_APPEND_ONLY = ("screening_decisions", "screening_arbitrations")
_SYNC = '"public"."article_sync_runs", "public"."article_sync_events"'


def _id() -> sa.Column:
    return sa.Column(
        "id", PG_UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
    )


def _link(table: str, column: str, target: str, ondelete: str, *, nullable: bool) -> sa.Column:
    return sa.Column(
        column,
        PG_UUID(as_uuid=True),
        sa.ForeignKey(f"public.{target}.id", ondelete=ondelete, name=f"{table}_{column}_fkey"),
        nullable=nullable,
    )


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def _ruling_columns_and_checks() -> list[SchemaItem]:
    # SHORT names: the "ck" convention expands them to ck_<table>_<name>.
    return [
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("exclusion_reason", sa.Text(), nullable=True),
        sa.CheckConstraint("decision IN ('include', 'exclude', 'maybe')", name="decision"),
        sa.CheckConstraint(
            "exclusion_reason IS NULL OR decision = 'exclude'", name="reason_on_exclude"
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "screening_assignments",
        _id(),
        _link("screening_assignments", "project_id", "projects", "CASCADE", nullable=False),
        _link("screening_assignments", "article_id", "articles", "CASCADE", nullable=False),
        sa.Column("phase", sa.Text(), server_default="title_abstract", nullable=False),
        sa.Column(
            "enrolled_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        _link("screening_assignments", "enrolled_by", "profiles", "SET NULL", nullable=True),
        sa.CheckConstraint("phase IN ('title_abstract')", name="phase"),
        sa.UniqueConstraint(
            "project_id", "article_id", "phase", name="uq_screening_assignments_article_phase"
        ),
        schema="public",
    )
    op.create_table(
        "screening_decisions",
        _id(),
        _link(
            "screening_decisions",
            "assignment_id",
            "screening_assignments",
            "CASCADE",
            nullable=False,
        ),
        _link("screening_decisions", "reviewer_id", "profiles", "RESTRICT", nullable=False),
        *_ruling_columns_and_checks(),
        sa.Column("rationale", sa.Text(), nullable=True),
        _created_at(),
        sa.UniqueConstraint("assignment_id", "id", name="uq_screening_decisions_assignment_id_id"),
        schema="public",
    )
    op.create_table(
        "screening_arbitrations",
        _id(),
        _link(
            "screening_arbitrations",
            "assignment_id",
            "screening_assignments",
            "CASCADE",
            nullable=False,
        ),
        *_ruling_columns_and_checks(),
        sa.Column("selected_decision_id", PG_UUID(as_uuid=True), nullable=True),
        sa.Column("rationale", sa.Text(), nullable=True),
        _link("screening_arbitrations", "decided_by", "profiles", "RESTRICT", nullable=False),
        _created_at(),
        sa.ForeignKeyConstraint(
            ["assignment_id", "selected_decision_id"],
            ["public.screening_decisions.assignment_id", "public.screening_decisions.id"],
            name="fk_screening_arbitrations_selected_decision_match",
            deferrable=True,
            initially="DEFERRED",
        ),
        schema="public",
    )

    # Every FK column list leads an index: CI's postgres:17 has no btree skip
    # scan, so a FK that is only an index's 2nd column seq-scans on cascade.
    op.create_index(
        "ix_screening_assignments_article_id",
        "screening_assignments",
        ["article_id"],
        schema="public",
    )
    op.create_index(
        "ix_screening_assignments_enrolled_by",
        "screening_assignments",
        ["enrolled_by"],
        schema="public",
        postgresql_where=sa.text("enrolled_by IS NOT NULL"),
    )
    op.create_index(
        "ix_screening_decisions_current",
        "screening_decisions",
        ["assignment_id", "reviewer_id", sa.text("created_at DESC"), sa.text("id DESC")],
        schema="public",
    )
    op.create_index(
        "ix_screening_decisions_reviewer_id",
        "screening_decisions",
        ["reviewer_id"],
        schema="public",
    )
    op.create_index(
        "ix_screening_arbitrations_current",
        "screening_arbitrations",
        ["assignment_id", sa.text("created_at DESC"), sa.text("id DESC")],
        schema="public",
    )
    op.create_index(
        "ix_screening_arbitrations_selected_decision",
        "screening_arbitrations",
        ["assignment_id", "selected_decision_id"],
        schema="public",
        postgresql_where=sa.text("selected_decision_id IS NOT NULL"),
    )
    op.create_index(
        "ix_screening_arbitrations_decided_by",
        "screening_arbitrations",
        ["decided_by"],
        schema="public",
    )

    for t in _TABLES:
        op.execute(f'ALTER TABLE "public"."{t}" ENABLE ROW LEVEL SECURITY;')
        op.execute(f'CREATE POLICY "deny_all" ON "public"."{t}" FOR ALL USING (false);')
        op.execute(f'REVOKE ALL ON "public"."{t}" FROM "authenticated", "anon";')
    for t in _APPEND_ONLY:
        op.execute(
            f"CREATE TRIGGER refuse_append_only_change BEFORE UPDATE OR DELETE ON public.{t} "
            "FOR EACH ROW EXECUTE FUNCTION public.refuse_append_only_change();"
        )
    op.execute(f'REVOKE INSERT, UPDATE, DELETE ON {_SYNC} FROM "anon", "authenticated";')


def downgrade() -> None:
    op.execute(f'GRANT INSERT, UPDATE, DELETE ON {_SYNC} TO "authenticated";')
    for t in reversed(_TABLES):
        op.drop_table(t, schema="public")
