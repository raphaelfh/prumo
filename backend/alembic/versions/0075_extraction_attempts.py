"""Persist service-only extraction attempts.

Run deletion cascades attempts. Coordinate FKs and proposal references use
deferred NO ACTION so whole-graph cascades succeed without erasing isolated
proposal history. Attempt identity and coordinates are immutable.

Revision ID: 0075_extraction_attempts
Revises: 0074_ollama_provider
Create Date: 2026-09-15 03:16:23.947434+00:00

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "0075_extraction_attempts"
down_revision = "0074_ollama_provider"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "extraction_attempts",
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("article_id", sa.UUID(), nullable=False),
        sa.Column("template_id", sa.UUID(), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column("request_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("job_id", sa.Text(), nullable=True),
        sa.Column("engine", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
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
            "status IN ('pending','running','completed','failed','cancelled')",
            name=op.f("ck_extraction_attempts_status"),
        ),
        sa.ForeignKeyConstraint(
            ["article_id"],
            ["public.articles.id"],
            name=op.f("extraction_attempts_article_id_fkey"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["public.profiles.id"],
            name=op.f("extraction_attempts_owner_id_fkey"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["public.projects.id"],
            name=op.f("extraction_attempts_project_id_fkey"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["public.extraction_runs.id"],
            name=op.f("extraction_attempts_run_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["public.project_extraction_templates.id"],
            name=op.f("extraction_attempts_template_id_fkey"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("extraction_attempts_pkey")),
        sa.UniqueConstraint("id", "run_id", name="uq_extraction_attempt_id_run"),
        sa.UniqueConstraint("request_id", name=op.f("extraction_attempts_request_id_key")),
        schema="public",
    )
    op.add_column(
        "extraction_proposal_records", sa.Column("extraction_attempt_id", sa.UUID(), nullable=True)
    )
    op.add_column(
        "extraction_proposal_records",
        sa.Column("generation_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_index(
        "uq_proposal_attempt_coordinate",
        "extraction_proposal_records",
        ["extraction_attempt_id", "instance_id", "field_id", "source"],
        unique=True,
        schema="public",
        postgresql_where=sa.text("extraction_attempt_id IS NOT NULL"),
    )
    op.create_foreign_key(
        "fk_proposal_attempt_run",
        "extraction_proposal_records",
        "extraction_attempts",
        ["extraction_attempt_id", "run_id"],
        ["id", "run_id"],
        source_schema="public",
        referent_schema="public",
        initially="DEFERRED",
        deferrable=True,
    )

    op.execute("ALTER TABLE public.extraction_attempts ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON public.extraction_attempts FROM anon, authenticated")
    op.execute("""
        CREATE FUNCTION public.check_extraction_attempt_scope() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
        BEGIN
          IF TG_OP = 'UPDATE' AND
             (NEW.id,NEW.request_id,NEW.owner_id,NEW.project_id,NEW.article_id,NEW.template_id,NEW.run_id)
             IS DISTINCT FROM
             (OLD.id,OLD.request_id,OLD.owner_id,OLD.project_id,OLD.article_id,OLD.template_id,OLD.run_id)
          THEN RAISE EXCEPTION 'attempt identity is immutable' USING ERRCODE='check_violation'; END IF;
          IF NOT EXISTS (SELECT 1 FROM public.extraction_runs r WHERE r.id=NEW.run_id
             AND r.project_id=NEW.project_id AND r.article_id=NEW.article_id AND r.template_id=NEW.template_id)
          THEN RAISE EXCEPTION 'attempt scope does not match run' USING ERRCODE='check_violation'; END IF;
          RETURN NEW;
        END $$
    """)
    op.execute("""CREATE TRIGGER trg_extraction_attempt_scope BEFORE INSERT OR UPDATE
        ON public.extraction_attempts FOR EACH ROW EXECUTE FUNCTION public.check_extraction_attempt_scope()""")
    op.execute("""
        CREATE FUNCTION public.check_attempt_proposal_coordinates() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
        BEGIN
          IF NEW.extraction_attempt_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.extraction_attempts a
            JOIN public.extraction_instances i ON i.id=NEW.instance_id
            JOIN public.extraction_fields f ON f.id=NEW.field_id
            WHERE a.id=NEW.extraction_attempt_id AND a.run_id=NEW.run_id
              AND i.article_id=a.article_id AND i.template_id=a.template_id
              AND f.entity_type_id=i.entity_type_id)
          THEN RAISE EXCEPTION 'attempt proposal coordinates do not match' USING ERRCODE='check_violation'; END IF;
          RETURN NEW;
        END $$
    """)
    op.execute("""CREATE TRIGGER trg_attempt_proposal_coordinates BEFORE INSERT OR UPDATE OF
        extraction_attempt_id,run_id,instance_id,field_id ON public.extraction_proposal_records
        FOR EACH ROW EXECUTE FUNCTION public.check_attempt_proposal_coordinates()""")


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER trg_attempt_proposal_coordinates ON public.extraction_proposal_records"
    )
    op.execute("DROP FUNCTION public.check_attempt_proposal_coordinates()")
    op.execute("DROP TRIGGER trg_extraction_attempt_scope ON public.extraction_attempts")
    op.execute("DROP FUNCTION public.check_extraction_attempt_scope()")
    op.drop_constraint(
        "fk_proposal_attempt_run",
        "extraction_proposal_records",
        schema="public",
        type_="foreignkey",
    )
    op.drop_index(
        "uq_proposal_attempt_coordinate", table_name="extraction_proposal_records", schema="public"
    )
    op.drop_column("extraction_proposal_records", "generation_snapshot", schema="public")
    op.drop_column("extraction_proposal_records", "extraction_attempt_id", schema="public")
    op.drop_table("extraction_attempts", schema="public")
