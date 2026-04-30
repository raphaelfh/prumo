"""drop extracted_values table + extraction_source enum

Revision ID: 0002_drop_extracted_values
Revises: 0001_baseline_v1
Create Date: 2026-04-28

The extraction UI now reads canonical per-user values from
``extraction_reviewer_states`` (current decision pointer) joined with
``extraction_reviewer_decisions`` (the value), and writes via
``POST /v1/runs/{runId}/decisions`` with ``decision='edit'``. AI
extraction auto-advances the run from PROPOSAL → REVIEW after recording
proposals, so the form can immediately accept those decisions.

That migration removed every live reader/writer of the legacy
``extracted_values`` table:

- ``aiSuggestionService.acceptSuggestion`` → ``ReviewerDecision(accept_proposal)``
- ``aiSuggestionService.rejectSuggestion`` → ``ReviewerDecision(reject)``
- ``useExtractedValues`` / ``useExtractionAutoSave`` / ``useOtherExtractions``
  → ``ExtractionValueService`` (reviewer_states + decisions)
- ``useFieldManagement.validateField`` → counts non-reject decisions
- ``useExtractionProgressCalc`` → counts non-reject reviewer_states
- ``useModelManagement.createModel`` → optional ReviewerDecision write
- ``ArticleExtractionTable`` / ``ExtractionInterface`` / ``RemoveSectionDialog``
  → reviewer_states / reviewer_decisions queries

So: drop the table, drop the now-unused ``extraction_source`` enum,
done.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0002_drop_extracted_values"
down_revision = "0001_baseline_v1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.extracted_values CASCADE;")
    op.execute("DROP TYPE IF EXISTS public.extraction_source;")


def downgrade() -> None:
    """Restore the legacy table + enum. Data is gone — only schema returns.

    asyncpg refuses prepared statements containing multiple commands, so
    each DDL goes through its own ``op.execute`` call.
    """
    op.execute("CREATE TYPE public.extraction_source AS ENUM ('human', 'ai', 'rule');")
    op.execute(
        """
        CREATE TABLE public.extracted_values (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
            article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
            instance_id uuid NOT NULL REFERENCES public.extraction_instances(id)
                ON DELETE CASCADE,
            field_id uuid NOT NULL REFERENCES public.extraction_fields(id)
                ON DELETE RESTRICT,
            value jsonb NOT NULL DEFAULT '{}'::jsonb,
            source public.extraction_source NOT NULL,
            confidence_score numeric,
            evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
            reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
            is_consensus boolean NOT NULL DEFAULT false,
            unit text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        "CREATE INDEX idx_extracted_values_project_id ON public.extracted_values (project_id);"
    )
    op.execute(
        "CREATE INDEX idx_extracted_values_article_id ON public.extracted_values (article_id);"
    )
    op.execute(
        "CREATE INDEX idx_extracted_values_instance_id ON public.extracted_values (instance_id);"
    )
    op.execute("CREATE INDEX idx_extracted_values_field_id ON public.extracted_values (field_id);")
    op.execute(
        "CREATE INDEX idx_extracted_values_instance_field "
        "ON public.extracted_values (instance_id, field_id);"
    )
    op.execute(
        "CREATE INDEX idx_extracted_values_value_gin ON public.extracted_values USING gin (value);"
    )
    op.execute(
        "CREATE INDEX idx_extracted_values_evidence_gin "
        "ON public.extracted_values USING gin (evidence);"
    )
