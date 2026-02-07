-- =====================================================
-- MIGRATION: Project Assessment Instruments
-- =====================================================
-- Description: Creates project-level assessment instrument tables
-- to allow per-project customization, following the same pattern
-- as extraction templates.
--
-- New tables:
-- - project_assessment_instruments: Project-specific instruments
-- - project_assessment_items: Project-specific items
--
-- Updates:
-- - assessment_items: Add description and llm_prompt columns
-- - assessment_instances: Add project_instrument_id FK
--
-- Reference: docs/ASSESSMENT_CONFIGURATION_PLAN.md
-- =====================================================

-- =================== STEP 1: ADD COLUMNS TO assessment_items ===================

-- Add description column for human-readable field description
ALTER TABLE assessment_items
  ADD COLUMN IF NOT EXISTS description text;

-- Add llm_prompt column for AI assessment prompt
ALTER TABLE assessment_items
  ADD COLUMN IF NOT EXISTS llm_prompt text;

COMMENT ON COLUMN assessment_items.description IS 'Human-readable description of what this item assesses';
COMMENT ON COLUMN assessment_items.llm_prompt IS 'Prompt template for LLM to use when assessing this item';

-- =================== STEP 2: CREATE project_assessment_instruments ===================

CREATE TABLE project_assessment_instruments (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Project reference
  project_id uuid NOT NULL,

  -- Global instrument reference (if cloned)
  global_instrument_id uuid,

  -- Instrument metadata
  name varchar NOT NULL,
  description text,
  tool_type varchar NOT NULL,  -- PROBAST, ROBIS, QUADAS-2, CUSTOM
  version varchar NOT NULL DEFAULT '1.0.0',
  mode varchar NOT NULL DEFAULT 'human',  -- human, ai, hybrid

  -- Configuration
  is_active boolean NOT NULL DEFAULT true,
  aggregation_rules jsonb,
  schema jsonb,

  -- Audit
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT project_assessment_instruments_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,

  CONSTRAINT project_assessment_instruments_global_instrument_id_fkey
    FOREIGN KEY (global_instrument_id) REFERENCES assessment_instruments(id) ON DELETE SET NULL,

  CONSTRAINT project_assessment_instruments_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT
);

COMMENT ON TABLE project_assessment_instruments IS 'Project-specific assessment instruments (cloned from global or custom created)';
COMMENT ON COLUMN project_assessment_instruments.global_instrument_id IS 'Reference to global instrument if cloned (NULL for custom instruments)';
COMMENT ON COLUMN project_assessment_instruments.tool_type IS 'Type of instrument: PROBAST, ROBIS, QUADAS-2, CUSTOM, etc.';
COMMENT ON COLUMN project_assessment_instruments.mode IS 'Assessment mode: human, ai, or hybrid';

-- Indexes
CREATE INDEX idx_project_assessment_instruments_project_id
  ON project_assessment_instruments(project_id);
CREATE INDEX idx_project_assessment_instruments_active
  ON project_assessment_instruments(project_id, is_active) WHERE is_active = true;

-- =================== STEP 3: CREATE project_assessment_items ===================

CREATE TABLE project_assessment_items (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Project instrument reference
  project_instrument_id uuid NOT NULL,

  -- Global item reference (if cloned)
  global_item_id uuid,

  -- Item definition
  domain varchar NOT NULL,
  item_code varchar NOT NULL,
  question text NOT NULL,
  description text,  -- Human-readable description

  -- Ordering and requirements
  sort_order integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT true,

  -- Response levels
  allowed_levels jsonb NOT NULL,  -- ["yes", "probably yes", "probably no", "no", "no information"]
  allowed_levels_override jsonb,  -- Project-specific override

  -- AI configuration
  llm_prompt text,  -- Prompt template for LLM assessment

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT project_assessment_items_project_instrument_id_fkey
    FOREIGN KEY (project_instrument_id) REFERENCES project_assessment_instruments(id) ON DELETE CASCADE,

  CONSTRAINT project_assessment_items_global_item_id_fkey
    FOREIGN KEY (global_item_id) REFERENCES assessment_items(id) ON DELETE SET NULL,

  -- Unique item code per instrument
  CONSTRAINT uq_project_assessment_item_code UNIQUE (project_instrument_id, item_code)
);

