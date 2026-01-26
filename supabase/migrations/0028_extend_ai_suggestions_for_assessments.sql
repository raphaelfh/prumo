-- =====================================================
-- MIGRATION: Extend ai_suggestions for Assessments
-- =====================================================
-- Descrição: Estende a tabela ai_suggestions para suportar
-- tanto extraction suggestions quanto assessment suggestions,
-- seguindo o princípio DRY (Don't Repeat Yourself).
-- =====================================================

-- Add assessment_item_id column
ALTER TABLE ai_suggestions
  ADD COLUMN assessment_item_id uuid REFERENCES assessment_items(id) ON DELETE RESTRICT;

-- Make extraction columns optional (since assessments don't use them)
ALTER TABLE ai_suggestions
  ALTER COLUMN instance_id DROP NOT NULL,
  ALTER COLUMN field_id DROP NOT NULL;

-- Add XOR constraint: suggestion must be either for extraction OR assessment, never both
ALTER TABLE ai_suggestions
  ADD CONSTRAINT ai_suggestions_target_check CHECK (
    -- Extraction suggestion: instance_id AND field_id are NOT NULL, assessment_item_id IS NULL
    (instance_id IS NOT NULL AND field_id IS NOT NULL AND assessment_item_id IS NULL) OR
    -- Assessment suggestion: assessment_item_id IS NOT NULL, instance_id AND field_id ARE NULL
    (instance_id IS NULL AND field_id IS NULL AND assessment_item_id IS NOT NULL)
  );

-- Index for assessment queries
CREATE INDEX idx_ai_suggestions_assessment_item
  ON ai_suggestions(assessment_item_id)
  WHERE assessment_item_id IS NOT NULL;

-- Index for status queries on assessments
CREATE INDEX idx_ai_suggestions_assessment_status
  ON ai_suggestions(assessment_item_id, status)
  WHERE assessment_item_id IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN ai_suggestions.assessment_item_id IS 'FK to assessment_item when suggestion is for quality assessment (mutually exclusive with instance_id/field_id)';
COMMENT ON CONSTRAINT ai_suggestions_target_check ON ai_suggestions IS 'Ensures suggestion is either for extraction (instance_id + field_id) OR assessment (assessment_item_id), never both';

-- Note: RLS policies already exist for ai_suggestions and will work for both types
-- since both extraction and assessment suggestions are scoped to projects via run_id
