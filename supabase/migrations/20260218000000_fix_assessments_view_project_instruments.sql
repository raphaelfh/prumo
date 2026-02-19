-- =====================================================
-- MIGRATION: Fix Assessments VIEW for Project Instruments
-- =====================================================
-- Purpose: Fix FK constraint violation when saving assessment responses
-- for articles using project-scoped instruments.
--
-- Bug: The assessments compatibility VIEW's INSTEAD OF INSERT trigger
-- always inserts NEW.instrument_id into assessment_instances.instrument_id
-- (FK to global assessment_instruments). However, Bug 2 fix now sends
-- project_assessment_instruments.id, causing FK violation.
--
-- Fix:
--   Part 0: Alter assessment_responses to support project items (XOR pattern)
--   Part 1: Update VIEW to LEFT JOIN both instrument tables
--   Part 2: Update INSERT trigger with instrument type detection
--   Part 3: Update UPDATE trigger with instrument type detection
--   Part 4: Re-grant permissions and verify
--
-- Related migrations:
--   0030: Created assessment_instances + assessment_responses
--   0031: Created assessments compatibility VIEW + triggers
--   0034: Added project_assessment_instruments + project_assessment_items
--   restore: Restored compatibility VIEW after 0032 removal
-- =====================================================

-- =================== PART 0a: ALTER ai_assessment_runs ===================
-- Add project_instrument_id column following XOR pattern from 0034
-- Make instrument_id nullable and add XOR constraint

ALTER TABLE ai_assessment_runs
  ALTER COLUMN instrument_id DROP NOT NULL;

ALTER TABLE ai_assessment_runs
  ADD COLUMN project_instrument_id uuid;

ALTER TABLE ai_assessment_runs
  ADD CONSTRAINT ai_assessment_runs_project_instrument_id_fkey
    FOREIGN KEY (project_instrument_id)
    REFERENCES project_assessment_instruments(id) ON DELETE RESTRICT;

ALTER TABLE ai_assessment_runs
  ADD CONSTRAINT chk_ai_assessment_run_instrument_xor CHECK (
    (instrument_id IS NOT NULL AND project_instrument_id IS NULL) OR
    (instrument_id IS NULL AND project_instrument_id IS NOT NULL)
  );

CREATE INDEX idx_ai_assessment_runs_project_instrument
  ON ai_assessment_runs(project_instrument_id)
  WHERE project_instrument_id IS NOT NULL;

-- =================== PART 0b: ALTER assessment_responses ===================
-- Add project_assessment_item_id column following XOR pattern from 0034

-- Make assessment_item_id nullable (was NOT NULL)
ALTER TABLE assessment_responses
  ALTER COLUMN assessment_item_id DROP NOT NULL;

-- Add project_assessment_item_id column
ALTER TABLE assessment_responses
  ADD COLUMN project_assessment_item_id uuid;

-- Add FK for project_assessment_item_id
ALTER TABLE assessment_responses
  ADD CONSTRAINT assessment_responses_project_assessment_item_id_fkey
    FOREIGN KEY (project_assessment_item_id)
    REFERENCES project_assessment_items(id) ON DELETE RESTRICT;

-- Add XOR constraint: exactly one item reference must be non-null
ALTER TABLE assessment_responses
  ADD CONSTRAINT chk_assessment_response_item_xor CHECK (
    (assessment_item_id IS NOT NULL AND project_assessment_item_id IS NULL) OR
    (assessment_item_id IS NULL AND project_assessment_item_id IS NOT NULL)
  );

-- Add index for project_assessment_item_id lookups
CREATE INDEX idx_assessment_responses_project_item
  ON assessment_responses(project_assessment_item_id)
  WHERE project_assessment_item_id IS NOT NULL;

COMMENT ON COLUMN assessment_responses.project_assessment_item_id IS
  'FK to project_assessment_items (XOR with assessment_item_id). Used for project-scoped instruments.';

-- =================== PART 0b: UPDATE calculate_assessment_instance_progress ===================
-- The function only queries global assessment_items. Must also support project_assessment_items.

