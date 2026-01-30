-- =====================================================
-- MIGRATION: Restore Assessments Compatibility View
-- =====================================================
-- Purpose: Restore the assessments VIEW to support frontend queries
-- while backend uses normalized structure (assessment_instances + assessment_responses)
--
-- This VIEW was removed in 0032 but is still needed by frontend
-- until frontend is refactored to query assessment_instances directly.
--
-- Strategy: Compatibility layer
-- - assessments (VIEW): Aggregates assessment_responses back to flat JSONB format
-- - Frontend: Continues querying /rest/v1/assessments
-- - Backend: Uses assessment_instances/responses for new operations
-- =====================================================

-- =================== CREATE COMPATIBILITY VIEW ===================

CREATE OR REPLACE VIEW assessments WITH (security_invoker=true) AS
SELECT
  ai.id,
  ai.project_id,
  ai.article_id,
  ai.reviewer_id AS user_id,
  i.tool_type,
  ai.instrument_id,
  ai.extraction_instance_id,

  -- Aggregate responses back to JSONB (legacy format)
  -- key: item_code, value: { level, notes, confidence, source, ai_suggestion_id }
  COALESCE(
    (
      SELECT jsonb_object_agg(
        item.item_code,
        jsonb_build_object(
          'item_id', item.id,
          'selected_level', ar.selected_level,
          'notes', ar.notes,
          'confidence', ar.confidence,
          'source', ar.source::text,
          'ai_suggestion_id', ar.ai_suggestion_id
        )
      )
      FROM assessment_responses ar
      JOIN assessment_items item ON item.id = ar.assessment_item_id
      WHERE ar.assessment_instance_id = ai.id
    ),
    '{}'::jsonb
  ) AS responses,

  -- Overall assessment extracted from metadata
  CASE
    WHEN ai.metadata ? 'overall_risk' OR ai.metadata ? 'summary' THEN
      jsonb_build_object(
        'overall_risk', ai.metadata->>'overall_risk',
        'summary', ai.metadata->>'summary',
        'applicability', ai.metadata->>'applicability'
      )
    ELSE
      NULL
  END AS overall_assessment,

  -- Confidence level (deprecated, kept for compatibility)
  NULL::integer AS confidence_level,

  -- Status
  ai.status,

  -- Completion percentage (calculated via SQL function)
  (
    SELECT completion_percentage
    FROM calculate_assessment_instance_progress(ai.id)
    LIMIT 1
  ) AS completion_percentage,

  -- Versioning (kept at 1 for compatibility)
  1 AS version,
  true AS is_current_version,

  -- Parent assessment (not used in new model)
  NULL::uuid AS parent_assessment_id,

  -- Blind mode
  ai.is_blind,
  ai.can_see_others,

  -- Comments (extracted from metadata)
  COALESCE(ai.metadata->'comments', '[]'::jsonb) AS comments,

  -- Private notes (extracted from metadata)
  ai.metadata->>'private_notes' AS private_notes,

  -- Assessed by type (inferred from source of responses)
  CASE
    WHEN EXISTS (
      SELECT 1 FROM assessment_responses ar
      WHERE ar.assessment_instance_id = ai.id
        AND ar.source = 'ai'
    ) THEN 'ai'
    ELSE 'human'
  END AS assessed_by_type,

  -- Run ID (not used in new model)
  NULL::uuid AS run_id,

  -- Row version
  1 AS row_version,

  -- Timestamps
  ai.created_at,
  ai.updated_at

FROM assessment_instances ai
JOIN assessment_instruments i ON i.id = ai.instrument_id;

COMMENT ON VIEW assessments IS
'Compatibility view for legacy assessments table.
Emulates old structure by aggregating assessment_responses into JSONB.
READ-ONLY via frontend (INSERT/UPDATE via triggers if needed).
This view will be removed in future version (v2.0).';

-- =================== CREATE INSTEAD OF TRIGGERS ===================

-- Trigger for INSERT (redirect to new tables)
CREATE OR REPLACE FUNCTION assessments_insert_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_instance_id uuid;
  v_item RECORD;
  v_response_data jsonb;