COMMENT ON TABLE project_assessment_items IS 'Project-specific assessment items (cloned from global or custom created)';
COMMENT ON COLUMN project_assessment_items.global_item_id IS 'Reference to global item if cloned (NULL for custom items)';
COMMENT ON COLUMN project_assessment_items.domain IS 'Domain grouping (e.g., participants, predictors, outcome, analysis)';
COMMENT ON COLUMN project_assessment_items.item_code IS 'Unique code within instrument (e.g., 1.1, 2.3)';
COMMENT ON COLUMN project_assessment_items.description IS 'Human-readable description of what this item assesses';
COMMENT ON COLUMN project_assessment_items.llm_prompt IS 'Custom prompt template for LLM assessment of this item';

-- Indexes
CREATE INDEX idx_project_assessment_items_instrument_id
  ON project_assessment_items(project_instrument_id);
CREATE INDEX idx_project_assessment_items_domain
  ON project_assessment_items(project_instrument_id, domain);

-- =================== STEP 4: UPDATE assessment_instances ===================

-- Add project_instrument_id column
ALTER TABLE assessment_instances
  ADD COLUMN IF NOT EXISTS project_instrument_id uuid;

-- Add FK constraint
ALTER TABLE assessment_instances
  ADD CONSTRAINT assessment_instances_project_instrument_id_fkey
    FOREIGN KEY (project_instrument_id) REFERENCES project_assessment_instruments(id) ON DELETE RESTRICT;

-- Update constraint: can use global OR project instrument
-- First drop existing constraint if exists
ALTER TABLE assessment_instances
  DROP CONSTRAINT IF EXISTS assessment_instances_instrument_id_fkey;

-- Make instrument_id nullable
ALTER TABLE assessment_instances
  ALTER COLUMN instrument_id DROP NOT NULL;

-- Re-add FK with nullable
ALTER TABLE assessment_instances
  ADD CONSTRAINT assessment_instances_instrument_id_fkey
    FOREIGN KEY (instrument_id) REFERENCES assessment_instruments(id) ON DELETE RESTRICT;

-- Add XOR constraint: must have exactly one instrument reference
ALTER TABLE assessment_instances
  ADD CONSTRAINT chk_assessment_instance_instrument_xor CHECK (
    (instrument_id IS NOT NULL AND project_instrument_id IS NULL) OR
    (instrument_id IS NULL AND project_instrument_id IS NOT NULL)
  );

COMMENT ON COLUMN assessment_instances.project_instrument_id IS 'Reference to project-specific instrument (XOR with instrument_id)';

-- Index for project instrument lookups
CREATE INDEX idx_assessment_instances_project_instrument_id
  ON assessment_instances(project_instrument_id) WHERE project_instrument_id IS NOT NULL;

-- =================== STEP 5: UPDATE PROBAST WITH DESCRIPTIONS AND LLM PROMPTS ===================

-- Update PROBAST items with descriptions and LLM prompts
UPDATE assessment_items SET
  description = 'Evaluates whether appropriate data sources were used for model development (e.g., cohort study, RCT, or nested case-control study data). Inappropriate sources like case-control studies without nested design may introduce selection bias.',
  llm_prompt = 'Analyze the study design and data sources used for prediction model development. Look for information about:
- Study design (cohort, RCT, case-control, nested case-control)
- Data source (registry, electronic health records, clinical trial data)
- Sampling strategy

Based on the article, determine if appropriate data sources were used. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information" if the article does not provide enough details.'
WHERE item_code = '1.1' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether inclusion and exclusion criteria were appropriate and clearly defined. Inappropriate criteria may lead to biased participant selection.',
  llm_prompt = 'Examine the participant selection criteria in the study. Look for:
- Inclusion criteria clarity and appropriateness
- Exclusion criteria and their justification
- Whether criteria match the intended use population
- Potential selection bias from criteria

Determine if all inclusions and exclusions were appropriate. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '1.2' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether predictors were defined and measured consistently across all participants.',
  llm_prompt = 'Analyze how predictors (variables used in the model) were defined and assessed. Consider:
