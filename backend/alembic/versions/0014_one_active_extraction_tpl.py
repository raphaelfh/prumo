"""Single active extraction template per project — DB enforced

Revision ID: 0014_one_active_extraction_tpl
Revises: 0013_calc_model_progress_fix
Create Date: 2026-05-17

The extraction workflow assumes exactly one active extraction template
per project (``update_project_template_active`` refuses to deactivate
the last active one; ``TemplateCloneService.clone`` deactivates siblings
before creating a new active one). That contract was previously only
enforced at the service layer — a direct INSERT through a Supabase
client or a future caller that forgot the policy could leave the project
with two active extraction templates, which is exactly the bug that
split the Configuration view (newest active) from the Extraction view
(oldest active).

This migration closes the gap at the DB:

1. **Data cleanup**: for every project that currently has multiple active
   extraction templates, keep only the most-recently-created one active
   and demote the rest. Safe because the surviving template still
   carries its entity types / fields / instances / runs — only the
   ``is_active`` flag flips.
2. **Partial unique index**: ``uq_one_active_extraction_template_per_project``
   over ``(project_id) WHERE is_active = true AND kind = 'extraction'``.
   Makes a second active extraction template per project unrepresentable.

QA templates are intentionally outside the index — PROBAST and QUADAS-2
are meant to coexist for the same project.

Downgrade just drops the index; we do not try to resurrect the demoted
``is_active=true`` rows because the original ordering between them is
no longer meaningful (the workflow has moved on with the survivor).
"""

from alembic import op

revision = "0014_one_active_extraction_tpl"
down_revision = "0013_calc_model_progress_fix"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1 — collapse any legacy multi-active state to a single survivor
    # per project. ``ROW_NUMBER() … ORDER BY created_at DESC`` mirrors the
    # frontend's ``ExtractionInterface`` picker (newest active), so the
    # survivor is the same template the user just imported / is configuring.
    op.execute(
        """
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY project_id
                       ORDER BY created_at DESC, id
                   ) AS rn
            FROM public.project_extraction_templates
            WHERE kind = 'extraction'
              AND is_active = true
        )
        UPDATE public.project_extraction_templates AS pet
        SET is_active = false
        FROM ranked
        WHERE pet.id = ranked.id
          AND ranked.rn > 1;
        """
    )

    # Step 2 — enforce the invariant from now on.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS
            uq_one_active_extraction_template_per_project
        ON public.project_extraction_templates (project_id)
        WHERE is_active = true AND kind = 'extraction';
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.uq_one_active_extraction_template_per_project;")