BEGIN
  -- Create assessment_instance
  INSERT INTO assessment_instances (
    project_id,
    article_id,
    instrument_id,
    extraction_instance_id,
    label,
    status,
    reviewer_id,
    is_blind,
    can_see_others,
    metadata
  )
  VALUES (
    NEW.project_id,
    NEW.article_id,
    NEW.instrument_id,
    NEW.extraction_instance_id,
    COALESCE(NEW.tool_type || ' Assessment', 'Assessment'),
    COALESCE(NEW.status, 'in_progress'),
    NEW.user_id,
    COALESCE(NEW.is_blind, false),
    COALESCE(NEW.can_see_others, true),
    jsonb_build_object(
      'overall_assessment', NEW.overall_assessment,
      'comments', COALESCE(NEW.comments, '[]'::jsonb),
      'private_notes', NEW.private_notes
    )
  )
  RETURNING id INTO v_instance_id;

  -- Create assessment_responses from JSONB responses
  FOR v_item IN
    SELECT
      key AS item_code,
      value AS response_value
    FROM jsonb_each(COALESCE(NEW.responses, '{}'::jsonb))
  LOOP
    -- Find assessment_item_id by item_code
    INSERT INTO assessment_responses (
      project_id,
      article_id,
      assessment_instance_id,
      assessment_item_id,
      selected_level,
      notes,
      confidence,
      source,
      reviewer_id
    )
    SELECT
      NEW.project_id,
      NEW.article_id,
      v_instance_id,
      ai.id,
      v_item.response_value->>'selected_level',
      v_item.response_value->>'notes',
      (v_item.response_value->>'confidence')::numeric,
      COALESCE((v_item.response_value->>'source')::assessment_source, 'human'),
      NEW.user_id
    FROM assessment_items ai
    WHERE ai.item_code = v_item.item_code
      AND ai.instrument_id = NEW.instrument_id;
  END LOOP;

  -- Return NEW to satisfy trigger
  NEW.id := v_instance_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER assessments_instead_of_insert
  INSTEAD OF INSERT ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION assessments_insert_trigger();

COMMENT ON FUNCTION assessments_insert_trigger() IS
'Trigger to redirect INSERTs on assessments view to new tables.
Creates assessment_instance + assessment_responses from legacy format.';

-- Trigger for UPDATE (redirect to new tables)
CREATE OR REPLACE FUNCTION assessments_update_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- Update assessment_instance
  UPDATE assessment_instances
  SET
    status = COALESCE(NEW.status, status),
    is_blind = COALESCE(NEW.is_blind, is_blind),
    can_see_others = COALESCE(NEW.can_see_others, can_see_others),
    metadata = metadata ||
      jsonb_build_object(
        'overall_assessment', NEW.overall_assessment,
        'comments', COALESCE(NEW.comments, '[]'::jsonb),
        'private_notes', NEW.private_notes
      ),
    updated_at = NOW()
  WHERE id = OLD.id;

  -- Update responses (if provided)
  IF NEW.responses IS NOT NULL AND NEW.responses != OLD.responses THEN
    -- Delete old responses
    DELETE FROM assessment_responses
    WHERE assessment_instance_id = OLD.id;

    -- Insert new responses
    FOR v_item IN
      SELECT
        key AS item_code,
        value AS response_value
      FROM jsonb_each(NEW.responses)
    LOOP
      INSERT INTO assessment_responses (
        project_id,
        article_id,
        assessment_instance_id,
        assessment_item_id,
        selected_level,
        notes,
        confidence,
        source,
        reviewer_id
      )
      SELECT
        NEW.project_id,
        NEW.article_id,
        OLD.id,
        ai.id,
        v_item.response_value->>'selected_level',
        v_item.response_value->>'notes',
        (v_item.response_value->>'confidence')::numeric,
        COALESCE((v_item.response_value->>'source')::assessment_source, 'human'),
        NEW.user_id
      FROM assessment_items ai
      WHERE ai.item_code = v_item.item_code
        AND ai.instrument_id = NEW.instrument_id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER assessments_instead_of_update
  INSTEAD OF UPDATE ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION assessments_update_trigger();

COMMENT ON FUNCTION assessments_update_trigger() IS
'Trigger to redirect UPDATEs on assessments view to new tables.
Updates assessment_instance and recreates assessment_responses.';

-- Trigger for DELETE (redirect to new tables)
CREATE OR REPLACE FUNCTION assessments_delete_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete assessment_instance (responses will be deleted by CASCADE)
  DELETE FROM assessment_instances
  WHERE id = OLD.id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER assessments_instead_of_delete
  INSTEAD OF DELETE ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION assessments_delete_trigger();

COMMENT ON FUNCTION assessments_delete_trigger() IS
'Trigger to redirect DELETEs on assessments view to assessment_instances.
Responses are deleted automatically via CASCADE.';

-- =================== GRANT PERMISSIONS ===================

-- Ensure view has same permissions as old table
GRANT SELECT, INSERT, UPDATE, DELETE ON assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON assessments TO service_role;

-- =================== VERIFICATION ===================

DO $$
DECLARE
  v_instances_count INTEGER;
  v_responses_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_instances_count FROM assessment_instances;
  SELECT COUNT(*) INTO v_responses_count FROM assessment_responses;

  RAISE NOTICE '=== ASSESSMENTS VIEW RESTORED ===';
  RAISE NOTICE 'Assessment instances: %', v_instances_count;
  RAISE NOTICE 'Assessment responses: %', v_responses_count;
  RAISE NOTICE 'View "assessments" created (compatibility layer)';
  RAISE NOTICE 'INSTEAD OF triggers: INSERT, UPDATE, DELETE';
  RAISE NOTICE '====================================';
END $$;
