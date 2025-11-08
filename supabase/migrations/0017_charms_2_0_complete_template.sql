-- =====================================================
-- MIGRATION: CHARMS Complete Template
-- =====================================================
-- Descrição: Cria template global CHARMS completo com todos os campos
-- conforme checklist oficial. Todos os campos são específicos por modelo preditivo.
-- =====================================================

-- =================== PRE-REQUISITE: allow_other columns ===================
-- Garantir que as colunas allow_other existam antes de criar o template
-- (essas colunas são criadas na migration 0018, mas precisamos delas aqui)

ALTER TABLE extraction_fields
  ADD COLUMN IF NOT EXISTS allow_other boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS other_label character varying NOT NULL DEFAULT 'Outro (especificar)',
  ADD COLUMN IF NOT EXISTS other_placeholder character varying;

-- =================== TEMPLATE GLOBAL ===================

DO $$
DECLARE
  v_template_id UUID;
  v_prediction_models_id UUID;
  v_source_of_data_id UUID;
  v_participants_id UUID;
  v_outcome_id UUID;
  v_candidate_predictors_id UUID;
  v_sample_size_id UUID;
  v_missing_data_id UUID;
  v_model_development_id UUID;
  v_final_predictors_id UUID;
  v_model_performance_id UUID;
  v_model_validation_id UUID;
  v_model_results_id UUID;
  v_model_interpretation_id UUID;
  v_model_observations_id UUID;