CREATE OR REPLACE FUNCTION calculate_assessment_instance_progress(p_instance_id UUID)
RETURNS TABLE (
  total_items INTEGER,
  answered_items INTEGER,
  completion_percentage NUMERIC(5,2)
) AS $$
BEGIN
  RETURN QUERY
  WITH instance_info AS (
    SELECT
      ai_inst.instrument_id AS global_instrument_id,
      ai_inst.project_instrument_id
    FROM assessment_instances ai_inst
    WHERE ai_inst.id = p_instance_id
  ),
  total AS (
    SELECT COUNT(*) as total_count
    FROM (
      -- Global items (when instrument_id is set)
      SELECT gi.id
      FROM assessment_items gi
      WHERE gi.instrument_id = (SELECT global_instrument_id FROM instance_info)
        AND gi.required = true
        AND (SELECT global_instrument_id FROM instance_info) IS NOT NULL
      UNION ALL
      -- Project items (when project_instrument_id is set)
      SELECT pi.id
      FROM project_assessment_items pi
      WHERE pi.project_instrument_id = (SELECT project_instrument_id FROM instance_info)
        AND pi.required = true
        AND (SELECT project_instrument_id FROM instance_info) IS NOT NULL
    ) combined_items
  ),
  answered AS (
    SELECT COUNT(DISTINCT COALESCE(ar.assessment_item_id, ar.project_assessment_item_id)) as answered_count
    FROM assessment_responses ar
    WHERE ar.assessment_instance_id = p_instance_id
  )
  SELECT
    total.total_count::INTEGER as total_items,
    answered.answered_count::INTEGER as answered_items,
    CASE
      WHEN total.total_count = 0 THEN 0::NUMERIC(5,2)
      ELSE ROUND((answered.answered_count::NUMERIC / total.total_count::NUMERIC) * 100, 2)
    END as completion_percentage
  FROM total, answered;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_assessment_instance_progress(UUID) IS
'Calculates progress of an assessment instance.
Supports both global instruments (assessment_items) and project instruments (project_assessment_items).
Returns: total required items, answered items, completion percentage.';

-- =================== PART 1: UPDATE VIEW ===================

