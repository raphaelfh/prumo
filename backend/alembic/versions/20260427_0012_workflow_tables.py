"""HITL workflow tables: proposal/reviewer/consensus/published

Revision ID: 20260427_0012
Revises: 20260427_0011
Create Date: 2026-04-27
"""

from alembic import op

revision: str = "20260427_0012"
down_revision: str | None = "20260427_0011"
branch_labels = None
depends_on = None


_WORKFLOW_TABLES = (
    "extraction_proposal_records",
    "extraction_reviewer_decisions",
    "extraction_reviewer_states",
    "extraction_consensus_decisions",
    "extraction_published_states",
)


def upgrade() -> None:
    # Enums (idempotent)
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'extraction_proposal_source') THEN
                CREATE TYPE extraction_proposal_source AS ENUM ('ai', 'human', 'system');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'extraction_reviewer_decision') THEN
                CREATE TYPE extraction_reviewer_decision AS ENUM ('accept_proposal', 'reject', 'edit');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'extraction_consensus_mode') THEN
                CREATE TYPE extraction_consensus_mode AS ENUM ('select_existing', 'manual_override');
            END IF;
        END
        $$;
        """
    )

    # 1) extraction_proposal_records — append-only AI/human/system proposals.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.extraction_proposal_records (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id uuid NOT NULL
                REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
            instance_id uuid NOT NULL
                REFERENCES public.extraction_instances(id) ON DELETE CASCADE,
            field_id uuid NOT NULL
                REFERENCES public.extraction_fields(id) ON DELETE RESTRICT,
            source extraction_proposal_source NOT NULL,
            source_user_id uuid
                REFERENCES public.profiles(id) ON DELETE SET NULL,
            proposed_value jsonb NOT NULL,
            confidence_score numeric,
            rationale text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_extraction_proposal_records_human_has_user
                CHECK (source <> 'human' OR source_user_id IS NOT NULL)
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_proposal_records_run_item
            ON public.extraction_proposal_records (run_id, instance_id, field_id);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_proposal_records_run_id
            ON public.extraction_proposal_records (run_id);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_proposal_records_instance_id
            ON public.extraction_proposal_records (instance_id);
        """
    )

    # 2) extraction_reviewer_decisions — append-only per-reviewer accept/reject/edit.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.extraction_reviewer_decisions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id uuid NOT NULL
                REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
            instance_id uuid NOT NULL
                REFERENCES public.extraction_instances(id) ON DELETE CASCADE,
            field_id uuid NOT NULL
                REFERENCES public.extraction_fields(id) ON DELETE RESTRICT,
            reviewer_id uuid NOT NULL
                REFERENCES public.profiles(id) ON DELETE RESTRICT,
            decision extraction_reviewer_decision NOT NULL,
            proposal_record_id uuid
                REFERENCES public.extraction_proposal_records(id) ON DELETE SET NULL,
            value jsonb,
            rationale text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_extraction_reviewer_decisions_accept_has_proposal
                CHECK (decision <> 'accept_proposal' OR proposal_record_id IS NOT NULL),
            CONSTRAINT ck_extraction_reviewer_decisions_edit_has_value
                CHECK (decision <> 'edit' OR value IS NOT NULL)
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_reviewer_decisions_run_reviewer_item
            ON public.extraction_reviewer_decisions
                (run_id, reviewer_id, instance_id, field_id, created_at);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_reviewer_decisions_run_id
            ON public.extraction_reviewer_decisions (run_id);
        """
    )

    # 3) extraction_reviewer_states — materialized current decision per (reviewer, run, item).
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.extraction_reviewer_states (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id uuid NOT NULL
                REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
            reviewer_id uuid NOT NULL
                REFERENCES public.profiles(id) ON DELETE RESTRICT,
            instance_id uuid NOT NULL
                REFERENCES public.extraction_instances(id) ON DELETE CASCADE,
            field_id uuid NOT NULL
                REFERENCES public.extraction_fields(id) ON DELETE RESTRICT,
            current_decision_id uuid NOT NULL
                REFERENCES public.extraction_reviewer_decisions(id) ON DELETE RESTRICT,
            last_updated timestamptz NOT NULL DEFAULT now(),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_extraction_reviewer_states_run_reviewer_item
                UNIQUE (run_id, reviewer_id, instance_id, field_id)
        );
        """
    )

    # 4) extraction_consensus_decisions — append-only consensus events.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.extraction_consensus_decisions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id uuid NOT NULL
                REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
            instance_id uuid NOT NULL
                REFERENCES public.extraction_instances(id) ON DELETE CASCADE,
            field_id uuid NOT NULL
                REFERENCES public.extraction_fields(id) ON DELETE RESTRICT,
            consensus_user_id uuid NOT NULL
                REFERENCES public.profiles(id) ON DELETE RESTRICT,
            mode extraction_consensus_mode NOT NULL,
            selected_decision_id uuid
                REFERENCES public.extraction_reviewer_decisions(id) ON DELETE SET NULL,
            value jsonb,
            rationale text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_extraction_consensus_decisions_select_existing_has_decision
                CHECK (mode <> 'select_existing' OR selected_decision_id IS NOT NULL),
            CONSTRAINT ck_extraction_consensus_decisions_manual_override_has_value_rationale
                CHECK (mode <> 'manual_override' OR (value IS NOT NULL AND rationale IS NOT NULL))
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_consensus_decisions_run_item
            ON public.extraction_consensus_decisions (run_id, instance_id, field_id);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_consensus_decisions_run_id
            ON public.extraction_consensus_decisions (run_id);
        """
    )

    # 5) extraction_published_states — canonical value with optimistic concurrency.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.extraction_published_states (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id uuid NOT NULL
                REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
            instance_id uuid NOT NULL
                REFERENCES public.extraction_instances(id) ON DELETE CASCADE,
            field_id uuid NOT NULL
                REFERENCES public.extraction_fields(id) ON DELETE RESTRICT,
            value jsonb NOT NULL,
            published_at timestamptz NOT NULL DEFAULT now(),
            published_by uuid NOT NULL
                REFERENCES public.profiles(id) ON DELETE RESTRICT,
            version integer NOT NULL DEFAULT 1,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_extraction_published_states_run_item
                UNIQUE (run_id, instance_id, field_id)
        );
        """
    )

    # Triggers: maintain updated_at on UPDATE for each workflow table.
    for table_name in _WORKFLOW_TABLES:
        op.execute(
            f"DROP TRIGGER IF EXISTS update_{table_name}_updated_at ON public.{table_name};"
        )
        op.execute(
            f"""
            CREATE TRIGGER update_{table_name}_updated_at
            BEFORE UPDATE ON public.{table_name}
            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
            """
        )

    # RLS: enable row-level security and create 4 policies per table.
    # Project membership is derived transitively via:
    #   <table>.run_id -> extraction_runs.template_id -> project_extraction_templates.project_id.
    # SELECT/DELETE use is_project_member; INSERT/UPDATE use is_project_manager.
    for table_name in _WORKFLOW_TABLES:
        op.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;")
        op.execute(
            f"""
            CREATE POLICY {table_name}_select
              ON public.{table_name} FOR SELECT
              USING (
                  EXISTS (
                      SELECT 1
                      FROM public.extraction_runs r
                      JOIN public.project_extraction_templates t ON t.id = r.template_id
                      WHERE r.id = {table_name}.run_id
                        AND public.is_project_member(t.project_id, auth.uid())
                  )
              );
            """
        )
        op.execute(
            f"""
            CREATE POLICY {table_name}_insert
              ON public.{table_name} FOR INSERT
              WITH CHECK (
                  EXISTS (
                      SELECT 1
                      FROM public.extraction_runs r
                      JOIN public.project_extraction_templates t ON t.id = r.template_id
                      WHERE r.id = {table_name}.run_id
                        AND public.is_project_manager(t.project_id, auth.uid())
                  )
              );
            """
        )
        op.execute(
            f"""
            CREATE POLICY {table_name}_update
              ON public.{table_name} FOR UPDATE
              USING (
                  EXISTS (
                      SELECT 1
                      FROM public.extraction_runs r
                      JOIN public.project_extraction_templates t ON t.id = r.template_id
                      WHERE r.id = {table_name}.run_id
                        AND public.is_project_manager(t.project_id, auth.uid())
                  )
              )
              WITH CHECK (
                  EXISTS (
                      SELECT 1
                      FROM public.extraction_runs r
                      JOIN public.project_extraction_templates t ON t.id = r.template_id
                      WHERE r.id = {table_name}.run_id
                        AND public.is_project_manager(t.project_id, auth.uid())
                  )
              );
            """
        )
        op.execute(
            f"""
            CREATE POLICY {table_name}_delete
              ON public.{table_name} FOR DELETE
              USING (
                  EXISTS (
                      SELECT 1
                      FROM public.extraction_runs r
                      JOIN public.project_extraction_templates t ON t.id = r.template_id
                      WHERE r.id = {table_name}.run_id
                        AND public.is_project_member(t.project_id, auth.uid())
                  )
              );
            """
        )


