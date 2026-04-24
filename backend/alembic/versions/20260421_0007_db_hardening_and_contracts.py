"""harden constraints, RLS policies, and SECURITY DEFINER functions

Revision ID: 20260421_0007
Revises: 20260328_006
Create Date: 2026-04-21

Do not use naive ``split(";")``: ``DO $$`` blocks and PL/pgSQL functions contain
internal semicolons and would break. Each ``op.execute()`` below is one complete
PostgreSQL command.
"""

from alembic import op

revision: str = "20260421_0007"
down_revision: str | None = "20260328_006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------------------------------------------------------------------
    # 1) Data pre-checks before adding hard constraints
    # ---------------------------------------------------------------------
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM public.assessment_instances
                WHERE (instrument_id IS NULL AND project_instrument_id IS NULL)
                   OR (instrument_id IS NOT NULL AND project_instrument_id IS NOT NULL)
            ) THEN
                RAISE EXCEPTION 'Cannot add XOR constraint: assessment_instances contains invalid instrument references.';
            END IF;
        END;
        $$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM public.extraction_entity_types
                WHERE (template_id IS NULL AND project_template_id IS NULL)
                   OR (template_id IS NOT NULL AND project_template_id IS NOT NULL)
            ) THEN
                RAISE EXCEPTION 'Cannot add XOR constraint: extraction_entity_types contains invalid template references.';
            END IF;
        END;
        $$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM public.ai_suggestions s
                WHERE
                    ((s.extraction_run_id IS NULL) = (s.assessment_run_id IS NULL))
                    OR
                    (s.extraction_run_id IS NOT NULL AND (s.assessment_item_id IS NOT NULL OR s.project_assessment_item_id IS NOT NULL))
                    OR
                    (s.assessment_run_id IS NOT NULL AND (s.instance_id IS NOT NULL OR s.field_id IS NOT NULL))
                    OR
                    (
                        s.assessment_run_id IS NOT NULL
                        AND ((s.assessment_item_id IS NULL) = (s.project_assessment_item_id IS NULL))
                    )
            ) THEN
                RAISE EXCEPTION 'Cannot add ai_suggestions constraints: table contains invalid hybrid suggestion rows.';
            END IF;
        END;
        $$;
        """
    )

    # ---------------------------------------------------------------------
    # 2) Structural constraints for domain invariants
    # ---------------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE public.assessment_instances
            ADD CONSTRAINT ck_assessment_instances_instrument_xor
            CHECK ((instrument_id IS NULL) <> (project_instrument_id IS NULL));
        """
    )
    op.execute(
        """
        ALTER TABLE public.extraction_entity_types
            ADD CONSTRAINT ck_extraction_entity_types_template_xor
            CHECK ((template_id IS NULL) <> (project_template_id IS NULL));
        """
    )
    op.execute(
        """
        ALTER TABLE public.ai_suggestions
            ADD CONSTRAINT ck_ai_suggestions_run_xor
            CHECK ((extraction_run_id IS NULL) <> (assessment_run_id IS NULL));
        """
    )
    op.execute(
        """
        ALTER TABLE public.ai_suggestions
            ADD CONSTRAINT ck_ai_suggestions_extraction_refs
            CHECK (
                extraction_run_id IS NULL
                OR (assessment_item_id IS NULL AND project_assessment_item_id IS NULL)
            );
        """
    )
    op.execute(
        """
        ALTER TABLE public.ai_suggestions
            ADD CONSTRAINT ck_ai_suggestions_assessment_refs
            CHECK (
                assessment_run_id IS NULL
                OR (instance_id IS NULL AND field_id IS NULL)
            );
        """
    )
    op.execute(
        """
        ALTER TABLE public.ai_suggestions
            ADD CONSTRAINT ck_ai_suggestions_assessment_item_xor
            CHECK (
                assessment_run_id IS NULL
                OR ((assessment_item_id IS NULL) <> (project_assessment_item_id IS NULL))
            );
        """
    )

    # ---------------------------------------------------------------------
    # 3) Cardinality=one enforcement for extraction instances
    # ---------------------------------------------------------------------
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.check_cardinality_one(
            p_article_id UUID,
            p_entity_type_id UUID,
            p_parent_instance_id UUID DEFAULT NULL
        ) RETURNS BOOLEAN
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public
        AS $$
        DECLARE
            v_cardinality extraction_cardinality;
            v_parent_key UUID := COALESCE(p_parent_instance_id, '00000000-0000-0000-0000-000000000000'::uuid);
        BEGIN
            PERFORM pg_advisory_xact_lock(hashtextextended(
                p_article_id::text || ':' || p_entity_type_id::text || ':' || v_parent_key::text,
                0
            ));

            SELECT et.cardinality
            INTO v_cardinality
            FROM public.extraction_entity_types et
            WHERE et.id = p_entity_type_id;

            IF v_cardinality IS DISTINCT FROM 'one' THEN
                RETURN TRUE;
            END IF;

            RETURN NOT EXISTS (
                SELECT 1
                FROM public.extraction_instances ei
                WHERE ei.article_id = p_article_id
                  AND ei.entity_type_id = p_entity_type_id
                  AND ei.parent_instance_id IS NOT DISTINCT FROM p_parent_instance_id
            );
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.enforce_extraction_instance_cardinality()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SET search_path = public
        AS $$
        DECLARE
            v_cardinality extraction_cardinality;
            v_parent_key UUID := COALESCE(NEW.parent_instance_id, '00000000-0000-0000-0000-000000000000'::uuid);
        BEGIN
            IF NEW.article_id IS NULL THEN
                RETURN NEW;
            END IF;

            SELECT et.cardinality
            INTO v_cardinality
            FROM public.extraction_entity_types et
            WHERE et.id = NEW.entity_type_id;

            IF v_cardinality IS DISTINCT FROM 'one' THEN
                RETURN NEW;
            END IF;

            PERFORM pg_advisory_xact_lock(hashtextextended(
                NEW.article_id::text || ':' || NEW.entity_type_id::text || ':' || v_parent_key::text,
                0
            ));

            IF EXISTS (
                SELECT 1
                FROM public.extraction_instances ei
                WHERE ei.article_id = NEW.article_id
                  AND ei.entity_type_id = NEW.entity_type_id
                  AND ei.parent_instance_id IS NOT DISTINCT FROM NEW.parent_instance_id
                  AND (TG_OP = 'INSERT' OR ei.id <> NEW.id)
            ) THEN
                RAISE EXCEPTION 'Cardinality violation: only one extraction instance is allowed for this entity/article/parent context.'
                    USING ERRCODE = '23505';
            END IF;

            RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_enforce_extraction_instance_cardinality ON public.extraction_instances;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_enforce_extraction_instance_cardinality
            BEFORE INSERT OR UPDATE OF article_id, entity_type_id, parent_instance_id
            ON public.extraction_instances
            FOR EACH ROW
            EXECUTE FUNCTION public.enforce_extraction_instance_cardinality();
        """
    )

    # ---------------------------------------------------------------------
    # 4) SECURITY DEFINER hardening: deterministic search_path
    # ---------------------------------------------------------------------
    op.execute(
        "ALTER FUNCTION public.is_project_member(uuid, uuid) SET search_path = public, pg_temp;"
    )
    op.execute(
        "ALTER FUNCTION public.is_project_manager(uuid, uuid) SET search_path = public, pg_temp;"
    )
    op.execute(
        "ALTER FUNCTION public.create_project_with_member(text, text, review_type, uuid) "
        "SET search_path = public, pg_temp;"
    )
    op.execute(
        "ALTER FUNCTION public.find_user_id_by_email(text) SET search_path = public, pg_temp;"
    )
    op.execute(
        "ALTER FUNCTION public.get_project_members(uuid) SET search_path = public, pg_temp;"
    )
    op.execute(
        "ALTER FUNCTION public.clone_global_instrument_to_project(uuid, uuid, uuid, text) "
        "SET search_path = public, pg_temp;"
    )
    op.execute(
        "ALTER FUNCTION public.assessments_insert_trigger() SET search_path = public, pg_temp;"
    )
    op.execute(
        "ALTER FUNCTION public.assessments_update_trigger() SET search_path = public, pg_temp;"
    )
    op.execute(
        "ALTER FUNCTION public.assessments_delete_trigger() SET search_path = public, pg_temp;"
    )
    op.execute(
        "ALTER FUNCTION public.check_cardinality_one(uuid, uuid, uuid) SET search_path = public, pg_temp;"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.check_cardinality_one(uuid, uuid, uuid) TO authenticated, service_role;"
    )

    # ---------------------------------------------------------------------
    # 5) RLS tightening for project-level assessment configuration
    # ---------------------------------------------------------------------
    op.execute(
        'DROP POLICY IF EXISTS "Users can insert project instruments" ON public.project_assessment_instruments;'
    )
    op.execute(
        'DROP POLICY IF EXISTS "Users can update project instruments" ON public.project_assessment_instruments;'
    )
    op.execute(
        'DROP POLICY IF EXISTS "Users can delete project instruments" ON public.project_assessment_instruments;'
    )
    op.execute(
        """
        CREATE POLICY "Managers can insert project instruments"
            ON public.project_assessment_instruments FOR INSERT
            WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM public.project_members pm
                    WHERE pm.project_id = project_assessment_instruments.project_id
                      AND pm.user_id = auth.uid()
                      AND pm.role = 'manager'
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY "Managers can update project instruments"
            ON public.project_assessment_instruments FOR UPDATE
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.project_members pm
                    WHERE pm.project_id = project_assessment_instruments.project_id
                      AND pm.user_id = auth.uid()
                      AND pm.role = 'manager'
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM public.project_members pm
                    WHERE pm.project_id = project_assessment_instruments.project_id
                      AND pm.user_id = auth.uid()
                      AND pm.role = 'manager'
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY "Managers can delete project instruments"
            ON public.project_assessment_instruments FOR DELETE
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.project_members pm
                    WHERE pm.project_id = project_assessment_instruments.project_id
                      AND pm.user_id = auth.uid()
                      AND pm.role = 'manager'
                )
            );
        """
    )
    op.execute('DROP POLICY IF EXISTS "Users can insert project items" ON public.project_assessment_items;')
    op.execute('DROP POLICY IF EXISTS "Users can update project items" ON public.project_assessment_items;')
    op.execute('DROP POLICY IF EXISTS "Users can delete project items" ON public.project_assessment_items;')
    op.execute(
        """
        CREATE POLICY "Managers can insert project items"
            ON public.project_assessment_items FOR INSERT
            WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM public.project_assessment_instruments pai
                    JOIN public.project_members pm ON pm.project_id = pai.project_id
                    WHERE pai.id = project_assessment_items.project_instrument_id
                      AND pm.user_id = auth.uid()
                      AND pm.role = 'manager'
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY "Managers can update project items"
            ON public.project_assessment_items FOR UPDATE
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.project_assessment_instruments pai
                    JOIN public.project_members pm ON pm.project_id = pai.project_id
                    WHERE pai.id = project_assessment_items.project_instrument_id
                      AND pm.user_id = auth.uid()
                      AND pm.role = 'manager'
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM public.project_assessment_instruments pai
                    JOIN public.project_members pm ON pm.project_id = pai.project_id
                    WHERE pai.id = project_assessment_items.project_instrument_id
                      AND pm.user_id = auth.uid()
                      AND pm.role = 'manager'
                )
            );
        """
    )
    op.execute(
        """
        CREATE POLICY "Managers can delete project items"
            ON public.project_assessment_items FOR DELETE
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.project_assessment_instruments pai
                    JOIN public.project_members pm ON pm.project_id = pai.project_id
                    WHERE pai.id = project_assessment_items.project_instrument_id
                      AND pm.user_id = auth.uid()
                      AND pm.role = 'manager'
                )
            );
        """
    )


def downgrade() -> None:
    op.execute('DROP POLICY IF EXISTS "Managers can delete project items" ON public.project_assessment_items;')
    op.execute('DROP POLICY IF EXISTS "Managers can update project items" ON public.project_assessment_items;')
    op.execute('DROP POLICY IF EXISTS "Managers can insert project items" ON public.project_assessment_items;')
    op.execute(
        """
        CREATE POLICY "Users can insert project items"
            ON public.project_assessment_items FOR INSERT
            WITH CHECK (project_instrument_id IN (
                SELECT pai.id
                FROM public.project_assessment_instruments pai
                JOIN public.project_members pm ON pm.project_id = pai.project_id
                WHERE pm.user_id = auth.uid()
            ));
        """
    )
    op.execute(
        """
        CREATE POLICY "Users can update project items"
            ON public.project_assessment_items FOR UPDATE
            USING (project_instrument_id IN (
                SELECT pai.id
                FROM public.project_assessment_instruments pai
                JOIN public.project_members pm ON pm.project_id = pai.project_id
                WHERE pm.user_id = auth.uid()
            ));
        """
    )
    op.execute(
        """
        CREATE POLICY "Users can delete project items"
            ON public.project_assessment_items FOR DELETE
            USING (project_instrument_id IN (
                SELECT pai.id
                FROM public.project_assessment_instruments pai
                JOIN public.project_members pm ON pm.project_id = pai.project_id
                WHERE pm.user_id = auth.uid()
            ));
        """
    )
    op.execute(
        'DROP POLICY IF EXISTS "Managers can delete project instruments" ON public.project_assessment_instruments;'
    )
    op.execute(
        'DROP POLICY IF EXISTS "Managers can update project instruments" ON public.project_assessment_instruments;'
    )
    op.execute(
        'DROP POLICY IF EXISTS "Managers can insert project instruments" ON public.project_assessment_instruments;'
    )
    op.execute(
        """
        CREATE POLICY "Users can insert project instruments"
            ON public.project_assessment_instruments FOR INSERT
            WITH CHECK (project_id IN (
                SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
            ));
        """
    )
    op.execute(
        """
        CREATE POLICY "Users can update project instruments"
            ON public.project_assessment_instruments FOR UPDATE
            USING (project_id IN (
                SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
            ));
        """
    )
    op.execute(
        """
        CREATE POLICY "Users can delete project instruments"
            ON public.project_assessment_instruments FOR DELETE
            USING (project_id IN (
                SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
            ));
        """
    )
    op.execute("ALTER FUNCTION public.assessments_delete_trigger() RESET search_path;")
    op.execute("ALTER FUNCTION public.assessments_update_trigger() RESET search_path;")
    op.execute("ALTER FUNCTION public.assessments_insert_trigger() RESET search_path;")
    op.execute(
        "ALTER FUNCTION public.clone_global_instrument_to_project(uuid, uuid, uuid, text) RESET search_path;"
    )
    op.execute("ALTER FUNCTION public.get_project_members(uuid) RESET search_path;")
    op.execute("ALTER FUNCTION public.find_user_id_by_email(text) RESET search_path;")
    op.execute(
        "ALTER FUNCTION public.create_project_with_member(text, text, review_type, uuid) RESET search_path;"
    )
    op.execute("ALTER FUNCTION public.is_project_manager(uuid, uuid) RESET search_path;")
    op.execute("ALTER FUNCTION public.is_project_member(uuid, uuid) RESET search_path;")
    op.execute("ALTER FUNCTION public.check_cardinality_one(uuid, uuid, uuid) RESET search_path;")

    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_enforce_extraction_instance_cardinality ON public.extraction_instances;
        """
    )
    op.execute("DROP FUNCTION IF EXISTS public.enforce_extraction_instance_cardinality();")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.check_cardinality_one(
            p_article_id UUID,
            p_entity_type_id UUID,
            p_parent_instance_id UUID DEFAULT NULL
        ) RETURNS BOOLEAN
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        BEGIN
            RETURN NOT EXISTS (
                SELECT 1
                FROM public.extraction_instances
                WHERE article_id = p_article_id
                  AND entity_type_id = p_entity_type_id
                  AND (
                    (p_parent_instance_id IS NULL AND parent_instance_id IS NULL)
                    OR parent_instance_id = p_parent_instance_id
                  )
            );
        END;
        $$;
        """
    )

    op.execute("ALTER TABLE public.ai_suggestions DROP CONSTRAINT IF EXISTS ck_ai_suggestions_assessment_item_xor;")
    op.execute("ALTER TABLE public.ai_suggestions DROP CONSTRAINT IF EXISTS ck_ai_suggestions_assessment_refs;")
    op.execute("ALTER TABLE public.ai_suggestions DROP CONSTRAINT IF EXISTS ck_ai_suggestions_extraction_refs;")
    op.execute("ALTER TABLE public.ai_suggestions DROP CONSTRAINT IF EXISTS ck_ai_suggestions_run_xor;")
    op.execute(
        "ALTER TABLE public.extraction_entity_types DROP CONSTRAINT IF EXISTS ck_extraction_entity_types_template_xor;"
    )
    op.execute(
        "ALTER TABLE public.assessment_instances DROP CONSTRAINT IF EXISTS ck_assessment_instances_instrument_xor;"
    )
