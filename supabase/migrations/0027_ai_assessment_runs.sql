-- =====================================================
-- MIGRATION: AI Assessment Runs (Run Tracking)
-- =====================================================
-- Descrição: Adiciona rastreamento de execuções de AI assessment,
-- similar ao extraction_runs. Suporta assessment por artigo
-- ou por extraction_instance (para PROBAST por modelo).
-- =====================================================

CREATE TABLE ai_assessment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core references
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  instrument_id uuid NOT NULL REFERENCES assessment_instruments(id) ON DELETE RESTRICT,

  -- Hierarchical support: assessment can be scoped to a specific extraction instance
  -- (e.g., PROBAST assessment for a specific prediction model)
  extraction_instance_id uuid REFERENCES extraction_instances(id) ON DELETE CASCADE,

  -- Lifecycle tracking
  stage character varying NOT NULL,  -- 'assess_single' | 'assess_batch' | 'assess_hierarchical'
  status character varying NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'completed' | 'failed'

  -- Execution metadata
  parameters jsonb NOT NULL DEFAULT '{}',  -- Input: model, temperature, item_ids, etc.
  results jsonb NOT NULL DEFAULT '{}',  -- Output: tokens, duration, suggestions_created, etc.
  error_message text,

  -- Timestamps
  started_at timestamptz,
  completed_at timestamptz,

  -- Audit
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for query performance
CREATE INDEX idx_ai_assessment_runs_status ON ai_assessment_runs(status, stage);
CREATE INDEX idx_ai_assessment_runs_project ON ai_assessment_runs(project_id);
CREATE INDEX idx_ai_assessment_runs_article ON ai_assessment_runs(article_id);
CREATE INDEX idx_ai_assessment_runs_instrument ON ai_assessment_runs(instrument_id);
CREATE INDEX idx_ai_assessment_runs_instance
  ON ai_assessment_runs(extraction_instance_id)
  WHERE extraction_instance_id IS NOT NULL;
CREATE INDEX idx_ai_assessment_runs_created_by ON ai_assessment_runs(created_by);

-- GIN indexes for JSONB columns (efficient querying of nested data)
CREATE INDEX idx_ai_assessment_runs_parameters_gin ON ai_assessment_runs USING gin(parameters);
CREATE INDEX idx_ai_assessment_runs_results_gin ON ai_assessment_runs USING gin(results);

-- Comments for documentation
COMMENT ON TABLE ai_assessment_runs IS 'Tracks AI assessment execution lifecycle (similar to extraction_runs)';
COMMENT ON COLUMN ai_assessment_runs.extraction_instance_id IS 'Optional FK to extraction_instance when assessment is scoped to a specific model (e.g., PROBAST per prediction model)';
COMMENT ON COLUMN ai_assessment_runs.stage IS 'Execution stage: assess_single (one item), assess_batch (multiple items), assess_hierarchical (all models in article)';
COMMENT ON COLUMN ai_assessment_runs.status IS 'Lifecycle status: pending → running → completed/failed';
COMMENT ON COLUMN ai_assessment_runs.parameters IS 'Input configuration (model name, temperature, item IDs, etc.)';
COMMENT ON COLUMN ai_assessment_runs.results IS 'Output metrics (tokens used, duration, suggestions created, etc.)';

-- Row Level Security (RLS)
ALTER TABLE ai_assessment_runs ENABLE ROW LEVEL SECURITY;

-- Policy: Project members can view runs
CREATE POLICY ai_assessment_runs_select_policy
  ON ai_assessment_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = ai_assessment_runs.project_id
        AND project_members.user_id = auth.uid()
    )
  );

-- Policy: Project members can create runs
CREATE POLICY ai_assessment_runs_insert_policy
  ON ai_assessment_runs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = ai_assessment_runs.project_id
        AND project_members.user_id = auth.uid()
    )
    AND created_by = auth.uid()
  );

-- Policy: Only run creator or project managers can update
CREATE POLICY ai_assessment_runs_update_policy
  ON ai_assessment_runs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = ai_assessment_runs.project_id
        AND project_members.user_id = auth.uid()
        AND (
          ai_assessment_runs.created_by = auth.uid() OR
          project_members.role = 'manager'
        )
    )
  );