- Consistency in predictor definitions
- Standardization of measurement methods
- Timing of predictor assessment
- Potential for measurement variation

Determine if predictors were defined and assessed similarly for all participants. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '2.1' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether predictor assessments were made without knowledge of the outcome (blinding).',
  llm_prompt = 'Check if predictor measurements were blinded to outcome status. Look for:
- Timing of predictor assessment relative to outcome
- Whether assessors knew outcome status
- Automated vs manual predictor assessment
- Risk of outcome-influenced predictor measurement

Determine if predictor assessments were made without knowledge of outcome data. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '2.2' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether all predictors would be available at the time the model is intended to be used in practice.',
  llm_prompt = 'Assess the clinical availability of predictors. Consider:
- When each predictor would be available in clinical practice
- Whether predictors require future information
- Practical feasibility of obtaining predictors
- Timing constraints for model application

Determine if all predictors are available at the intended time of model use. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '2.3' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether the outcome was determined using appropriate methods.',
  llm_prompt = 'Examine how the outcome was determined. Look for:
- Outcome measurement methods
- Validity of outcome assessment
- Use of objective vs subjective measures
- Appropriateness for the prediction goal

Determine if the outcome was determined appropriately. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '3.1' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether a prespecified or standard outcome definition was used.',
  llm_prompt = 'Check the outcome definition used in the study. Consider:
- Whether a standard/established definition was used
- If the definition was prespecified
- Consistency with clinical guidelines
- Clarity of outcome definition

Determine if a prespecified or standard outcome definition was used. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '3.2' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether predictors were excluded from the outcome definition to avoid incorporation bias.',
  llm_prompt = 'Check if any predictors are part of the outcome definition (incorporation bias). Look for:
- Overlap between predictors and outcome criteria
- Whether predictor values influence outcome determination
- Independence of outcome from predictor measurements

Determine if predictors were excluded from the outcome definition. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '3.3' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether the outcome was defined and determined consistently for all participants.',
  llm_prompt = 'Assess consistency in outcome determination. Consider:
- Same methods used for all participants
- Standardization across time/sites
- Potential differential outcome assessment
- Blinding considerations

Determine if outcome was defined and determined similarly for all participants. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '3.4' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether outcome determination was blinded to predictor information.',
  llm_prompt = 'Check if outcome assessors were blinded to predictor values. Look for:
- Timing of outcome assessment
- Whether assessors knew predictor values
- Automated vs manual outcome determination
- Risk of predictor-influenced outcome assessment

Determine if outcome was determined without knowledge of predictor information. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '3.5' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether the time interval between predictor assessment and outcome was appropriate for the prediction goal.',
  llm_prompt = 'Assess the time horizon for prediction. Consider:
- Time between predictor measurement and outcome
- Clinical relevance of the time interval
- Whether interval matches intended use
- Consistency of follow-up timing

Determine if the time interval between predictor assessment and outcome determination was appropriate. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '3.6' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether there were enough outcome events relative to the number of predictors (events per variable).',
  llm_prompt = 'Assess sample size adequacy. Look for:
- Number of outcome events
- Number of candidate predictors
- Events per variable ratio
- Risk of overfitting due to small sample

Determine if there were a reasonable number of participants with the outcome. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '4.1' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether continuous predictors were handled appropriately (not categorized inappropriately) and categorical predictors had adequate categories.',
  llm_prompt = 'Examine predictor handling in the analysis. Consider:
- Treatment of continuous variables (linear, transformed, categorized)
- Appropriateness of categorization if used
- Handling of categorical variables
- Missing categories or inappropriate groupings

Determine if continuous and categorical predictors were handled appropriately. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '4.2' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether all enrolled participants were included in the analysis without inappropriate exclusions.',
  llm_prompt = 'Check participant inclusion in analysis. Look for:
- Number enrolled vs analyzed
- Reasons for exclusions
- Whether exclusions were appropriate
- Potential for selection bias from exclusions

Determine if all enrolled participants were included in the analysis. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '4.3' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether missing data was handled appropriately (e.g., multiple imputation vs complete case analysis).',
  llm_prompt = 'Assess missing data handling. Consider:
- Amount of missing data
- Methods used (complete case, imputation, etc.)
- Appropriateness of chosen method
- Sensitivity analyses for missing data

Determine if participants with missing data were handled appropriately. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '4.4' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether predictors were selected using appropriate methods (avoiding univariable selection which can lead to unstable models).',
  llm_prompt = 'Check predictor selection methodology. Look for:
- Selection based on univariable analysis
- Use of stepwise selection
- Clinical/literature-based selection
- Risk of including spurious predictors

Determine if selection of predictors based on univariable analysis was avoided. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '4.5' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether the analysis appropriately handled data complexities like censoring, competing risks, or case-control sampling.',
  llm_prompt = 'Assess handling of data complexities. Consider:
- Censoring in survival analysis
- Competing risks
- Clustered/correlated data
- Case-control sampling weights
- Time-varying predictors

Determine if complexities in the data were accounted for appropriately. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '4.6' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether appropriate performance measures were calculated (discrimination, calibration, clinical utility).',
  llm_prompt = 'Assess model performance evaluation. Look for:
- Discrimination measures (AUC, c-statistic)
- Calibration assessment (calibration plots, Hosmer-Lemeshow)
- Clinical utility measures
- Confidence intervals for measures

Determine if relevant model performance measures were evaluated appropriately. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '4.7' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether internal validation was performed to assess and correct for overfitting (e.g., cross-validation, bootstrapping).',
  llm_prompt = 'Check for overfitting assessment and correction. Look for:
- Internal validation methods used
- Cross-validation or bootstrapping
- Optimism-corrected performance
- Shrinkage/penalization methods

Determine if model overfitting and optimism in model performance were accounted for. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '4.8' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

UPDATE assessment_items SET
  description = 'Evaluates whether the final model formula/weights match the reported analysis results.',
  llm_prompt = 'Check consistency between analysis and final model. Look for:
- Match between reported coefficients and final model
- Transparency in model specification
- Documentation of predictor weights
- Ability to implement the model

Determine if predictors and their assigned weights in the final model correspond to the reported multivariable analysis. Answer with one of: "yes", "probably yes", "probably no", "no", or "no information".'
WHERE item_code = '4.9' AND instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

-- =================== STEP 6: RLS POLICIES ===================

-- Enable RLS
ALTER TABLE project_assessment_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_assessment_items ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view instruments for projects they are members of
CREATE POLICY "Users can view project instruments"
  ON project_assessment_instruments
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can insert instruments for projects they are members of
CREATE POLICY "Users can insert project instruments"
  ON project_assessment_instruments
  FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can update instruments for projects they are members of
CREATE POLICY "Users can update project instruments"
  ON project_assessment_instruments
  FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can delete instruments for projects they are members of
CREATE POLICY "Users can delete project instruments"
  ON project_assessment_instruments
  FOR DELETE
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

-- Policy: Users can view items for instruments in their projects
CREATE POLICY "Users can view project items"
  ON project_assessment_items
  FOR SELECT
  USING (
    project_instrument_id IN (
      SELECT pai.id FROM project_assessment_instruments pai
      JOIN project_members pm ON pm.project_id = pai.project_id
      WHERE pm.user_id = auth.uid()
    )
  );

-- Policy: Users can insert items for instruments in their projects
CREATE POLICY "Users can insert project items"
  ON project_assessment_items
  FOR INSERT
  WITH CHECK (
    project_instrument_id IN (
      SELECT pai.id FROM project_assessment_instruments pai
      JOIN project_members pm ON pm.project_id = pai.project_id
      WHERE pm.user_id = auth.uid()
    )
  );

-- Policy: Users can update items for instruments in their projects
CREATE POLICY "Users can update project items"
  ON project_assessment_items
  FOR UPDATE
  USING (
    project_instrument_id IN (
      SELECT pai.id FROM project_assessment_instruments pai
      JOIN project_members pm ON pm.project_id = pai.project_id
      WHERE pm.user_id = auth.uid()
    )
  );

-- Policy: Users can delete items for instruments in their projects
CREATE POLICY "Users can delete project items"
  ON project_assessment_items
  FOR DELETE
  USING (
    project_instrument_id IN (
      SELECT pai.id FROM project_assessment_instruments pai
      JOIN project_members pm ON pm.project_id = pai.project_id
      WHERE pm.user_id = auth.uid()
    )
  );

