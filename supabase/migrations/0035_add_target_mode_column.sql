-- =====================================================
-- MIGRATION: Add target_mode column to project_assessment_instruments
-- =====================================================
-- Description: Adds target_mode column to support per-article or per-model
-- assessment modes. PROBAST can be assessed per-model (like CHARMS extraction)
-- or per-article (whole article assessment).
--
-- Values:
-- - 'per_article': Assess the article as a whole (default)
-- - 'per_model': Assess each extracted model separately (PROBAST style)
--
-- Reference: User request for CHARMS-style model-by-model assessment
-- =====================================================

-- Add target_mode column to project_assessment_instruments
ALTER TABLE project_assessment_instruments
  ADD COLUMN IF NOT EXISTS target_mode varchar NOT NULL DEFAULT 'per_article';

-- Add comment
COMMENT ON COLUMN project_assessment_instruments.target_mode IS
  'Assessment target mode: per_article (whole article) or per_model (each extracted model)';

-- Also add to global assessment_instruments for default behavior
ALTER TABLE assessment_instruments
  ADD COLUMN IF NOT EXISTS target_mode varchar NOT NULL DEFAULT 'per_article';

COMMENT ON COLUMN assessment_instruments.target_mode IS
  'Default assessment target mode: per_article or per_model';

-- Update PROBAST to default to per_model (since it's designed for prediction models)
UPDATE assessment_instruments
SET target_mode = 'per_model'
WHERE tool_type = 'PROBAST';

-- =================== VERIFICATION ===================

DO $$
BEGIN
  RAISE NOTICE '=== TARGET MODE MIGRATION ===';
  RAISE NOTICE 'Added target_mode column to:';
  RAISE NOTICE '  - project_assessment_instruments';
  RAISE NOTICE '  - assessment_instruments';
  RAISE NOTICE '';
  RAISE NOTICE 'PROBAST default target_mode set to: per_model';
  RAISE NOTICE '==============================';
END $$;
