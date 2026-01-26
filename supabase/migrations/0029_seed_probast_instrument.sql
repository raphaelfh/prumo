-- =====================================================
-- MIGRATION: Seed PROBAST Instrument
-- =====================================================
-- Descrição: Popula assessment_instruments e assessment_items
-- com o instrumento PROBAST (Prediction Model Risk of Bias
-- Assessment Tool) completo com 20 questões em 4 domínios.
--
-- Referência: https://www.probast.org/
-- =====================================================

-- Insert PROBAST instrument
INSERT INTO assessment_instruments (
  id,
  tool_type,
  name,
  version,
  mode,
  is_active,
  schema,
  aggregation_rules
)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid,  -- Fixed UUID for reference
  'PROBAST',
  'Prediction Model Risk of Bias Assessment Tool',
  '1.0',
  'hybrid',  -- Supports both human and AI assessment
  true,
  jsonb_build_object(
    'domains', jsonb_build_array('participants', 'predictors', 'outcome', 'analysis'),
    'overall_risk', jsonb_build_array('low', 'high', 'unclear'),
    'applicability', jsonb_build_array('low concerns', 'high concerns', 'unclear'),
    'description', 'PROBAST is a tool for assessing risk of bias and applicability of prediction model studies'
  ),
  jsonb_build_object(
    'domain_aggregation', 'If any item in a domain is "high risk", the domain is "high risk". If all are "low risk", domain is "low risk". Otherwise "unclear".',
    'overall_aggregation', 'If any domain is "high risk", overall is "high risk".'
  )
);

-- Variable to store instrument ID
DO $$
DECLARE
  v_probast_id uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid;
BEGIN

  -- =================== DOMAIN 1: PARTICIPANTS ===================

  INSERT INTO assessment_items (instrument_id, domain, item_code, question, sort_order, allowed_levels, required) VALUES
  (v_probast_id, 'participants', '1.1', 'Were appropriate data sources used, e.g. cohort, RCT or nested case-control study data?', 1,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'participants', '1.2', 'Were all inclusions and exclusions of participants appropriate?', 2,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true);

  -- =================== DOMAIN 2: PREDICTORS ===================

  INSERT INTO assessment_items (instrument_id, domain, item_code, question, sort_order, allowed_levels, required) VALUES
  (v_probast_id, 'predictors', '2.1', 'Were predictors defined and assessed in a similar way for all participants?', 3,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'predictors', '2.2', 'Were predictor assessments made without knowledge of outcome data?', 4,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'predictors', '2.3', 'Are all predictors available at the time the model is intended to be used?', 5,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true);

  -- =================== DOMAIN 3: OUTCOME ===================

  INSERT INTO assessment_items (instrument_id, domain, item_code, question, sort_order, allowed_levels, required) VALUES
  (v_probast_id, 'outcome', '3.1', 'Was the outcome determined appropriately?', 6,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'outcome', '3.2', 'Was a prespecified or standard outcome definition used?', 7,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'outcome', '3.3', 'Were predictors excluded from the outcome definition?', 8,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'outcome', '3.4', 'Was the outcome defined and determined in a similar way for all participants?', 9,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'outcome', '3.5', 'Was the outcome determined without knowledge of predictor information?', 10,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'outcome', '3.6', 'Was the time interval between predictor assessment and outcome determination appropriate?', 11,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true);

  -- =================== DOMAIN 4: ANALYSIS ===================

  INSERT INTO assessment_items (instrument_id, domain, item_code, question, sort_order, allowed_levels, required) VALUES
  (v_probast_id, 'analysis', '4.1', 'Were there a reasonable number of participants with the outcome?', 12,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'analysis', '4.2', 'Were continuous and categorical predictors handled appropriately?', 13,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'analysis', '4.3', 'Were all enrolled participants included in the analysis?', 14,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'analysis', '4.4', 'Were participants with missing data handled appropriately?', 15,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'analysis', '4.5', 'Was selection of predictors based on univariable analysis avoided?', 16,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'analysis', '4.6', 'Were complexities in the data (e.g. censoring, competing risks, sampling of control participants) accounted for appropriately?', 17,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'analysis', '4.7', 'Were relevant model performance measures evaluated appropriately?', 18,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'analysis', '4.8', 'Were model overfitting and optimism in model performance accounted for?', 19,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true),

  (v_probast_id, 'analysis', '4.9', 'Do predictors and their assigned weights in the final model correspond to the results from the reported multivariable analysis?', 20,
   '["yes", "probably yes", "probably no", "no", "no information"]'::jsonb, true);

END $$;

-- Comments
COMMENT ON TABLE assessment_instruments IS 'Assessment instruments (PROBAST, QUADAS-2, RoB2, ROBIS, etc.)';
COMMENT ON TABLE assessment_items IS 'Individual questions/items within each assessment instrument';

-- Verification query (can be run manually to check seed)
-- SELECT
--   ai.tool_type,
--   ai.name,
--   ai.version,
--   COUNT(aitm.id) as total_items,
--   COUNT(DISTINCT aitm.domain) as total_domains
-- FROM assessment_instruments ai
-- LEFT JOIN assessment_items aitm ON aitm.instrument_id = ai.id
-- WHERE ai.tool_type = 'PROBAST'
-- GROUP BY ai.id, ai.tool_type, ai.name, ai.version;
--
-- Expected result: 1 instrument, 20 items, 4 domains