-- Service role bypass
CREATE POLICY "Service role has full access to project instruments"
  ON project_assessment_instruments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to project items"
  ON project_assessment_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =================== STEP 7: UPDATED_AT TRIGGERS ===================

-- Trigger for project_assessment_instruments
CREATE TRIGGER update_project_assessment_instruments_updated_at
  BEFORE UPDATE ON project_assessment_instruments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for project_assessment_items
CREATE TRIGGER update_project_assessment_items_updated_at
  BEFORE UPDATE ON project_assessment_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =================== STEP 8: HELPER FUNCTION FOR CLONING ===================

-- Function to clone global instrument to project
CREATE OR REPLACE FUNCTION clone_global_instrument_to_project(
  p_project_id uuid,
  p_global_instrument_id uuid,
  p_created_by uuid,
  p_custom_name text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_new_instrument_id uuid;
  v_instrument_record RECORD;
  v_item_record RECORD;
BEGIN
  -- Get global instrument
  SELECT * INTO v_instrument_record
  FROM assessment_instruments
  WHERE id = p_global_instrument_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Global instrument not found: %', p_global_instrument_id;
  END IF;

  -- Create project instrument
  INSERT INTO project_assessment_instruments (
    project_id,
    global_instrument_id,
    name,
    description,
    tool_type,
    version,
    mode,
    is_active,
    aggregation_rules,
    schema,
    created_by
  )
  VALUES (
    p_project_id,
    p_global_instrument_id,
    COALESCE(p_custom_name, v_instrument_record.name),
    v_instrument_record.schema->>'description',
    v_instrument_record.tool_type,
    v_instrument_record.version,
    v_instrument_record.mode,
    true,
    v_instrument_record.aggregation_rules,
    v_instrument_record.schema,
    p_created_by
  )
  RETURNING id INTO v_new_instrument_id;

  -- Clone all items
  FOR v_item_record IN
    SELECT * FROM assessment_items
    WHERE instrument_id = p_global_instrument_id
    ORDER BY sort_order
  LOOP
    INSERT INTO project_assessment_items (
      project_instrument_id,
      global_item_id,
      domain,
      item_code,
      question,
      description,
      sort_order,
      required,
      allowed_levels,
      llm_prompt
    )
    VALUES (
      v_new_instrument_id,
      v_item_record.id,
      v_item_record.domain,
      v_item_record.item_code,
      v_item_record.question,
      v_item_record.description,
      v_item_record.sort_order,
      v_item_record.required,
      v_item_record.allowed_levels,
      v_item_record.llm_prompt
    );
  END LOOP;

  RETURN v_new_instrument_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION clone_global_instrument_to_project IS
'Clones a global assessment instrument to a project, copying all items with descriptions and LLM prompts';

-- =================== STEP 9: VERIFICATION ===================

DO $$
DECLARE
  v_instruments_count INTEGER;
  v_items_with_desc INTEGER;
  v_items_with_prompt INTEGER;
BEGIN
  -- Count PROBAST items with descriptions
  SELECT COUNT(*) INTO v_items_with_desc
  FROM assessment_items
  WHERE instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    AND description IS NOT NULL;

  SELECT COUNT(*) INTO v_items_with_prompt
  FROM assessment_items
  WHERE instrument_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    AND llm_prompt IS NOT NULL;

  RAISE NOTICE '=== PROJECT ASSESSMENT INSTRUMENTS MIGRATION ===';
  RAISE NOTICE 'Tables created:';
  RAISE NOTICE '  - project_assessment_instruments';
  RAISE NOTICE '  - project_assessment_items';
  RAISE NOTICE '';
  RAISE NOTICE 'PROBAST updates:';
  RAISE NOTICE '  - Items with descriptions: %', v_items_with_desc;
  RAISE NOTICE '  - Items with LLM prompts: %', v_items_with_prompt;
  RAISE NOTICE '';
  RAISE NOTICE 'Helper function: clone_global_instrument_to_project()';
  RAISE NOTICE '=================================================';
END $$;