CREATE OR REPLACE VIEW assessments WITH (security_invoker=true) AS
SELECT
  ai.id,
  ai.project_id,
  ai.article_id,
  ai.reviewer_id AS user_id,
  COALESCE(gi.tool_type, pi.tool_type) AS tool_type,
  COALESCE(ai.instrument_id, ai.project_instrument_id) AS instrument_id,
  ai.extraction_instance_id,

  -- Aggregate responses back to JSONB
  -- key: item UUID (as text), value: { level, notes, confidence, source, ai_suggestion_id }
  -- Searches BOTH assessment_items (global) and project_assessment_items (project)
  COALESCE(
    (
      SELECT jsonb_object_agg(
        COALESCE(g_item.id, p_item.id)::text,
        jsonb_build_object(
          'item_id', COALESCE(g_item.id, p_item.id),
          'selected_level', ar.selected_level,
          'notes', ar.notes,
          'confidence', ar.confidence,
          'source', ar.source::text,
          'ai_suggestion_id', ar.ai_suggestion_id
        )
      )
      FROM assessment_responses ar
      LEFT JOIN assessment_items g_item ON g_item.id = ar.assessment_item_id
      LEFT JOIN project_assessment_items p_item ON p_item.id = ar.project_assessment_item_id
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
LEFT JOIN assessment_instruments gi ON gi.id = ai.instrument_id
LEFT JOIN project_assessment_instruments pi ON pi.id = ai.project_instrument_id;

COMMENT ON VIEW assessments IS
'Compatibility view for legacy assessments table.
Emulates old structure by aggregating assessment_responses into JSONB.
Supports BOTH global instruments (assessment_instruments) and
project-scoped instruments (project_assessment_instruments) via XOR pattern.
READ-ONLY via frontend (INSERT/UPDATE via triggers).
This view will be removed in future version (v2.0).';

-- =================== PART 2: UPDATE INSERT TRIGGER ===================

CREATE OR REPLACE FUNCTION assessments_insert_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_instance_id uuid;
  v_item RECORD;
  v_response_data jsonb;
  v_is_project_instrument boolean;
BEGIN
  -- Detect if the instrument_id is a project instrument or global instrument
  SELECT EXISTS (
    SELECT 1 FROM project_assessment_instruments WHERE id = NEW.instrument_id
  ) INTO v_is_project_instrument;

  -- Create assessment_instance with correct FK column
  IF v_is_project_instrument THEN
    -- Project instrument: use project_instrument_id column
    INSERT INTO assessment_instances (
      project_id,
      article_id,
      instrument_id,
      project_instrument_id,
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
      NULL,                   -- instrument_id is NULL for project instruments
      NEW.instrument_id,      -- project_instrument_id gets the ID
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

    -- Create assessment_responses from JSONB responses (project items)
    -- Keys can be item UUID (from frontend) or item_code (legacy)
    FOR v_item IN
      SELECT
        key AS item_key,
        value AS response_value
      FROM jsonb_each(COALESCE(NEW.responses, '{}'::jsonb))
    LOOP
      INSERT INTO assessment_responses (
        project_id,
        article_id,
        assessment_instance_id,
        assessment_item_id,
        project_assessment_item_id,
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
        NULL,                -- assessment_item_id is NULL for project items
        pai.id,              -- project_assessment_item_id
        v_item.response_value->>'selected_level',
        v_item.response_value->>'notes',
        (v_item.response_value->>'confidence')::numeric,
        COALESCE((v_item.response_value->>'source')::assessment_source, 'human'),
        NEW.user_id
      FROM project_assessment_items pai
      WHERE (pai.id::text = v_item.item_key OR pai.item_code = v_item.item_key)
        AND pai.project_instrument_id = NEW.instrument_id;
    END LOOP;

  ELSE
    -- Global instrument: use instrument_id column (legacy path)
    INSERT INTO assessment_instances (
      project_id,
      article_id,
      instrument_id,
      project_instrument_id,
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
      NEW.instrument_id,    -- instrument_id gets the ID
      NULL,                  -- project_instrument_id is NULL for global instruments
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

    -- Create assessment_responses from JSONB responses (global items)
    -- Keys can be item UUID (from frontend) or item_code (legacy)
    FOR v_item IN
      SELECT
        key AS item_key,
        value AS response_value
      FROM jsonb_each(COALESCE(NEW.responses, '{}'::jsonb))
    LOOP
      INSERT INTO assessment_responses (
        project_id,
        article_id,
        assessment_instance_id,
        assessment_item_id,
        project_assessment_item_id,
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
        ai.id,              -- assessment_item_id
        NULL,                -- project_assessment_item_id is NULL for global items
        v_item.response_value->>'selected_level',
        v_item.response_value->>'notes',
        (v_item.response_value->>'confidence')::numeric,
        COALESCE((v_item.response_value->>'source')::assessment_source, 'human'),
        NEW.user_id
      FROM assessment_items ai
      WHERE (ai.id::text = v_item.item_key OR ai.item_code = v_item.item_key)
        AND ai.instrument_id = NEW.instrument_id;
    END LOOP;
  END IF;

  -- Return NEW to satisfy trigger
  NEW.id := v_instance_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION assessments_insert_trigger() IS
'Trigger to redirect INSERTs on assessments view to new tables.
Creates assessment_instance + assessment_responses from legacy format.
Detects project vs global instrument and routes to correct FK columns.';

-- =================== PART 3: UPDATE UPDATE TRIGGER ===================

CREATE OR REPLACE FUNCTION assessments_update_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_is_project_instrument boolean;
BEGIN
  -- Update assessment_instance metadata (same for both instrument types)
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
    -- Detect instrument type from the existing instance
    SELECT (project_instrument_id IS NOT NULL)
    INTO v_is_project_instrument
    FROM assessment_instances
    WHERE id = OLD.id;

    -- Delete old responses
    DELETE FROM assessment_responses
    WHERE assessment_instance_id = OLD.id;

    -- Insert new responses using correct item table
    IF v_is_project_instrument THEN
      -- Project instrument: look up project_assessment_items
      -- Keys can be item UUID (from frontend) or item_code (legacy)
      FOR v_item IN
        SELECT
          key AS item_key,
          value AS response_value
        FROM jsonb_each(NEW.responses)
      LOOP
        INSERT INTO assessment_responses (
          project_id,
          article_id,
          assessment_instance_id,
          assessment_item_id,
          project_assessment_item_id,
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
          NULL,                -- assessment_item_id is NULL
          pai.id,              -- project_assessment_item_id
          v_item.response_value->>'selected_level',
          v_item.response_value->>'notes',
          (v_item.response_value->>'confidence')::numeric,
          COALESCE((v_item.response_value->>'source')::assessment_source, 'human'),
          NEW.user_id
        FROM project_assessment_items pai
        WHERE (pai.id::text = v_item.item_key OR pai.item_code = v_item.item_key)
          AND pai.project_instrument_id = (
            SELECT project_instrument_id
            FROM assessment_instances
            WHERE id = OLD.id
          );
      END LOOP;

    ELSE
      -- Global instrument: look up assessment_items (legacy path)
      -- Keys can be item UUID (from frontend) or item_code (legacy)
      FOR v_item IN
        SELECT
          key AS item_key,
          value AS response_value
        FROM jsonb_each(NEW.responses)
      LOOP
        INSERT INTO assessment_responses (
          project_id,
          article_id,
          assessment_instance_id,
          assessment_item_id,
          project_assessment_item_id,
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
          ai.id,              -- assessment_item_id
          NULL,                -- project_assessment_item_id is NULL
          v_item.response_value->>'selected_level',
          v_item.response_value->>'notes',
          (v_item.response_value->>'confidence')::numeric,
          COALESCE((v_item.response_value->>'source')::assessment_source, 'human'),
          NEW.user_id
        FROM assessment_items ai
        WHERE (ai.id::text = v_item.item_key OR ai.item_code = v_item.item_key)
          AND ai.instrument_id = (
            SELECT instrument_id
            FROM assessment_instances
            WHERE id = OLD.id
          );
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION assessments_update_trigger() IS
'Trigger to redirect UPDATEs on assessments view to new tables.
Updates assessment_instance and recreates assessment_responses.
Detects project vs global instrument for correct item table lookup.';

-- =================== PART 4: PERMISSIONS + VERIFICATION ===================

-- Re-grant permissions (CREATE OR REPLACE VIEW may reset them)
GRANT SELECT, INSERT, UPDATE, DELETE ON assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON assessments TO service_role;

-- Verification
DO $$
DECLARE
  v_instances_count INTEGER;
  v_responses_count INTEGER;
  v_project_instances INTEGER;
  v_global_instances INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_instances_count FROM assessment_instances;
  SELECT COUNT(*) INTO v_responses_count FROM assessment_responses;
  SELECT COUNT(*) INTO v_project_instances
    FROM assessment_instances WHERE project_instrument_id IS NOT NULL;
  SELECT COUNT(*) INTO v_global_instances
    FROM assessment_instances WHERE instrument_id IS NOT NULL;

  RAISE NOTICE '=== ASSESSMENTS VIEW UPDATED FOR PROJECT INSTRUMENTS ===';
  RAISE NOTICE 'Total assessment instances: %', v_instances_count;
  RAISE NOTICE '  - Global instrument instances: %', v_global_instances;
  RAISE NOTICE '  - Project instrument instances: %', v_project_instances;
  RAISE NOTICE 'Total assessment responses: %', v_responses_count;
  RAISE NOTICE 'VIEW "assessments" updated (LEFT JOIN both instrument tables)';
  RAISE NOTICE 'INSERT trigger: detects project vs global instrument';
  RAISE NOTICE 'UPDATE trigger: detects project vs global instrument';
  RAISE NOTICE 'assessment_responses: project_assessment_item_id column added (XOR)';
  RAISE NOTICE '=========================================================';
END $$;
