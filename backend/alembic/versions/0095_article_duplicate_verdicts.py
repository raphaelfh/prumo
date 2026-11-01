"""Create the append-only ``article_duplicate_verdicts`` table.

A verdict says that ``article_id`` is a duplicate of ``kept_article_id``
(``duplicate``), was judged a different record (``distinct``), or that an
earlier verdict was undone (``cleared``). The current verdict of a pair is the
latest row; rows are INSERT-only (constitution §IX), refused by the 0081
``refuse_append_only_change`` trigger for every role but the owner, so
cascades still work: deleting the kept article removes the verdict and
revives the removed record.

Backend-only, the 0094 ``deny_all`` posture. Additive; writes no rows.
Downgrade drops the table (indexes, policy and trigger go with it).

Revision ID: 0095_article_duplicate_verdicts
Revises: 0094_screening_v1
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision = "0095_article_duplicate_verdicts"
down_revision = "0094_screening_v1"
branch_labels = None
depends_on = None

_TABLE = "article_duplicate_verdicts"


def _link(column: str, target: str, ondelete: str) -> sa.Column:
    return sa.Column(
        column,
        PG_UUID(as_uuid=True),
        sa.ForeignKey(f"public.{target}.id", ondelete=ondelete, name=f"{_TABLE}_{column}_fkey"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column(
            "id",
            PG_UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        _link("project_id", "projects", "CASCADE"),
        _link("article_id", "articles", "CASCADE"),
        _link("kept_article_id", "articles", "CASCADE"),
        sa.Column("verdict", sa.Text(), nullable=False),
        sa.Column("basis", sa.Text(), nullable=False),
        _link("decided_by", "profiles", "RESTRICT"),
        # clock_timestamp(), not now(): the current verdict is the latest row (see 0094).
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.clock_timestamp(),
            nullable=False,
        ),
        # SHORT names: the "ck" convention expands them to ck_<table>_<name>.
        sa.CheckConstraint("verdict IN ('duplicate', 'distinct', 'cleared')", name="verdict"),
        sa.CheckConstraint("basis IN ('pmid', 'doi', 'title', 'manual')", name="basis"),
        sa.CheckConstraint("article_id <> kept_article_id", name="not_self"),
        schema="public",
    )
    for column in ("project_id", "article_id", "kept_article_id", "decided_by"):
        op.create_index(f"ix_{_TABLE}_{column}", _TABLE, [column], schema="public")

    op.execute(f'ALTER TABLE "public"."{_TABLE}" ENABLE ROW LEVEL SECURITY;')
    op.execute(f'CREATE POLICY "deny_all" ON "public"."{_TABLE}" FOR ALL USING (false);')
    op.execute(f'REVOKE ALL ON "public"."{_TABLE}" FROM "authenticated", "anon";')
    op.execute(
        f"CREATE TRIGGER refuse_append_only_change BEFORE UPDATE OR DELETE ON public.{_TABLE} "
        "FOR EACH ROW EXECUTE FUNCTION public.refuse_append_only_change();"
    )


def downgrade() -> None:
    op.drop_table(_TABLE, schema="public")
