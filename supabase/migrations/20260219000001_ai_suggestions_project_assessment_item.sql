-- =====================================================
-- MIGRATION: Add project_assessment_item_id to ai_suggestions
-- =====================================================
-- Problem: ai_suggestions.assessment_item_id FK only references assessment_items
-- (global), but project-scoped instruments use project_assessment_items.
-- This mirrors the XOR pattern already applied to assessment_responses in
-- migration 20260218000000.
--
-- Fix: Add project_assessment_item_id column with FK, update check constraint.
--
-- Date: 2026-02-19
-- =====================================================

-- 1. Drop existing check constraint that validates target type
ALTER TABLE ai_suggestions
  DROP CONSTRAINT IF EXISTS ai_suggestions_target_check;

-- 2. Add project_assessment_item_id column
ALTER TABLE ai_suggestions
  ADD COLUMN project_assessment_item_id uuid;

ALTER TABLE ai_suggestions
  ADD CONSTRAINT ai_suggestions_project_assessment_item_id_fkey
    FOREIGN KEY (project_assessment_item_id)
    REFERENCES project_assessment_items(id) ON DELETE RESTRICT;

-- 3. Recreate check constraint with project_assessment_item_id support
-- An assessment suggestion uses EITHER assessment_item_id (global) OR
-- project_assessment_item_id (project-scoped), never both.
ALTER TABLE ai_suggestions
  ADD CONSTRAINT ai_suggestions_target_check CHECK (
    -- Extraction suggestion: instance_id AND field_id are NOT NULL, assessment fields NULL
    (instance_id IS NOT NULL AND field_id IS NOT NULL
      AND assessment_item_id IS NULL AND project_assessment_item_id IS NULL) OR
    -- Assessment suggestion (global): assessment_item_id NOT NULL
    (instance_id IS NULL AND field_id IS NULL
      AND assessment_item_id IS NOT NULL AND project_assessment_item_id IS NULL) OR
    -- Assessment suggestion (project-scoped): project_assessment_item_id NOT NULL
    (instance_id IS NULL AND field_id IS NULL
      AND assessment_item_id IS NULL AND project_assessment_item_id IS NOT NULL)
  );

-- 4. Index for lookups
CREATE INDEX idx_ai_suggestions_project_assessment_item_id
  ON ai_suggestions(project_assessment_item_id)
  WHERE project_assessment_item_id IS NOT NULL;

COMMENT ON COLUMN ai_suggestions.project_assessment_item_id IS
  'FK to project_assessment_items (XOR with assessment_item_id). Used for project-scoped instruments.';
