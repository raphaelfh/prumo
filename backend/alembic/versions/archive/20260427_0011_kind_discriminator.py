"""kind discriminator on templates and runs

Revision ID: 20260427_0011
Revises: 20260427_0010
Create Date: 2026-04-27
"""

from alembic import op

revision: str = "20260427_0011"
down_revision: str | None = "20260427_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # template_kind enum (idempotent via DO $$ block)
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_kind') THEN
                CREATE TYPE template_kind AS ENUM ('extraction', 'quality_assessment');
            END IF;
        END
        $$;
        """
    )

    # Add kind to extraction_templates_global (nullable, default extraction; backfill; NOT NULL)
    op.execute(
        """
        ALTER TABLE public.extraction_templates_global
            ADD COLUMN IF NOT EXISTS kind template_kind
        """
    )
    op.execute(
        """
        UPDATE public.extraction_templates_global
            SET kind = 'extraction' WHERE kind IS NULL
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_templates_global
            ALTER COLUMN kind SET NOT NULL,
            ALTER COLUMN kind SET DEFAULT 'extraction'
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_templates_global
            ADD CONSTRAINT uq_extraction_templates_global_id_kind UNIQUE (id, kind)
        """
    )

    # Add kind to project_extraction_templates
    op.execute(
        """
        ALTER TABLE public.project_extraction_templates
            ADD COLUMN IF NOT EXISTS kind template_kind
        """
    )
    op.execute(
        """
        UPDATE public.project_extraction_templates
            SET kind = 'extraction' WHERE kind IS NULL
        """
    )
    op.execute(
        """
        ALTER TABLE public.project_extraction_templates
            ALTER COLUMN kind SET NOT NULL,
            ALTER COLUMN kind SET DEFAULT 'extraction'
        """
    )
    op.execute(
        """
        ALTER TABLE public.project_extraction_templates
            ADD CONSTRAINT uq_project_extraction_templates_id_kind UNIQUE (id, kind)
        """
    )

    # Add kind, version_id, hitl_config_snapshot to extraction_runs.
    # version_id is nullable initially so we can backfill from extraction_template_versions.
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            ADD COLUMN IF NOT EXISTS kind template_kind,
            ADD COLUMN IF NOT EXISTS version_id uuid,
            ADD COLUMN IF NOT EXISTS hitl_config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
        """
    )
    op.execute(
        """
        UPDATE public.extraction_runs
            SET kind = 'extraction' WHERE kind IS NULL
        """
    )
    op.execute(
        """
        UPDATE public.extraction_runs r
        SET version_id = v.id
        FROM public.extraction_template_versions v
        WHERE v.project_template_id = r.template_id
          AND v.version = 1
          AND r.version_id IS NULL
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            ALTER COLUMN kind SET NOT NULL,
            ALTER COLUMN kind SET DEFAULT 'extraction',
            ALTER COLUMN version_id SET NOT NULL
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            ADD CONSTRAINT fk_extraction_runs_version_id
                FOREIGN KEY (version_id)
                REFERENCES public.extraction_template_versions (id)
                ON DELETE RESTRICT
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            ADD CONSTRAINT fk_extraction_runs_template_kind_coherence
                FOREIGN KEY (template_id, kind)
                REFERENCES public.project_extraction_templates (id, kind)
                ON DELETE CASCADE
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_runs_kind
            ON public.extraction_runs (kind)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.extraction_runs
            DROP CONSTRAINT IF EXISTS fk_extraction_runs_template_kind_coherence,
            DROP CONSTRAINT IF EXISTS fk_extraction_runs_version_id,
            DROP COLUMN IF EXISTS hitl_config_snapshot,
            DROP COLUMN IF EXISTS version_id,
            DROP COLUMN IF EXISTS kind
        """
    )
    op.execute("DROP INDEX IF EXISTS public.idx_extraction_runs_kind")

    op.execute(
        """
        ALTER TABLE public.project_extraction_templates
            DROP CONSTRAINT IF EXISTS uq_project_extraction_templates_id_kind,
            DROP COLUMN IF EXISTS kind
        """
    )

    op.execute(
        """
        ALTER TABLE public.extraction_templates_global
            DROP CONSTRAINT IF EXISTS uq_extraction_templates_global_id_kind,
            DROP COLUMN IF EXISTS kind
        """
    )

    op.execute("DROP TYPE IF EXISTS template_kind")
