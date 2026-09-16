"""AI batch runs: extraction_batches + extraction_batch_items (spec 2026-09-15 §6).

Revision ID: 0076_extraction_batches
Revises: 0075_extraction_attempts
Create Date: 2026-09-15 23:11:16.363874+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0076_extraction_batches"
down_revision = "0075_extraction_attempts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "extraction_batches",
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("template_id", sa.UUID(), nullable=False),
        sa.Column(
            "skip_articles_with_ai_suggestions",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stop_code", sa.Text(), nullable=True),
        sa.Column("stop_message", sa.Text(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["public.profiles.id"],
            name=op.f("extraction_batches_owner_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["public.projects.id"],
            name=op.f("extraction_batches_project_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["public.project_extraction_templates.id"],
            name=op.f("extraction_batches_template_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("extraction_batches_pkey")),
        schema="public",
    )
    op.create_index(
        "ix_extraction_batches_owner_created",
        "extraction_batches",
        ["owner_id", "created_at"],
        unique=False,
        schema="public",
    )
    op.create_table(
        "extraction_batch_items",
        sa.Column("batch_id", sa.UUID(), nullable=False),
        sa.Column("article_id", sa.UUID(), nullable=False),
        sa.Column("attempt_id", sa.UUID(), nullable=True),
        sa.Column("status", sa.Text(), server_default="queued", nullable=False),
        sa.Column("reason_code", sa.Text(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('queued','dispatched','skipped','failed','cancelled')",
            name=op.f("ck_extraction_batch_items_status"),
        ),
        sa.ForeignKeyConstraint(
            ["article_id"],
            ["public.articles.id"],
            name=op.f("extraction_batch_items_article_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["public.extraction_attempts.id"],
            name=op.f("extraction_batch_items_attempt_id_fkey"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["public.extraction_batches.id"],
            name=op.f("extraction_batch_items_batch_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("extraction_batch_items_pkey")),
        sa.UniqueConstraint(
            "batch_id", "article_id", name="uq_extraction_batch_items_batch_article"
        ),
        schema="public",
    )
    op.create_index(
        "ix_extraction_batch_items_batch_status",
        "extraction_batch_items",
        ["batch_id", "status"],
        unique=False,
        schema="public",
    )

    op.execute("ALTER TABLE public.extraction_batches ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON public.extraction_batches FROM anon, authenticated")
    op.execute("ALTER TABLE public.extraction_batch_items ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON public.extraction_batch_items FROM anon, authenticated")


def downgrade() -> None:
    op.drop_index(
        "ix_extraction_batch_items_batch_status",
        table_name="extraction_batch_items",
        schema="public",
    )
    op.drop_table("extraction_batch_items", schema="public")
    op.drop_index(
        "ix_extraction_batches_owner_created", table_name="extraction_batches", schema="public"
    )
    op.drop_table("extraction_batches", schema="public")