BEGIN
  -- Criar template global
  INSERT INTO extraction_templates_global (name, description, framework, version)
  VALUES (
    'CHARMS',
    'CHARMS Checklist completo para modelos preditivos. Todos os campos são específicos por modelo preditivo.',
    'CHARMS',
    '1.0.0'
  )
  RETURNING id INTO v_template_id;

  RAISE NOTICE 'Template criado: %', v_template_id;

  -- =================== ENTITY TYPES ===================
  
  -- 1. ROOT: prediction_models
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'prediction_models',
    'Prediction Models',
    'Modelos preditivos encontrados no artigo. Cada modelo tem suas próprias seções e campos.',
    'many',
    0,
    false
  )
  RETURNING id INTO v_prediction_models_id;

  -- 2. source_of_data
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'source_of_data',
    'Source of Data',
    'Fonte dos dados utilizados no estudo (CHARMS item 1.1)',
    v_prediction_models_id,
    'one',
    1,
    false
  )
  RETURNING id INTO v_source_of_data_id;

  -- 3. participants
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'participants',
    'Participants',
    'Informações sobre participantes do estudo (CHARMS items 2.1-2.8)',
    v_prediction_models_id,
    'one',
    2,
    false
  )
  RETURNING id INTO v_participants_id;

  -- 4. outcome_to_be_predicted
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'outcome_to_be_predicted',
    'Outcome to be Predicted',
    'Variável desfecho a ser predita (CHARMS items 3.1-3.7)',
    v_prediction_models_id,
    'one',
    3,
    false
  )
  RETURNING id INTO v_outcome_id;

  -- 5. candidate_predictors
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'candidate_predictors',
    'Candidate Predictors',
    'Preditores candidatos avaliados (CHARMS items 4.1-4.6)',
    v_prediction_models_id,
    'one',
    4,
    false
  )
  RETURNING id INTO v_candidate_predictors_id;

  -- 6. sample_size
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'sample_size',
    'Sample Size',
    'Tamanho da amostra e eventos (CHARMS items 5.1-5.3)',
    v_prediction_models_id,
    'one',
    5,
    false
  )
  RETURNING id INTO v_sample_size_id;

  -- 7. missing_data
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'missing_data',
    'Missing Data',
    'Dados faltantes e tratamento (CHARMS items 6.1-6.2)',
    v_prediction_models_id,
    'one',
    6,
    false
  )
  RETURNING id INTO v_missing_data_id;

  -- 8. model_development
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'model_development',
    'Model Development',
    'Desenvolvimento do modelo preditivo (CHARMS items 7.1-7.4)',
    v_prediction_models_id,
    'one',
    7,
    false
  )
  RETURNING id INTO v_model_development_id;

  -- 9. final_predictors
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'final_predictors',
    'Final Predictors',
    'Preditores finais incluídos no modelo (múltiplos permitidos)',
    v_prediction_models_id,
    'many',
    8,
    false
  )
  RETURNING id INTO v_final_predictors_id;

  -- 10. model_performance
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'model_performance',
    'Model Performance',
    'Desempenho do modelo (calibração, discriminação, medidas gerais, utilidade clínica) - CHARMS items 8.1-8.4',
    v_prediction_models_id,
    'one',
    9,
    false
  )
  RETURNING id INTO v_model_performance_id;

  -- 11. model_validation
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'model_validation',
    'Model Validation',
    'Validação do modelo (CHARMS items 9.1-9.2)',
    v_prediction_models_id,
    'one',
    10,
    false
  )
  RETURNING id INTO v_model_validation_id;

  -- 12. model_results
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'model_results',
    'Results',
    'Resultados finais do modelo (CHARMS items 10.1-10.4)',
    v_prediction_models_id,
    'one',
    11,
    false
  )
  RETURNING id INTO v_model_results_id;

  -- 13. model_interpretation
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'model_interpretation',
    'Interpretation',
    'Interpretação do modelo apresentado (CHARMS item 11.1)',
    v_prediction_models_id,
    'one',
    12,
    false
  )
  RETURNING id INTO v_model_interpretation_id;

  -- 14. model_observations
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, parent_entity_type_id, cardinality, sort_order, is_required
  )
  VALUES (
    v_template_id,
    'model_observations',
    'Observations',
    'Observações sobre processo de extração e informações adicionais (CHARMS items 12.1-12.2)',
    v_prediction_models_id,
    'one',
    13,
    false
  )
  RETURNING id INTO v_model_observations_id;

  RAISE NOTICE 'Entity types criados: 15 total';

  -- =================== FIELDS ===================

  -- =================== PREDICTION_MODELS FIELDS ===================
  
  -- 0.5 Model name
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_prediction_models_id,
    'model_name',
    'Model Name',
    'Nome do modelo preditivo (CHARMS item 0.5)',
    'text',
    true,
    0,
    'Extract the name or identifier of the prediction model. If multiple models are presented, extract each separately.'
  );

  -- 7.1 Modelling method
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, allowed_values, sort_order, validation_schema, llm_description, allow_other, other_label
  )
  VALUES (
    v_prediction_models_id,
    'modelling_method',
    'Modelling Method',
    'Método de modelagem utilizado (CHARMS item 7.1)',
    'select',
    true,
    '["Logistic regression", "Cox regression", "Linear regression", "Poisson regression"]'::jsonb,
    1,
    '{}'::jsonb,
    'Extract the statistical modelling method used to develop the prediction model (e.g., logistic regression, Cox regression).',
    true,
    'Outro (especificar)'
  );

  -- =================== SOURCE_OF_DATA FIELDS ===================

  -- 1.1 Source of data
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, allowed_values, sort_order, validation_schema, llm_description, allow_other, other_label
  )
  VALUES (
    v_source_of_data_id,
    'data_source',
    'Source of Data',
    'Fonte dos dados utilizados no estudo (CHARMS item 1.1)',
    'select',
    true,
    '["Prospective cohort", "Retrospective cohort", "Case-control", "Case series"]'::jsonb,
    0,
    '{}'::jsonb,
    'Extract the source of data used in the study. Common sources include prospective cohort, retrospective cohort, case-control studies, or other sources.',
    true,
    'Outro (especificar)'
  );

  -- =================== PARTICIPANTS FIELDS ===================

  -- 2.1 Recruitment method
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, allowed_values, sort_order, validation_schema, llm_description, allow_other, other_label
  )
  VALUES (
    v_participants_id,
    'recruitment_method',
    'Recruitment Method',
    'Método de recrutamento de participantes (CHARMS item 2.1)',
    'select',
    true,
    '["Consecutive patients", "Random sampling", "Convenience sampling", "Stratified sampling", "No information"]'::jsonb,
    0,
    '{}'::jsonb,
    'Extract the method used to recruit participants into the study.',
    true,
    'Outro (especificar)'
  );

  -- 2.2 Recruitment dates
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_participants_id,
    'recruitment_dates',
    'Recruitment Dates',
    'Período de recrutamento de participantes (CHARMS item 2.2)',
    'text',
    true,
    2,
    'Extract the dates or time period during which participants were recruited. Include start and end dates if available.'
  );

  -- 2.3 Study setting
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_participants_id,
    'study_setting',
    'Study Setting',
    'Ambiente/local do estudo (CHARMS item 2.3)',
    'text',
    true,
    3,
    'Extract the setting where the study was conducted (e.g., primary care, secondary care, tertiary care, community setting).'
  );

  -- 2.4 Study sites (Regions)
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_participants_id,
    'study_sites_regions',
    'Study Sites (Regions)',
    'Regiões ou locais onde o estudo foi realizado (CHARMS item 2.4)',
    'text',
    true,
    4,
    'Extract the geographical regions or locations where the study was conducted (e.g., countries, states, cities).'
  );

  -- 2.5 Study sites (Number of centers)
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, unit, llm_description
  )
  VALUES (
    v_participants_id,
    'study_sites_number',
    'Study Sites (Number of Centers)',
    'Número de centros/locais de estudo (CHARMS item 2.5)',
    'number',
    true,
    5,
    'centers',
    'Extract the number of centers or sites where the study was conducted.'
  );

  -- 2.6 Criteria inclusion
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_participants_id,
    'inclusion_criteria',
    'Inclusion Criteria',
    'Critérios de inclusão de participantes (CHARMS item 2.6)',
    'text',
    true,
    6,
    'Extract the criteria used to include participants in the study. Include all specific inclusion criteria mentioned.'
  );

  -- 2.7 Criteria exclusion
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_participants_id,
    'exclusion_criteria',
    'Exclusion Criteria',
    'Critérios de exclusão de participantes (CHARMS item 2.7)',
    'text',
    true,
    7,
    'Extract the criteria used to exclude participants from the study. Include all specific exclusion criteria mentioned.'
  );

  -- 2.8.1 Age of participants
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_participants_id,
    'age_of_participants',
    'Age of Participants',
    'Idade dos participantes (CHARMS item 2.8.1)',
    'text',
    true,
    8,
    'Extract the age of participants. Include mean (SD), median (IQR), or range as reported in the study.'
  );

  -- 2.8.2 Native valve endocarditis
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, unit, llm_description
  )
  VALUES (
    v_participants_id,
    'native_valve_endocarditis',
    'Native Valve Endocarditis',
    'Número ou proporção de participantes com endocardite de válvula nativa (CHARMS item 2.8.2)',
    'text',
    true,
    9,
    NULL,
    'Extract the number and percentage of participants with native valve endocarditis (n (%)).'
  );

  -- 2.8.3 Valve affected
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_participants_id,
    'valve_affected',
    'Valve Affected',
    'Válvulas afetadas (CHARMS item 2.8.3)',
    'text',
    true,
    10,
    'Extract information about which valves were affected (e.g., mitral, aortic, tricuspid, pulmonary, or all valves).'
  );

  -- 2.8.4 Characteristic 4
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_participants_id,
    'characteristic_4',
    'Characteristic 4',
    'Característica adicional 4 dos participantes (CHARMS item 2.8.4)',
    'text',
    true,
    11,
    'Extract additional participant characteristic 4 as reported in the study.'
  );

  -- 2.8.5 Characteristic 5
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_participants_id,
    'characteristic_5',
    'Characteristic 5',
    'Característica adicional 5 dos participantes (CHARMS item 2.8.5)',
    'text',
    true,
    12,
    'Extract additional participant characteristic 5 as reported in the study.'
  );

  -- =================== OUTCOME FIELDS ===================

  -- 3.1 Outcome
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_outcome_id,
    'outcome',
    'Outcome',
    'Variável desfecho predita (CHARMS item 3.1)',
    'text',
    true,
    0,
    'Extract the outcome variable that the prediction model is designed to predict (e.g., mortality, disease progression, treatment response).'
  );

  -- 3.2 Outcome definition
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_outcome_id,
    'outcome_definition',
    'Outcome Definition',
    'Definição do desfecho (CHARMS item 3.2)',
    'text',
    true,
    1,
    'Extract the precise definition of the outcome variable, including how it was measured or assessed.'
  );

  -- 3.3 Same outcome definition for all participants
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_outcome_id,
    'same_outcome_definition',
    'Same Outcome Definition for All Participants',
    'Mesma definição de desfecho para todos os participantes? (CHARMS item 3.3)',
    'select',
    true,
    2,
    '["Yes", "No", "Unclear", "No information"]'::jsonb,
    'Determine if the same outcome definition was used for all participants in the study.'
  );

  -- 3.4 Type of outcome
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_outcome_id,
    'type_of_outcome',
    'Type of Outcome',
    'Tipo de desfecho (CHARMS item 3.4)',
    'select',
    true,
    3,
    '["Single", "Composite", "Time-to-event"]'::jsonb,
    'Extract the type of outcome: single outcome, composite outcome, or time-to-event outcome.'
  );

  -- 3.5 Was the outcome assessed without knowledge of the predictors?
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_outcome_id,
    'outcome_assessed_blinded',
    'Outcome Assessed Blinded to Predictors',
    'O desfecho foi avaliado sem conhecimento dos preditores? (CHARMS item 3.5)',
    'select',
    true,
    4,
    '["Yes", "No", "Unclear", "No information"]'::jsonb,
    'Determine if the outcome was assessed without knowledge of the predictor values (blinded assessment).'
  );

  -- 3.6 Were candidate predictors part of outcome?
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_outcome_id,
    'predictors_part_of_outcome',
    'Predictors Part of Outcome',
    'Os preditores candidatos fazem parte da definição do desfecho? (CHARMS item 3.6)',
    'select',
    true,
    5,
    '["Yes", "No", "Unclear", "No information"]'::jsonb,
    'Determine if any candidate predictors were part of the outcome definition (potential circularity).'
  );

  -- 3.7 Time of outcome occurrence
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_outcome_id,
    'time_of_outcome',
    'Time of Outcome Occurrence',
    'Momento/tempo de ocorrência do desfecho (CHARMS item 3.7)',
    'text',
    true,
    6,
    'Extract the time point or time period when the outcome was assessed (e.g., 30 days, 1 year, length of hospital stay).'
  );

  -- =================== CANDIDATE_PREDICTORS FIELDS ===================

  -- 4.1 Number of candidate predictors
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, unit, llm_description
  )
  VALUES (
    v_candidate_predictors_id,
    'number_of_candidates',
    'Number of Candidate Predictors',
    'Número de preditores candidatos avaliados (CHARMS item 4.1)',
    'number',
    true,
    0,
    'predictors',
    'Extract the total number of candidate predictors or parameters that were assessed for inclusion in the model.'
  );

  -- 4.2 Type of predictors
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_candidate_predictors_id,
    'type_of_predictors',
    'Type of Predictors',
    'Tipo de preditores candidatos (CHARMS item 4.2)',
    'text',
    true,
    1,
    'Extract the type of candidate predictors assessed (e.g., patient-related factors, disease-related factors, treatment-related factors).'
  );

  -- 4.3 Timing of predictors measurement
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description, allow_other, other_label
  )
  VALUES (
    v_candidate_predictors_id,
    'timing_of_measurement',
    'Timing of Predictors Measurement',
    'Momento de mensuração dos preditores (CHARMS item 4.3)',
    'select',
    true,
    2,
    '["Pre-operative", "Post-operative", "At baseline", "During follow-up", "No information"]'::jsonb,
    'Extract when the candidate predictors were measured relative to the outcome or intervention.',
    true,
    'Outro (especificar)'
  );

  -- 4.4 Predictors definition and measurement similar for all participants
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_candidate_predictors_id,
    'predictors_definition_similar',
    'Predictors Definition Similar for All Participants',
    'Definição e mensuração dos preditores similares para todos os participantes? (CHARMS item 4.4)',
    'select',
    true,
    4,
    '["Yes", "No", "Unclear", "No information"]'::jsonb,
    'Determine if the definition and measurement of candidate predictors were similar for all participants.'
  );

  -- 4.5 Were predictors assessed blinded for outcome?
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_candidate_predictors_id,
    'predictors_assessed_blinded',
    'Predictors Assessed Blinded for Outcome',
    'Os preditores foram avaliados sem conhecimento do desfecho? (CHARMS item 4.5)',
    'select',
    true,
    5,
    '["Yes", "No", "Unclear", "No information"]'::jsonb,
    'Determine if candidate predictors were assessed without knowledge of the outcome (blinded assessment).'
  );

  -- 4.6 Handling of continuous predictors
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description, allow_other, other_label
  )
  VALUES (
    v_candidate_predictors_id,
    'handling_continuous',
    'Handling of Continuous Predictors',
    'Tratamento de preditores contínuos (CHARMS item 4.6)',
    'select',
    true,
    6,
    '["Kept continuous", "Categorized", "Restricted cubic spline function", "No information"]'::jsonb,
    'Extract how continuous predictors were handled in the model (e.g., kept continuous, categorized, transformed).',
    true,
    'Outro (especificar)'
  );

  -- =================== SAMPLE_SIZE FIELDS ===================

  -- 5.1 Number of participants
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, unit, llm_description
  )
  VALUES (
    v_sample_size_id,
    'number_of_participants',
    'Number of Participants',
    'Número total de participantes (CHARMS item 5.1)',
    'number',
    true,
    0,
    'participants',
    'Extract the total number of participants included in the study for model development.'
  );

  -- 5.2 Number of outcomes/events
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, unit, llm_description
  )
  VALUES (
    v_sample_size_id,
    'number_of_events',
    'Number of Outcomes/Events',
    'Número de eventos/desfechos observados (CHARMS item 5.2)',
    'number',
    true,
    1,
    'events',
    'Extract the number of outcome events that occurred in the study sample.'
  );

  -- 5.3 Number events per variable (EPV) or per parameter (EPP)
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, unit, llm_description
  )
  VALUES (
    v_sample_size_id,
    'epv_epp',
    'Events Per Variable (EPV) or Per Parameter (EPP)',
    'Número de eventos por variável (EPV) ou por parâmetro (EPP) (CHARMS item 5.3)',
    'number',
    true,
    2,
    'events/variable',
    'Extract the number of events per variable (EPV) or events per parameter (EPP) ratio, which indicates the adequacy of the sample size for model development.'
  );

  -- =================== MISSING_DATA FIELDS ===================

  -- 6.1 Number of participants with any missing value
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_missing_data_id,
    'participants_with_missing',
    'Number of Participants with Any Missing Value',
    'Número de participantes com valores faltantes (CHARMS item 6.1)',
    'text',
    true,
    0,
    '["No information"]'::jsonb,
    'Extract the number or percentage of participants with any missing values for candidate predictors or outcome. If not reported, mark as "No information".'
  );

  -- 6.2 Handling of missing data
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description, allow_other, other_label
  )
  VALUES (
    v_missing_data_id,
    'handling_of_missing',
    'Handling of Missing Data',
    'Tratamento de dados faltantes (CHARMS item 6.2)',
    'select',
    true,
    1,
    '["Complete case analysis", "Multiple imputation", "Single imputation", "No information"]'::jsonb,
    'Extract how missing data were handled in the analysis (e.g., complete case analysis, imputation methods).',
    true,
    'Outro (especificar)'
  );

  -- =================== MODEL_DEVELOPMENT FIELDS ===================

  -- 7.2 Method for selection of candidate predictors
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description, allow_other, other_label
  )
  VALUES (
    v_model_development_id,
    'selection_method_candidates',
    'Method for Selection of Candidate Predictors',
    'Método para seleção de preditores candidatos (CHARMS item 7.2)',
    'select',
    true,
    0,
    '["Based on univariable associations", "Based on literature", "All candidates", "Clinical expertise", "No information"]'::jsonb,
    'Extract the method used to select candidate predictors for consideration in the multivariable model.',
    true,
    'Outro (especificar)'
  );

  -- 7.3 Method for selection of predictors during multivariable modelling
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description, allow_other, other_label
  )
  VALUES (
    v_model_development_id,
    'selection_method_multivariable',
    'Method for Selection During Multivariable Modelling',
    'Método de seleção durante modelagem multivariável (CHARMS item 7.3)',
    'select',
    true,
    2,
    '["Backward elimination", "Forward selection", "Stepwise", "LASSO", "Ridge regression", "Elastic net", "Best subset", "No information"]'::jsonb,
    'Extract the method used to select predictors during multivariable model development (e.g., backward elimination, forward selection, stepwise, LASSO).',
    true,
    'Outro (especificar)'
  );

  -- 7.4 Shrinkage of predictor weights or regression coefficients
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_development_id,
    'shrinkage',
    'Shrinkage of Predictor Weights or Regression Coefficients',
    'Encolhimento (shrinkage) de pesos de preditores ou coeficientes de regressão (CHARMS item 7.4)',
    'select',
    true,
    4,
    '["Yes", "No", "No information"]'::jsonb,
    'Determine if shrinkage was applied to predictor weights or regression coefficients to reduce overfitting.'
  );

  -- =================== FINAL_PREDICTORS FIELDS ===================

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_final_predictors_id,
    'predictor_name',
    'Predictor Name',
    'Nome do preditor final incluído no modelo',
    'text',
    true,
    0,
    'Extract the name of each final predictor included in the prediction model.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_final_predictors_id,
    'predictor_weight',
    'Predictor Weight',
    'Peso ou coeficiente do preditor no modelo',
    'text',
    true,
    1,
    'Extract the weight, coefficient, or contribution of the predictor in the final model (may include confidence intervals).'
  );

  -- =================== MODEL_PERFORMANCE FIELDS ===================

  -- 8.1.1 Calibration plot
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'calibration_plot',
    'Calibration Plot',
    'Gráfico de calibração (CHARMS item 8.1.1)',
    'select',
    true,
    0,
    '["Yes", "No", "No information"]'::jsonb,
    'Determine if a calibration plot was presented to assess model calibration.'
  );

  -- 8.1.2 Calibration slope
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'calibration_slope',
    'Calibration Slope',
    'Coeficiente de calibração (slope) (CHARMS item 8.1.2)',
    'select',
    true,
    1,
    '["Yes", "No", "No information"]'::jsonb,
    'Determine if calibration slope was reported. If yes, extract the value and confidence interval.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'calibration_slope_value',
    'Calibration Slope Value',
    'Valor do coeficiente de calibração',
    'number',
    true,
    2,
    'Extract the calibration slope value if reported.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'calibration_slope_ci',
    'Calibration Slope (95% CI)',
    'Intervalo de confiança de 95% do coeficiente de calibração',
    'text',
    true,
    3,
    'Extract the 95% confidence interval for calibration slope if reported (e.g., "0.64 to 0.78").'
  );

  -- 8.1.3 Calibration-in-the-large (CITL)
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'calibration_in_large',
    'Calibration-in-the-Large (CITL)',
    'Calibração no geral (CITL) (CHARMS item 8.1.3)',
    'select',
    true,
    4,
    '["Yes", "No", "No information"]'::jsonb,
    'Determine if calibration-in-the-large (CITL) was reported. If yes, extract the value and confidence interval.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'calibration_in_large_value',
    'Calibration-in-the-Large Value',
    'Valor da calibração no geral (CITL)',
    'number',
    true,
    5,
    'Extract the calibration-in-the-large value if reported.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'calibration_in_large_ci',
    'Calibration-in-the-Large (95% CI)',
    'Intervalo de confiança de 95% da calibração no geral',
    'text',
    true,
    6,
    'Extract the 95% confidence interval for calibration-in-the-large if reported.'
  );

  -- 8.1.4 Hosmer-Lemeshow test
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'hosmer_lemeshow',
    'Hosmer-Lemeshow Test',
    'Teste de Hosmer-Lemeshow (CHARMS item 8.1.4)',
    'select',
    true,
    7,
    '["Yes", "No", "No information"]'::jsonb,
    'Determine if Hosmer-Lemeshow test was reported. If yes, extract the p-value.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'hosmer_lemeshow_p_value',
    'Hosmer-Lemeshow Test (p-value)',
    'Valor p do teste de Hosmer-Lemeshow',
    'text',
    true,
    8,
    'Extract the p-value from Hosmer-Lemeshow test if reported.'
  );

  -- 8.1.5 Other calibration measures
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, validation_schema, llm_description
  )
  VALUES (
    v_model_performance_id,
    'calibration_other',
    'Other Calibration Measures',
    'Outras medidas de calibração (CHARMS item 8.1.5)',
    'select',
    true,
    9,
    '["Yes", "No", "No information"]'::jsonb,
    '{}'::jsonb,
    'Determine if other calibration measures were reported beyond those listed above.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'calibration_other_specify',
    'Other Calibration Measures (Specify)',
    'Especificar outras medidas de calibração quando "Yes" foi selecionado',
    'text',
    true,
    10,
    'If "Yes" was selected for other calibration measures, extract the specific measures reported.'
  );

  -- 8.2.1 C-Statistic
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'c_statistic',
    'C-Statistic',
    'Estatística C (área sob a curva ROC) (CHARMS item 8.2.1)',
    'select',
    true,
    11,
    '["Yes", "No", "No information"]'::jsonb,
    'Determine if C-statistic (AUC/ROC) was reported. If yes, extract the value and confidence interval.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'c_statistic_value',
    'C-Statistic Value',
    'Valor da estatística C',
    'number',
    true,
    12,
    'Extract the C-statistic value if reported (typically between 0 and 1).'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'c_statistic_ci',
    'C-Statistic (95% CI)',
    'Intervalo de confiança de 95% da estatística C',
    'text',
    true,
    13,
    'Extract the 95% confidence interval for C-statistic if reported (e.g., "0.64 to 0.78").'
  );

  -- 8.2.2 D-Statistic
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'd_statistic',
    'D-Statistic',
    'Estatística D (CHARMS item 8.2.2)',
    'select',
    true,
    14,
    '["Yes", "No", "No information"]'::jsonb,
    'Determine if D-statistic was reported. If yes, extract the value and confidence interval.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'd_statistic_value',
    'D-Statistic Value',
    'Valor da estatística D',
    'number',
    true,
    15,
    'Extract the D-statistic value if reported.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'd_statistic_ci',
    'D-Statistic (95% CI)',
    'Intervalo de confiança de 95% da estatística D',
    'text',
    true,
    16,
    'Extract the 95% confidence interval for D-statistic if reported.'
  );

  -- 8.2.3 AUC graph
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'auc_graph',
    'AUC Graph',
    'Gráfico de AUC/ROC (CHARMS item 8.2.3)',
    'select',
    true,
    17,
    '["Yes", "No", "No information"]'::jsonb,
    'Determine if an AUC/ROC graph or curve was presented.'
  );

  -- 8.2.4 Log-rank test (if survival analysis)
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'log_rank_test',
    'Log-Rank Test (if survival analysis)',
    'Teste de Log-Rank (se análise de sobrevida) (CHARMS item 8.2.4)',
    'select',
    true,
    18,
    '["Yes", "No", "Not applicable", "No information"]'::jsonb,
    'If survival analysis was performed, determine if log-rank test was reported. If not a survival analysis, mark as "Not applicable".'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'log_rank_test_p_value',
    'Log-Rank Test (p-value)',
    'Valor p do teste de Log-Rank',
    'text',
    true,
    19,
    'Extract the p-value from log-rank test if reported.'
  );

  -- 8.2.5 Risk group curves (if survival analysis)
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'risk_group_curves',
    'Risk Group Curves (if survival analysis)',
    'Curvas de grupos de risco (se análise de sobrevida) (CHARMS item 8.2.5)',
    'select',
    true,
    20,
    '["Yes", "No", "Not applicable", "No information"]'::jsonb,
    'If survival analysis was performed, determine if risk group curves (Kaplan-Meier curves) were presented. If not a survival analysis, mark as "Not applicable".'
  );

  -- 8.2.6 Other discrimination measures
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, validation_schema, llm_description
  )
  VALUES (
    v_model_performance_id,
    'discrimination_other',
    'Other Discrimination Measures',
    'Outras medidas de discriminação (CHARMS item 8.2.6)',
    'select',
    true,
    21,
    '["Yes", "No", "No information"]'::jsonb,
    '{}'::jsonb,
    'Determine if other discrimination measures were reported beyond those listed above.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'discrimination_other_specify',
    'Other Discrimination Measures (Specify)',
    'Especificar outras medidas de discriminação quando "Yes" foi selecionado',
    'text',
    true,
    22,
    'If "Yes" was selected for other discrimination measures, extract the specific measures reported.'
  );

  -- 8.3.1 R-squared
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'r_squared',
    'R-squared',
    'R-quadrado (ex: Cox-Snell R², Nagelkerke''s R²) (CHARMS item 8.3.1)',
    'select',
    true,
    23,
    '["Yes", "No", "Not evaluated", "No information"]'::jsonb,
    'Determine if R-squared was reported (e.g., Cox-Snell R², Nagelkerke''s R²). If yes, extract the value and confidence interval.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'r_squared_value',
    'R-squared Value',
    'Valor do R-quadrado',
    'number',
    true,
    24,
    'Extract the R-squared value if reported (typically between 0 and 1).'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'r_squared_ci',
    'R-squared (95% CI)',
    'Intervalo de confiança de 95% do R-quadrado',
    'text',
    true,
    25,
    'Extract the 95% confidence interval for R-squared if reported.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'r_squared_type',
    'R-squared Type',
    'Tipo de R-quadrado reportado',
    'text',
    true,
    26,
    'Extract the type of R-squared reported (e.g., Cox-Snell R², Nagelkerke''s R², McFadden''s R²).'
  );

  -- 8.3.2 Brier score
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'brier_score',
    'Brier Score',
    'Brier Score (CHARMS item 8.3.2)',
    'select',
    true,
    27,
    '["Yes", "No", "Not evaluated", "No information"]'::jsonb,
    'Determine if Brier score was reported. If yes, extract the value and confidence interval.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'brier_score_value',
    'Brier Score Value',
    'Valor do Brier Score',
    'number',
    true,
    28,
    'Extract the Brier score value if reported (typically between 0 and 1, lower is better).'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'brier_score_ci',
    'Brier Score (95% CI)',
    'Intervalo de confiança de 95% do Brier Score',
    'text',
    true,
    29,
    'Extract the 95% confidence interval for Brier score if reported (e.g., "0.057 to 0.072").'
  );

  -- 8.3.3 Other overall measures
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, validation_schema, llm_description
  )
  VALUES (
    v_model_performance_id,
    'overall_other',
    'Other Overall Measures',
    'Outras medidas gerais (CHARMS item 8.3.3)',
    'select',
    true,
    30,
    '["Yes", "No", "No information"]'::jsonb,
    '{}'::jsonb,
    'Determine if other overall performance measures were reported beyond those listed above.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'overall_other_specify',
    'Other Overall Measures (Specify)',
    'Especificar outras medidas gerais quando "Yes" foi selecionado',
    'text',
    true,
    31,
    'If "Yes" was selected for other overall measures, extract the specific measures reported.'
  );

  -- 8.4.1 Decision Curve Analysis (DCA)
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_performance_id,
    'dca',
    'Decision Curve Analysis (DCA)',
    'Análise de Curva de Decisão (DCA) (CHARMS item 8.4.1)',
    'select',
    true,
    32,
    '["Yes", "No", "Not evaluated", "No information"]'::jsonb,
    'Determine if Decision Curve Analysis (DCA) was performed to assess clinical utility.'
  );

  -- 8.4.2 Other clinical utility measures
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, validation_schema, llm_description
  )
  VALUES (
    v_model_performance_id,
    'clinical_utility_other',
    'Other Clinical Utility Measures',
    'Outras medidas de utilidade clínica (CHARMS item 8.4.2)',
    'select',
    true,
    33,
    '["Yes", "No", "No information"]'::jsonb,
    '{}'::jsonb,
    'Determine if other clinical utility measures were reported beyond DCA.'
  );

  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_performance_id,
    'clinical_utility_other_specify',
    'Other Clinical Utility Measures (Specify)',
    'Especificar outras medidas de utilidade clínica quando "Yes" foi selecionado',
    'text',
    true,
    34,
    'If "Yes" was selected for other clinical utility measures, extract the specific measures reported.'
  );

  -- =================== MODEL_VALIDATION FIELDS ===================

  -- 9.1.1 Internal validation
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description, allow_other, other_label
  )
  VALUES (
    v_model_validation_id,
    'internal_validation',
    'Internal Validation',
    'Validação interna do modelo (CHARMS item 9.1.1)',
    'select',
    true,
    0,
    '["Bootstrap", "Cross-validation", "Split-sample", "None", "No information"]'::jsonb,
    'Extract the method used for internal validation of the model (e.g., bootstrap, cross-validation, split-sample).',
    true,
    'Outro (especificar)'
  );

  -- 9.1.2 External validation
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description, allow_other, other_label
  )
  VALUES (
    v_model_validation_id,
    'external_validation',
    'External Validation',
    'Validação externa do modelo (CHARMS item 9.1.2)',
    'select',
    true,
    2,
    '["Geographical", "Temporal", "Different population", "None", "No information"]'::jsonb,
    'Extract the method used for external validation of the model (e.g., geographical, temporal, different population).',
    true,
    'Outro (especificar)'
  );

  -- 9.2 In case of poor validation, whether model was adjusted or updated
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_validation_id,
    'model_adjusted',
    'Model Adjusted or Updated After Poor Validation',
    'Modelo foi ajustado ou atualizado após validação insatisfatória? (CHARMS item 9.2)',
    'select',
    true,
    4,
    '["Yes", "No", "No information"]'::jsonb,
    'Determine if the model was adjusted or updated after poor validation performance.'
  );

  -- =================== MODEL_RESULTS FIELDS ===================

  -- 10.1 Number of predictors in final model
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, unit, llm_description
  )
  VALUES (
    v_model_results_id,
    'number_of_predictors',
    'Number of Predictors in Final Model',
    'Número de preditores incluídos no modelo final (CHARMS item 10.1)',
    'number',
    true,
    0,
    'predictors',
    'Extract the total number of predictors (or parameters) included in the final prediction model.'
  );

  -- 10.2 Final model included predictor weights or regression coefficients
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_results_id,
    'predictor_weights_or_coefficients',
    'Final Model Included Predictor Weights or Regression Coefficients',
    'Modelo final incluiu pesos de preditores ou coeficientes de regressão? (CHARMS item 10.2)',
    'select',
    true,
    1,
    '["Predictor weights", "Regression coefficients", "Both", "No information"]'::jsonb,
    'Determine if the final model included predictor weights, regression coefficients, or both.'
  );

  -- 10.3 Final model included intercept (or baseline survival)
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_results_id,
    'intercept_included',
    'Final Model Included Intercept (or Baseline Survival)',
    'Modelo final incluiu intercepto (ou sobrevida basal)? (CHARMS item 10.3)',
    'select',
    true,
    2,
    '["Yes", "No", "No information"]'::jsonb,
    'Determine if the final model included an intercept (for regression models) or baseline survival (for survival models).'
  );

  -- 10.4 Alternative presentation of the final prediction models
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description, allow_other, other_label
  )
  VALUES (
    v_model_results_id,
    'alternative_presentation',
    'Alternative Presentation of Final Model',
    'Apresentação alternativa do modelo final (CHARMS item 10.4)',
    'select',
    true,
    3,
    '["Score system", "Nomogram", "Web calculator", "Mobile app", "None", "No information"]'::jsonb,
    'Extract if the final model was presented in an alternative format (e.g., score system, nomogram, web calculator).',
    true,
    'Outro (especificar)'
  );

  -- =================== MODEL_INTERPRETATION FIELDS ===================

  -- 11.1 Interpretation of presented model
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_interpretation_id,
    'interpretation',
    'Interpretation of Presented Model',
    'Interpretação do modelo apresentado (CHARMS item 11.1)',
    'text',
    true,
    0,
    'Extract the interpretation or discussion of the presented prediction model, including clinical implications, limitations, and recommendations for use.'
  );

  -- =================== MODEL_OBSERVATIONS FIELDS ===================

  -- 12.1 Data extraction process
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, llm_description
  )
  VALUES (
    v_model_observations_id,
    'data_extraction_process',
    'Data Extraction Process',
    'Processo de extração de dados (CHARMS item 12.1)',
    'select',
    true,
    0,
    '["All information has been successfully registered", "Some information missing", "Extraction incomplete"]'::jsonb,
    'Record the status of data extraction for this model.'
  );

  -- 12.2 Additional information
  INSERT INTO extraction_fields (
    entity_type_id, name, label, description, field_type, is_required, sort_order, llm_description
  )
  VALUES (
    v_model_observations_id,
    'additional_information',
    'Additional Information',
    'Informações adicionais sobre o modelo ou processo de extração (CHARMS item 12.2)',
    'text',
    true,
    1,
    'Extract any additional information, notes, or observations about the model or extraction process that may be relevant.'
  );

  RAISE NOTICE 'Fields criados: ~80+ total';
  RAISE NOTICE 'Template CHARMS completo criado com sucesso!';

END $$;

-- =================== COMENTÁRIOS FINAIS ===================

COMMENT ON TABLE extraction_templates_global IS 'Template global CHARMS completo com todos os campos conforme checklist oficial';

