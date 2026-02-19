-- =====================================================
-- MIGRATION: Fix ai_suggestions.extraction_run_id NOT NULL constraint
-- =====================================================
-- Problem: Migration 0033 renamed run_id to extraction_run_id but did not
-- drop the inherited NOT NULL constraint. Assessment suggestions need
-- extraction_run_id = NULL (with assessment_run_id NOT NULL instead).
-- The XOR check constraint already enforces exactly one FK is set.
--
-- Fix: Drop the NOT NULL constraint on extraction_run_id.
-- The check constraint ai_suggestions_run_type_check already ensures
-- data integrity (exactly one of extraction_run_id/assessment_run_id is set).
--
-- Date: 2026-02-19
-- =====================================================

ALTER TABLE ai_suggestions
  ALTER COLUMN extraction_run_id DROP NOT NULL;