def downgrade() -> None:
    # Drop triggers first.
    for table_name in _WORKFLOW_TABLES:
        op.execute(
            f"DROP TRIGGER IF EXISTS update_{table_name}_updated_at ON public.{table_name};"
        )

    # Drop tables in reverse dependency order so we honor:
    #   - reviewer_states.current_decision_id -> reviewer_decisions.id
    #   - consensus_decisions.selected_decision_id -> reviewer_decisions.id
    #   - reviewer_decisions.proposal_record_id -> proposal_records.id
    op.execute("DROP TABLE IF EXISTS public.extraction_reviewer_states CASCADE;")
    op.execute("DROP TABLE IF EXISTS public.extraction_consensus_decisions CASCADE;")
    op.execute("DROP TABLE IF EXISTS public.extraction_published_states CASCADE;")
    op.execute("DROP TABLE IF EXISTS public.extraction_reviewer_decisions CASCADE;")
    op.execute("DROP TABLE IF EXISTS public.extraction_proposal_records CASCADE;")

    # Drop enums last.
    op.execute("DROP TYPE IF EXISTS extraction_consensus_mode;")
    op.execute("DROP TYPE IF EXISTS extraction_reviewer_decision;")
    op.execute("DROP TYPE IF EXISTS extraction_proposal_source;")
