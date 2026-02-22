-- =====================================================
-- MIGRATION: Fix RLS policies on ai_suggestions for extraction + assessment
-- =====================================================
-- Problem: Policies in 0012 reference ai_suggestions.run_id, which was
-- renamed to extraction_run_id in 0033. Assessment suggestions use
-- assessment_run_id. So SELECT from the frontend returns no rows for
-- assessment suggestions (policy expression references non-existent column
-- or only checks extraction_runs).
--
-- Fix: Drop and recreate policies to allow SELECT/ALL when the suggestion
-- is linked to an extraction_run OR an ai_assessment_run the user can access.
-- =====================================================

-- Drop existing policies (they reference the old run_id column)
DROP POLICY IF EXISTS "Members can view ai suggestions" ON ai_suggestions;
DROP POLICY IF EXISTS "Members can manage ai suggestions" ON ai_suggestions;

-- SELECT: user can see suggestion if it belongs to an extraction run or
-- assessment run for a project they are a member of
CREATE POLICY "Members can view ai suggestions"
  ON ai_suggestions FOR SELECT
  USING (
    (ai_suggestions.extraction_run_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM extraction_runs er
      WHERE er.id = ai_suggestions.extraction_run_id
      AND is_project_member(er.project_id, auth.uid())
    ))
    OR
    (ai_suggestions.assessment_run_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM ai_assessment_runs arr
      WHERE arr.id = ai_suggestions.assessment_run_id
      AND is_project_member(arr.project_id, auth.uid())
    ))
  );

-- ALL (INSERT/UPDATE/DELETE): same membership check
CREATE POLICY "Members can manage ai suggestions"
  ON ai_suggestions FOR ALL
  USING (
    (ai_suggestions.extraction_run_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM extraction_runs er
      WHERE er.id = ai_suggestions.extraction_run_id
      AND is_project_member(er.project_id, auth.uid())
    ))
    OR
    (ai_suggestions.assessment_run_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM ai_assessment_runs arr
      WHERE arr.id = ai_suggestions.assessment_run_id
      AND is_project_member(arr.project_id, auth.uid())
    ))
  );
