"""unified evaluation data model

Revision ID: 20260426_0008
Revises: 20260421_0007
Create Date: 2026-04-26
"""

from alembic import op

revision: str = "20260426_0008"
down_revision: str | None = "20260421_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create unified evaluation schema, tables, indexes, and RLS policies."""
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evaluation_schema_version_status') THEN
                CREATE TYPE evaluation_schema_version_status AS ENUM ('draft', 'published', 'archived');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evaluation_item_type') THEN
                CREATE TYPE evaluation_item_type AS ENUM ('text', 'number', 'boolean', 'date', 'choice_single', 'choice_multi');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evaluation_run_status') THEN
                CREATE TYPE evaluation_run_status AS ENUM ('pending', 'active', 'completed', 'failed', 'cancelled');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evaluation_run_stage') THEN
                CREATE TYPE evaluation_run_stage AS ENUM ('proposal', 'review', 'consensus', 'finalized');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evaluation_proposal_source_type') THEN
                CREATE TYPE evaluation_proposal_source_type AS ENUM ('ai', 'human', 'system');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reviewer_decision_type') THEN
                CREATE TYPE reviewer_decision_type AS ENUM ('accept', 'reject', 'edit');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consensus_decision_mode') THEN
                CREATE TYPE consensus_decision_mode AS ENUM ('select_existing', 'manual_override');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'published_state_status') THEN
                CREATE TYPE published_state_status AS ENUM ('published', 'superseded');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evidence_entity_type') THEN
                CREATE TYPE evidence_entity_type AS ENUM ('proposal', 'reviewer_decision', 'consensus_decision', 'published_state');
            END IF;
        END
        $$;
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.evaluation_schemas (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            name varchar NOT NULL,
            description text,
            created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT evaluation_schemas_project_id_name_key UNIQUE (project_id, name)
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.evaluation_schema_versions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            schema_id uuid NOT NULL REFERENCES public.evaluation_schemas(id) ON DELETE CASCADE,
            version_number integer NOT NULL,
            status evaluation_schema_version_status NOT NULL DEFAULT 'draft',
            published_at timestamptz,
            published_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT evaluation_schema_versions_schema_id_version_number_key UNIQUE (schema_id, version_number)
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.evaluation_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            schema_version_id uuid NOT NULL REFERENCES public.evaluation_schema_versions(id) ON DELETE CASCADE,
            item_key varchar NOT NULL,
            label varchar NOT NULL,
            description text,
            item_type evaluation_item_type NOT NULL,
            options_json jsonb,
            required boolean NOT NULL DEFAULT false,
            sort_order integer NOT NULL,
            is_deleted boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT evaluation_items_schema_version_id_item_key_key UNIQUE (schema_version_id, item_key)
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.evaluation_runs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            schema_version_id uuid NOT NULL REFERENCES public.evaluation_schema_versions(id) ON DELETE RESTRICT,
            name varchar NOT NULL,
            status evaluation_run_status NOT NULL DEFAULT 'pending',
            current_stage evaluation_run_stage NOT NULL DEFAULT 'proposal',
            started_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
            started_at timestamptz NOT NULL DEFAULT now(),
            completed_at timestamptz,
            failed_reason text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.evaluation_run_targets (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id uuid NOT NULL REFERENCES public.evaluation_runs(id) ON DELETE CASCADE,
            target_id uuid NOT NULL,
            target_type varchar NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT evaluation_run_targets_run_id_target_id_key UNIQUE (run_id, target_id)
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.proposal_records (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            run_id uuid NOT NULL REFERENCES public.evaluation_runs(id) ON DELETE CASCADE,
            target_id uuid NOT NULL,
            item_id uuid NOT NULL REFERENCES public.evaluation_items(id) ON DELETE RESTRICT,
            schema_version_id uuid NOT NULL REFERENCES public.evaluation_schema_versions(id) ON DELETE RESTRICT,
            source_type evaluation_proposal_source_type NOT NULL,
            value_json jsonb NOT NULL,
            confidence numeric,
            created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.reviewer_decision_records (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            run_id uuid NOT NULL REFERENCES public.evaluation_runs(id) ON DELETE CASCADE,
            target_id uuid NOT NULL,
            item_id uuid NOT NULL REFERENCES public.evaluation_items(id) ON DELETE RESTRICT,
            schema_version_id uuid NOT NULL REFERENCES public.evaluation_schema_versions(id) ON DELETE RESTRICT,
            reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
            proposal_id uuid REFERENCES public.proposal_records(id) ON DELETE SET NULL,
            decision reviewer_decision_type NOT NULL,
            edited_value_json jsonb,
            rationale text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.reviewer_states (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
            target_id uuid NOT NULL,
            item_id uuid NOT NULL REFERENCES public.evaluation_items(id) ON DELETE RESTRICT,
            schema_version_id uuid NOT NULL REFERENCES public.evaluation_schema_versions(id) ON DELETE RESTRICT,
            latest_decision_id uuid NOT NULL REFERENCES public.reviewer_decision_records(id) ON DELETE CASCADE,
            latest_decision reviewer_decision_type NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT reviewer_states_reviewer_id_target_id_item_id_schema_version_id_key
                UNIQUE (reviewer_id, target_id, item_id, schema_version_id)
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.consensus_decision_records (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            target_id uuid NOT NULL,
            item_id uuid NOT NULL REFERENCES public.evaluation_items(id) ON DELETE RESTRICT,
            schema_version_id uuid NOT NULL REFERENCES public.evaluation_schema_versions(id) ON DELETE RESTRICT,
            run_id uuid REFERENCES public.evaluation_runs(id) ON DELETE SET NULL,
            decision_maker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
            mode consensus_decision_mode NOT NULL,
            selected_reviewer_decision_id uuid REFERENCES public.reviewer_decision_records(id) ON DELETE SET NULL,
            override_value_json jsonb,
            override_justification text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.published_states (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            target_id uuid NOT NULL,
            item_id uuid NOT NULL REFERENCES public.evaluation_items(id) ON DELETE RESTRICT,
            schema_version_id uuid NOT NULL REFERENCES public.evaluation_schema_versions(id) ON DELETE RESTRICT,
            latest_consensus_decision_id uuid NOT NULL
                REFERENCES public.consensus_decision_records(id) ON DELETE CASCADE,
            published_value_json jsonb NOT NULL,
            published_status published_state_status NOT NULL DEFAULT 'published',
            published_at timestamptz NOT NULL DEFAULT now(),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT published_states_project_id_target_id_item_id_schema_version_id_key
                UNIQUE (project_id, target_id, item_id, schema_version_id)
        );
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.evidence_records (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            entity_type evidence_entity_type NOT NULL,
            entity_id uuid NOT NULL,
            storage_path text NOT NULL,
            filename text NOT NULL,
            mime_type text NOT NULL,
            size_bytes integer NOT NULL CHECK (size_bytes <= 26214400),
            uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )

    op.execute("CREATE INDEX IF NOT EXISTS ix_evaluation_schemas_project_id ON public.evaluation_schemas(project_id);")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_evaluation_schema_versions_schema_id ON public.evaluation_schema_versions(schema_id);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_evaluation_items_schema_version_id ON public.evaluation_items(schema_version_id);"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_evaluation_runs_project_id ON public.evaluation_runs(project_id);")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_evaluation_runs_schema_version_id ON public.evaluation_runs(schema_version_id);"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_evaluation_run_targets_run_id ON public.evaluation_run_targets(run_id);")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_evaluation_run_targets_target_id ON public.evaluation_run_targets(target_id);"
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_proposal_records_project_run_target_item_created
        ON public.proposal_records(project_id, run_id, target_id, item_id, created_at DESC);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_reviewer_decisions_project_reviewer_target_item_created
        ON public.reviewer_decision_records(project_id, reviewer_id, target_id, item_id, created_at DESC);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_consensus_records_project_target_item_schema_created
        ON public.consensus_decision_records(project_id, target_id, item_id, schema_version_id, created_at DESC);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_published_states_project_target_item_schema
        ON public.published_states(project_id, target_id, item_id, schema_version_id);
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_reviewer_states_project_id ON public.reviewer_states(project_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_evidence_records_project_id ON public.evidence_records(project_id);")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.enforce_consensus_override_justification()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NEW.mode = 'manual_override'
                AND (NEW.override_justification IS NULL OR btrim(NEW.override_justification) = '') THEN
                RAISE EXCEPTION 'Override justification is required for manual override mode'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_enforce_consensus_override_justification
        BEFORE INSERT OR UPDATE ON public.consensus_decision_records
        FOR EACH ROW EXECUTE FUNCTION public.enforce_consensus_override_justification();
        """
    )

    for table_name in (
        "evaluation_schemas",
        "evaluation_schema_versions",
        "evaluation_items",
        "evaluation_runs",
        "evaluation_run_targets",
        "proposal_records",
        "reviewer_decision_records",
        "reviewer_states",
        "consensus_decision_records",
        "published_states",
        "evidence_records",
    ):
        op.execute(f"DROP TRIGGER IF EXISTS update_{table_name}_updated_at ON public.{table_name};")
        op.execute(
            f"""
            CREATE TRIGGER update_{table_name}_updated_at
            BEFORE UPDATE ON public.{table_name}
            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
            """
        )

    for table_name in (
        "evaluation_schemas",
        "evaluation_schema_versions",
        "evaluation_items",
        "evaluation_runs",
        "evaluation_run_targets",
        "proposal_records",
        "reviewer_decision_records",
        "reviewer_states",
        "consensus_decision_records",
        "published_states",
        "evidence_records",
    ):
        op.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;")

    for table_name in (
        "evaluation_schemas",
        "evaluation_runs",
        "proposal_records",
        "reviewer_decision_records",
        "reviewer_states",
        "consensus_decision_records",
        "published_states",
        "evidence_records",
    ):
        op.execute(
            f"""
            CREATE POLICY {table_name}_select ON public.{table_name}
            FOR SELECT USING (public.is_project_member(project_id, auth.uid()));
            """
        )
        op.execute(
            f"""
            CREATE POLICY {table_name}_insert ON public.{table_name}
            FOR INSERT WITH CHECK (public.is_project_member(project_id, auth.uid()));
            """
        )
        op.execute(
            f"""
            CREATE POLICY {table_name}_update ON public.{table_name}
            FOR UPDATE USING (public.is_project_member(project_id, auth.uid()))
            WITH CHECK (public.is_project_member(project_id, auth.uid()));
            """
        )
        op.execute(
            f"""
            CREATE POLICY {table_name}_delete ON public.{table_name}
            FOR DELETE USING (public.is_project_member(project_id, auth.uid()));
            """
        )

    op.execute(
        """
        CREATE POLICY evaluation_schema_versions_select ON public.evaluation_schema_versions
        FOR SELECT USING (
            EXISTS (
                SELECT 1
                FROM public.evaluation_schemas es
                WHERE es.id = evaluation_schema_versions.schema_id
                  AND public.is_project_member(es.project_id, auth.uid())
            )
        );
        """
    )
    op.execute(
        """
        CREATE POLICY evaluation_schema_versions_insert ON public.evaluation_schema_versions
        FOR INSERT WITH CHECK (
            EXISTS (
                SELECT 1
                FROM public.evaluation_schemas es
                WHERE es.id = evaluation_schema_versions.schema_id
                  AND public.is_project_member(es.project_id, auth.uid())
            )
        );
        """
    )
    op.execute(
        """
        CREATE POLICY evaluation_schema_versions_update ON public.evaluation_schema_versions
        FOR UPDATE USING (
            EXISTS (
                SELECT 1
                FROM public.evaluation_schemas es
                WHERE es.id = evaluation_schema_versions.schema_id
                  AND public.is_project_member(es.project_id, auth.uid())
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1
                FROM public.evaluation_schemas es
                WHERE es.id = evaluation_schema_versions.schema_id
                  AND public.is_project_member(es.project_id, auth.uid())
            )
        );
        """
    )
    op.execute(
        """
        CREATE POLICY evaluation_schema_versions_delete ON public.evaluation_schema_versions
        FOR DELETE USING (
            EXISTS (
                SELECT 1
                FROM public.evaluation_schemas es
                WHERE es.id = evaluation_schema_versions.schema_id
                  AND public.is_project_member(es.project_id, auth.uid())
            )
        );
        """
    )

    op.execute(
        """
        CREATE POLICY evaluation_items_select ON public.evaluation_items
        FOR SELECT USING (
            EXISTS (
                SELECT 1
                FROM public.evaluation_schema_versions v
                JOIN public.evaluation_schemas s ON s.id = v.schema_id
                WHERE v.id = evaluation_items.schema_version_id
                  AND public.is_project_member(s.project_id, auth.uid())
            )
        );
        """
    )
    op.execute(
        """
        CREATE POLICY evaluation_items_insert ON public.evaluation_items
        FOR INSERT WITH CHECK (
            EXISTS (
                SELECT 1
                FROM public.evaluation_schema_versions v
                JOIN public.evaluation_schemas s ON s.id = v.schema_id
                WHERE v.id = evaluation_items.schema_version_id
                  AND public.is_project_member(s.project_id, auth.uid())
            )
        );
        """
    )
    op.execute(
        """
        CREATE POLICY evaluation_items_update ON public.evaluation_items
        FOR UPDATE USING (
            EXISTS (
                SELECT 1
                FROM public.evaluation_schema_versions v
                JOIN public.evaluation_schemas s ON s.id = v.schema_id
                WHERE v.id = evaluation_items.schema_version_id
                  AND public.is_project_member(s.project_id, auth.uid())
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1
                FROM public.evaluation_schema_versions v
                JOIN public.evaluation_schemas s ON s.id = v.schema_id
                WHERE v.id = evaluation_items.schema_version_id
                  AND public.is_project_member(s.project_id, auth.uid())
            )
        );
        """
    )
    op.execute(
        """
        CREATE POLICY evaluation_items_delete ON public.evaluation_items
        FOR DELETE USING (
            EXISTS (
                SELECT 1
                FROM public.evaluation_schema_versions v
                JOIN public.evaluation_schemas s ON s.id = v.schema_id
                WHERE v.id = evaluation_items.schema_version_id
                  AND public.is_project_member(s.project_id, auth.uid())
            )
        );
        """
    )


def downgrade() -> None:
    """Drop unified evaluation schema, tables, indexes, and enums."""
    for table_name in (
        "evaluation_items",
        "evaluation_schema_versions",
        "evaluation_schemas",
        "evaluation_runs",
        "evaluation_run_targets",
        "proposal_records",
        "reviewer_decision_records",
        "reviewer_states",
        "consensus_decision_records",
        "published_states",
        "evidence_records",
    ):
        op.execute(f"ALTER TABLE IF EXISTS public.{table_name} DISABLE ROW LEVEL SECURITY;")

    for policy, table_name in (
        ("evaluation_items_delete", "evaluation_items"),
        ("evaluation_items_update", "evaluation_items"),
        ("evaluation_items_insert", "evaluation_items"),
        ("evaluation_items_select", "evaluation_items"),
        ("evaluation_schema_versions_delete", "evaluation_schema_versions"),
        ("evaluation_schema_versions_update", "evaluation_schema_versions"),
        ("evaluation_schema_versions_insert", "evaluation_schema_versions"),
        ("evaluation_schema_versions_select", "evaluation_schema_versions"),
        ("evaluation_schemas_delete", "evaluation_schemas"),
        ("evaluation_schemas_update", "evaluation_schemas"),
        ("evaluation_schemas_insert", "evaluation_schemas"),
        ("evaluation_schemas_select", "evaluation_schemas"),
        ("evaluation_runs_delete", "evaluation_runs"),
        ("evaluation_runs_update", "evaluation_runs"),
        ("evaluation_runs_insert", "evaluation_runs"),
        ("evaluation_runs_select", "evaluation_runs"),
        ("proposal_records_delete", "proposal_records"),
        ("proposal_records_update", "proposal_records"),
        ("proposal_records_insert", "proposal_records"),
        ("proposal_records_select", "proposal_records"),
        ("reviewer_decision_records_delete", "reviewer_decision_records"),
        ("reviewer_decision_records_update", "reviewer_decision_records"),
        ("reviewer_decision_records_insert", "reviewer_decision_records"),
        ("reviewer_decision_records_select", "reviewer_decision_records"),
        ("reviewer_states_delete", "reviewer_states"),
        ("reviewer_states_update", "reviewer_states"),
        ("reviewer_states_insert", "reviewer_states"),
        ("reviewer_states_select", "reviewer_states"),
        ("consensus_decision_records_delete", "consensus_decision_records"),
        ("consensus_decision_records_update", "consensus_decision_records"),
        ("consensus_decision_records_insert", "consensus_decision_records"),
        ("consensus_decision_records_select", "consensus_decision_records"),
        ("published_states_delete", "published_states"),
        ("published_states_update", "published_states"),
        ("published_states_insert", "published_states"),
        ("published_states_select", "published_states"),
        ("evidence_records_delete", "evidence_records"),
        ("evidence_records_update", "evidence_records"),
        ("evidence_records_insert", "evidence_records"),
        ("evidence_records_select", "evidence_records"),
    ):
        op.execute(f"DROP POLICY IF EXISTS {policy} ON public.{table_name};")

    op.execute("DROP TRIGGER IF EXISTS trg_enforce_consensus_override_justification ON public.consensus_decision_records;")
    op.execute("DROP FUNCTION IF EXISTS public.enforce_consensus_override_justification();")

    for table_name in (
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
    ):
        op.execute(f"DROP TABLE IF EXISTS public.{table_name} CASCADE;")

    op.execute("DROP TYPE IF EXISTS evidence_entity_type;")
    op.execute("DROP TYPE IF EXISTS published_state_status;")
    op.execute("DROP TYPE IF EXISTS consensus_decision_mode;")
    op.execute("DROP TYPE IF EXISTS reviewer_decision_type;")
    op.execute("DROP TYPE IF EXISTS evaluation_proposal_source_type;")
    op.execute("DROP TYPE IF EXISTS evaluation_run_stage;")
    op.execute("DROP TYPE IF EXISTS evaluation_run_status;")
    op.execute("DROP TYPE IF EXISTS evaluation_item_type;")
    op.execute("DROP TYPE IF EXISTS evaluation_schema_version_status;")
