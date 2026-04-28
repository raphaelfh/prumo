"""Make "project_extraction_template without active version" unrepresentable

Revision ID: 0004_template_active_version
Revises: 0003_storage_object_policies
Create Date: 2026-04-28

The QA flow blew up with ``assert version is not None`` when a
``project_extraction_template`` row survived but its sibling
``extraction_template_versions`` row was missing. The previous fix
papered over the symptom with a service-layer self-heal — that
hides the failure mode and lets the same bad state come back later.

Better: enforce the invariant at the DB layer with a *deferred*
constraint trigger. Anything that creates a project template in the
same transaction must also create an active version row by COMMIT;
otherwise the whole transaction aborts. The clone service can keep
flushing rows in any order, but a partial commit cannot land.

The trigger does NOT fire on rows that originate from CASCADE
deletes (the parent template is being removed, so the lack of a
version is fine). It also accepts ``is_active = false`` updates as
long as some other version row remains active for the template.
"""

from alembic import op

revision = "0004_template_active_version"
down_revision = "0003_storage_object_policies"
branch_labels = None
depends_on = None


_FUNCTION_CREATE = """
CREATE OR REPLACE FUNCTION public.assert_project_template_has_active_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_template_id uuid;
  v_active_count int;
BEGIN
  -- The function is reused by triggers on two tables. Resolve the
  -- template id from whichever row shape we just received.
  IF TG_TABLE_NAME = 'project_extraction_templates' THEN
    v_template_id := COALESCE(NEW.id, OLD.id);
  ELSE
    v_template_id := COALESCE(NEW.project_template_id, OLD.project_template_id);
  END IF;

  -- Skip when the parent template is gone (CASCADE in flight).
  PERFORM 1 FROM public.project_extraction_templates WHERE id = v_template_id;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.extraction_template_versions
  WHERE project_template_id = v_template_id AND is_active = true;

  IF v_active_count = 0 THEN
    RAISE EXCEPTION 'project_extraction_template % has no active version',
      v_template_id
      USING ERRCODE = 'check_violation',
            HINT = 'Every project_extraction_template requires exactly one '
                   'extraction_template_versions row with is_active = true.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
"""

_TRIGGER_ON_TEMPLATE = """
CREATE CONSTRAINT TRIGGER project_extraction_templates_active_version
AFTER INSERT ON public.project_extraction_templates
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.assert_project_template_has_active_version();
"""

_TRIGGER_ON_VERSION = """
CREATE CONSTRAINT TRIGGER extraction_template_versions_active_invariant
AFTER UPDATE OR DELETE ON public.extraction_template_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.assert_project_template_has_active_version();
"""


def upgrade() -> None:
    # Heal any pre-existing bad rows so the trigger doesn't break
    # subsequent transactions on those templates. The dev DB had at
    # least one such row from the bug we just fixed.
    op.execute(
        """
        WITH stranded AS (
          SELECT pet.id AS template_id, pet.created_by, NOW() AS now
          FROM public.project_extraction_templates pet
          LEFT JOIN public.extraction_template_versions etv
            ON etv.project_template_id = pet.id AND etv.is_active = true
          WHERE etv.id IS NULL
        )
        INSERT INTO public.extraction_template_versions (
          id, project_template_id, version, schema, published_at,
          published_by, is_active, created_at, updated_at
        )
        SELECT
          gen_random_uuid(),
          s.template_id,
          1,
          jsonb_build_object('entity_types', '[]'::jsonb),
          s.now,
          s.created_by,
          true,
          s.now,
          s.now
        FROM stranded s;
        """
    )

    op.execute(_FUNCTION_CREATE)
    op.execute(_TRIGGER_ON_TEMPLATE)
    op.execute(_TRIGGER_ON_VERSION)


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS extraction_template_versions_active_invariant "
        "ON public.extraction_template_versions;"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS project_extraction_templates_active_version "
        "ON public.project_extraction_templates;"
    )
    op.execute("DROP FUNCTION IF EXISTS public.assert_project_template_has_active_version();")
