"""extraction template versions and HITL configs

Revision ID: 20260427_0010
Revises: 20260426_0009
Create Date: 2026-04-27
"""

from alembic import op

revision: str = "20260427_0010"
down_revision: str | None = "20260426_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enums (idempotent)
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hitl_config_scope_kind') THEN
                CREATE TYPE hitl_config_scope_kind AS ENUM ('project', 'template');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consensus_rule') THEN
                CREATE TYPE consensus_rule AS ENUM ('unanimous', 'majority', 'arbitrator');
            END IF;
        END
        $$;
        """
    )

    # extraction_template_versions
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.extraction_template_versions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_template_id uuid NOT NULL
                REFERENCES public.project_extraction_templates(id) ON DELETE CASCADE,
            version integer NOT NULL,
            schema jsonb NOT NULL,
            published_at timestamptz NOT NULL DEFAULT now(),
            published_by uuid NOT NULL
                REFERENCES public.profiles(id) ON DELETE RESTRICT,
            is_active boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_extraction_template_versions_template_version
                UNIQUE (project_template_id, version)
        );
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_extraction_template_versions_active
            ON public.extraction_template_versions (project_template_id)
            WHERE is_active;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_template_versions_template
            ON public.extraction_template_versions (project_template_id);
        """
    )

    # Backfill: one version=1 per existing project_extraction_template, marked active.
    # schema column captures a snapshot of the current entity_types + fields tree.
    op.execute(
        """
        INSERT INTO public.extraction_template_versions (
            project_template_id, version, schema, published_at, published_by, is_active
        )
        SELECT
            t.id,
            1,
            jsonb_build_object(
                'entity_types', COALESCE(
                    (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'id', et.id,
                                'name', et.name,
                                'label', et.label,
                                'parent_entity_type_id', et.parent_entity_type_id,
                                'cardinality', et.cardinality,
                                'sort_order', et.sort_order,
                                'is_required', et.is_required,
                                'fields', COALESCE(
                                    (
                                        SELECT jsonb_agg(jsonb_build_object(
                                            'id', f.id,
                                            'name', f.name,
                                            'label', f.label,
                                            'field_type', f.field_type,
                                            'is_required', f.is_required,
                                            'allowed_values', f.allowed_values,
                                            'sort_order', f.sort_order
                                        ) ORDER BY f.sort_order)
                                        FROM public.extraction_fields f
                                        WHERE f.entity_type_id = et.id
                                    ),
                                    '[]'::jsonb
                                )
                            ) ORDER BY et.sort_order
                        )
                        FROM public.extraction_entity_types et
                        WHERE et.project_template_id = t.id
                    ),
                    '[]'::jsonb
                )
            ),
            now(),
            t.created_by,
            true
        FROM public.project_extraction_templates t
        WHERE NOT EXISTS (
            SELECT 1 FROM public.extraction_template_versions v
            WHERE v.project_template_id = t.id
        );
        """
    )

    # extraction_hitl_configs
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.extraction_hitl_configs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            scope_kind hitl_config_scope_kind NOT NULL,
            scope_id uuid NOT NULL,
            reviewer_count integer NOT NULL CHECK (reviewer_count >= 1),
            consensus_rule consensus_rule NOT NULL,
            arbitrator_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_extraction_hitl_configs_scope UNIQUE (scope_kind, scope_id),
            CONSTRAINT ck_extraction_hitl_configs_arbitrator_required
                CHECK (consensus_rule <> 'arbitrator' OR arbitrator_id IS NOT NULL)
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_extraction_hitl_configs_scope
            ON public.extraction_hitl_configs (scope_kind, scope_id);
        """
    )

    # Triggers to maintain updated_at on UPDATE.
    for table_name in ("extraction_template_versions", "extraction_hitl_configs"):
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

    # RLS — extraction_template_versions inherits project membership from its template.
    op.execute("ALTER TABLE public.extraction_template_versions ENABLE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY extraction_template_versions_select
          ON public.extraction_template_versions FOR SELECT
          USING (
              EXISTS (
                  SELECT 1 FROM public.project_extraction_templates t
                  WHERE t.id = extraction_template_versions.project_template_id
                    AND public.is_project_member(t.project_id, auth.uid())
              )
          );
        """
    )
    op.execute(
        """
        CREATE POLICY extraction_template_versions_insert
          ON public.extraction_template_versions FOR INSERT
          WITH CHECK (
              EXISTS (
                  SELECT 1 FROM public.project_extraction_templates t
                  WHERE t.id = extraction_template_versions.project_template_id
                    AND public.is_project_manager(t.project_id, auth.uid())
              )
          );
        """
    )
    op.execute(
        """
        CREATE POLICY extraction_template_versions_update
          ON public.extraction_template_versions FOR UPDATE
          USING (
              EXISTS (
                  SELECT 1 FROM public.project_extraction_templates t
                  WHERE t.id = extraction_template_versions.project_template_id
                    AND public.is_project_manager(t.project_id, auth.uid())
              )
          )
          WITH CHECK (
              EXISTS (
                  SELECT 1 FROM public.project_extraction_templates t
                  WHERE t.id = extraction_template_versions.project_template_id
                    AND public.is_project_manager(t.project_id, auth.uid())
              )
          );
        """
    )
    op.execute(
        """
        CREATE POLICY extraction_template_versions_delete
          ON public.extraction_template_versions FOR DELETE
          USING (
              EXISTS (
                  SELECT 1 FROM public.project_extraction_templates t
                  WHERE t.id = extraction_template_versions.project_template_id
                    AND public.is_project_manager(t.project_id, auth.uid())
              )
          );
        """
    )

    # RLS — extraction_hitl_configs derives membership from scope (project or template).
    op.execute("ALTER TABLE public.extraction_hitl_configs ENABLE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY extraction_hitl_configs_select
          ON public.extraction_hitl_configs FOR SELECT
          USING (
              (extraction_hitl_configs.scope_kind = 'project'
                  AND public.is_project_member(extraction_hitl_configs.scope_id, auth.uid()))
              OR (extraction_hitl_configs.scope_kind = 'template'
                  AND EXISTS (
                      SELECT 1 FROM public.project_extraction_templates t
                      WHERE t.id = extraction_hitl_configs.scope_id
                        AND public.is_project_member(t.project_id, auth.uid())
                  ))
          );
        """
    )
    op.execute(
        """
        CREATE POLICY extraction_hitl_configs_insert
          ON public.extraction_hitl_configs FOR INSERT
          WITH CHECK (
              (extraction_hitl_configs.scope_kind = 'project'
                  AND public.is_project_manager(extraction_hitl_configs.scope_id, auth.uid()))
              OR (extraction_hitl_configs.scope_kind = 'template'
                  AND EXISTS (
                      SELECT 1 FROM public.project_extraction_templates t
                      WHERE t.id = extraction_hitl_configs.scope_id
                        AND public.is_project_manager(t.project_id, auth.uid())
                  ))
          );
        """
    )
    op.execute(
        """
        CREATE POLICY extraction_hitl_configs_update
          ON public.extraction_hitl_configs FOR UPDATE
          USING (
              (extraction_hitl_configs.scope_kind = 'project'
                  AND public.is_project_manager(extraction_hitl_configs.scope_id, auth.uid()))
              OR (extraction_hitl_configs.scope_kind = 'template'
                  AND EXISTS (
                      SELECT 1 FROM public.project_extraction_templates t
                      WHERE t.id = extraction_hitl_configs.scope_id
                        AND public.is_project_manager(t.project_id, auth.uid())
                  ))
          )
          WITH CHECK (
              (extraction_hitl_configs.scope_kind = 'project'
                  AND public.is_project_manager(extraction_hitl_configs.scope_id, auth.uid()))
              OR (extraction_hitl_configs.scope_kind = 'template'
                  AND EXISTS (
                      SELECT 1 FROM public.project_extraction_templates t
                      WHERE t.id = extraction_hitl_configs.scope_id
                        AND public.is_project_manager(t.project_id, auth.uid())
                  ))
          );
        """
    )
    op.execute(
        """
        CREATE POLICY extraction_hitl_configs_delete
          ON public.extraction_hitl_configs FOR DELETE
          USING (
              (extraction_hitl_configs.scope_kind = 'project'
                  AND public.is_project_manager(extraction_hitl_configs.scope_id, auth.uid()))
              OR (extraction_hitl_configs.scope_kind = 'template'
                  AND EXISTS (
                      SELECT 1 FROM public.project_extraction_templates t
                      WHERE t.id = extraction_hitl_configs.scope_id
                        AND public.is_project_manager(t.project_id, auth.uid())
                  ))
          );
        """
    )


def downgrade() -> None:
    for table_name in ("extraction_template_versions", "extraction_hitl_configs"):
        op.execute(
            f"DROP TRIGGER IF EXISTS update_{table_name}_updated_at ON public.{table_name};"
        )
    op.execute("DROP TABLE IF EXISTS public.extraction_hitl_configs CASCADE;")
    op.execute("DROP TABLE IF EXISTS public.extraction_template_versions CASCADE;")
    op.execute("DROP TYPE IF EXISTS consensus_rule;")
    op.execute("DROP TYPE IF EXISTS hitl_config_scope_kind;")
