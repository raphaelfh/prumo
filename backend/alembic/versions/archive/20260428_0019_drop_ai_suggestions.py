"""drop ai_suggestions table + suggestion_status enum + ai_suggestion_id FK

Revision ID: 20260428_0019
Revises: 20260428_0018
Create Date: 2026-04-28
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260428_0019"
down_revision = "20260428_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop the legacy AI suggestions stack.

    Frontend now reads proposed values from `extraction_proposal_records`
    (filtered by source='ai') and derives "accepted" status from the
    presence of an `extracted_values` row. The mirror writer in
    `section_extraction_service` is gone, so no new rows ever arrive in
    `ai_suggestions` — drop the table along with the FK column on
    `extracted_values` and the now-unused `suggestion_status` enum.

    `extracted_values` itself stays as the canonical accepted-value store
    until the frontend migrates to `extraction_published_states`. That
    drop is a separate migration.
    """
    op.execute(
        """
        ALTER TABLE public.extracted_values
            DROP COLUMN IF EXISTS ai_suggestion_id;
        """
    )
    op.execute("DROP TABLE IF EXISTS public.ai_suggestions CASCADE;")
    op.execute("DROP TYPE IF EXISTS public.suggestion_status;")


def downgrade() -> None:
    op.execute(
        """
        CREATE TYPE public.suggestion_status AS ENUM (
            'pending', 'accepted', 'rejected'
        );
        """
    )
    op.execute(
        """
        CREATE TABLE public.ai_suggestions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            extraction_run_id uuid REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
            instance_id uuid REFERENCES public.extraction_instances(id) ON DELETE CASCADE,
            field_id uuid REFERENCES public.extraction_fields(id) ON DELETE RESTRICT,
            suggested_value jsonb NOT NULL,
            confidence_score numeric,
            reasoning text,
            status public.suggestion_status NOT NULL DEFAULT 'pending',
            reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
            reviewed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        );
        CREATE INDEX idx_ai_suggestions_extraction_run_id
            ON public.ai_suggestions (extraction_run_id);
        CREATE INDEX idx_ai_suggestions_instance_id
            ON public.ai_suggestions (instance_id);
        CREATE INDEX idx_ai_suggestions_field_id
            ON public.ai_suggestions (field_id);
        CREATE INDEX idx_ai_suggestions_suggested_value_gin
            ON public.ai_suggestions USING gin (suggested_value);
        CREATE INDEX idx_ai_suggestions_metadata_gin
            ON public.ai_suggestions USING gin (metadata);
        """
    )
    op.execute(
        """
        ALTER TABLE public.extracted_values
            ADD COLUMN ai_suggestion_id uuid
                REFERENCES public.ai_suggestions(id) ON DELETE SET NULL;
        """
    )
