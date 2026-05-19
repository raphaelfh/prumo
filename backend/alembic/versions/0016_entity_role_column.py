"""Promote "model container" from magic string to first-class schema column

Revision ID: 0016_entity_role_column
Revises: 0015_charms_studylevel_split
Create Date: 2026-05-17

Before this migration, the "this entity_type is the prediction-model
container that drives the model-selector UI" idea lived entirely in
matching the literal string ``name = 'prediction_models'``. That magic
string was duplicated across 6 frontend files and 3 backend services,
each with slightly different filters and no DB-level guarantee that
exactly one such entity type exists per template.

This migration replaces the convention with a structural column:

    CREATE TYPE extraction_entity_role AS ENUM (
        'study_section',   -- root, rendered as top-level accordion
        'model_container', -- root cardinality='many', drives ModelSelector
        'model_section'    -- child of a model_container
    );

Invariants enforced at the DB level (state-after-backfill is
non-representable for anything inconsistent):

1. ``role`` is NOT NULL with no default after backfill — every existing
   row gets the correct value via the same heuristic the magic-string
   filters used (``name='prediction_models' AND parent IS NULL AND
   cardinality='many'`` → ``model_container``; child of a model_container
   → ``model_section``; everything else → ``study_section``).
2. Partial unique indexes:
   ``(template_id) WHERE role='model_container'``
   ``(project_template_id) WHERE role='model_container'``
   make a second model_container per template unrepresentable.
3. CHECK ``ck_extraction_entity_types_role_parent`` couples role and
   parent: ``study_section`` and ``model_container`` are roots (parent
   IS NULL); ``model_section`` requires a parent. Parent's role
   (must be ``model_container``) is enforced by a deferred trigger
   so we tolerate the chicken-and-egg of inserting parent+children in
   the same transaction.

Downgrade drops the column, indexes, trigger, and enum. Data already
lived in the structure (name + parent + cardinality) so no information
is lost.
"""

import sqlalchemy as sa

from alembic import op

revision = "0016_entity_role_column"
down_revision = "0015_charms_studylevel_split"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1 — create the enum type.
    op.execute(
        """
        CREATE TYPE public.extraction_entity_role AS ENUM (
            'study_section',
            'model_container',
            'model_section'
        )
        """
    )

    # Step 2 — add the column with a temporary default so existing rows
    # are populated without violating NOT NULL. The default is dropped at
    # the end of this migration so future inserts MUST set the role
    # explicitly (no silent fallbacks).
    op.add_column(
        "extraction_entity_types",
        sa.Column(
            "role",
            sa.Enum(
                "study_section",
                "model_container",
                "model_section",
                name="extraction_entity_role",
                schema="public",
                create_type=False,
            ),
            nullable=False,
            server_default="study_section",
        ),
        schema="public",
    )

    # Step 3 — backfill from the existing structure. Order matters:
    # containers first (so the children's UPDATE can see them), then
    # children, then defaults stay as 'study_section'.
    op.execute(
        """
        UPDATE public.extraction_entity_types
        SET role = 'model_container'
        WHERE name = 'prediction_models'
          AND parent_entity_type_id IS NULL
          AND cardinality = 'many'
        """
    )
    op.execute(
        """
        UPDATE public.extraction_entity_types AS child
        SET role = 'model_section'
        FROM public.extraction_entity_types AS parent
        WHERE child.parent_entity_type_id = parent.id
          AND parent.role = 'model_container'
        """
    )

    # Step 4 — drop the temporary default. From here on, every insert
    # must set role explicitly. The seed and TemplateCloneService both
    # do this after the accompanying code changes.
    op.alter_column(
        "extraction_entity_types",
        "role",
        server_default=None,
        schema="public",
    )

    # Step 5 — invariant: at most one model_container per template (both
    # global and project-scope). Partial unique indexes.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_extraction_entity_types_one_container_per_global
        ON public.extraction_entity_types (template_id)
        WHERE role = 'model_container' AND template_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_extraction_entity_types_one_container_per_project
        ON public.extraction_entity_types (project_template_id)
        WHERE role = 'model_container' AND project_template_id IS NOT NULL
        """
    )

    # Step 6 — CHECK: parent presence must match role. Roots are
    # ``study_section`` and ``model_container``; ``model_section`` MUST
    # have a parent.
    op.execute(
        """
        ALTER TABLE public.extraction_entity_types
        ADD CONSTRAINT ck_extraction_entity_types_role_parent
        CHECK (
            (role IN ('study_section', 'model_container') AND parent_entity_type_id IS NULL)
            OR
            (role = 'model_section' AND parent_entity_type_id IS NOT NULL)
        )
        """
    )

    # Step 7 — Trigger: ``model_section`` rows can only parent under a
    # ``model_container``. A CHECK can't reference another row, so a
    # trigger is the right tool. INITIALLY DEFERRED so a transaction can
    # insert parent and child in any order (which TemplateCloneService
    # does after topologically sorting).
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.check_model_section_parent_role()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            parent_role text;
        BEGIN
            IF NEW.role <> 'model_section' THEN
                RETURN NEW;
            END IF;
            SELECT role INTO parent_role
              FROM public.extraction_entity_types
             WHERE id = NEW.parent_entity_type_id;
            IF parent_role IS NULL THEN
                RAISE EXCEPTION
                    'model_section % has no parent row %',
                    NEW.id, NEW.parent_entity_type_id
                    USING ERRCODE = 'foreign_key_violation';
            END IF;
            IF parent_role <> 'model_container' THEN
                RAISE EXCEPTION
                    'model_section % must have a model_container parent, '
                    'got parent role %',
                    NEW.id, parent_role
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER trg_check_model_section_parent_role
        AFTER INSERT OR UPDATE OF role, parent_entity_type_id
        ON public.extraction_entity_types
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION public.check_model_section_parent_role()
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_check_model_section_parent_role "
        "ON public.extraction_entity_types"
    )
    op.execute("DROP FUNCTION IF EXISTS public.check_model_section_parent_role()")
    op.execute(
        "ALTER TABLE public.extraction_entity_types "
        "DROP CONSTRAINT IF EXISTS ck_extraction_entity_types_role_parent"
    )
    op.execute(
        "DROP INDEX IF EXISTS public.uq_extraction_entity_types_one_container_per_project"
    )
    op.execute(
        "DROP INDEX IF EXISTS public.uq_extraction_entity_types_one_container_per_global"
    )
    op.drop_column("extraction_entity_types", "role", schema="public")
    op.execute("DROP TYPE IF EXISTS public.extraction_entity_role")
