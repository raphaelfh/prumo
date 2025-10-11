-- =====================================================
-- MIGRATION: Adicionar Hierarquia ao CHARMS (Preservando Dados)
-- =====================================================
-- Descrição: Adiciona entity types hierárquicos ao template CHARMS
-- SEM deletar dados existentes. Cria CHARMS 2.0 como novo template.
-- =====================================================

DO $$
DECLARE
  charms_v1_id UUID;
  charms_v2_id UUID;
  -- Study-level entities
  source_data_id UUID;
  participants_id UUID;
  outcome_id UUID;
  sample_size_id UUID;
  missing_data_id UUID;
  -- Model-level entities
  prediction_models_id UUID;
  candidate_predictors_id UUID;
  final_predictors_id UUID;
  model_development_id UUID;
  model_performance_id UUID;
  model_validation_id UUID;
BEGIN
  -- Buscar CHARMS v1
  SELECT id INTO charms_v1_id 
  FROM extraction_templates_global 
  WHERE name = 'CHARMS' AND version = '1.0.0';
  
  RAISE NOTICE 'CHARMS v1.0 encontrado: % (preservando 177 instances)', charms_v1_id;
  
  -- Criar CHARMS v2.0 como NOVO template
  INSERT INTO extraction_templates_global (name, description, framework, version, is_global, schema)
  VALUES (
    'CHARMS',
    'CHecklist for critical Appraisal and data extraction for systematic Reviews of prediction Modelling Studies (v2 with hierarchy)',
    'CHARMS',
    '2.0.0',
    true,
    jsonb_build_object(
      'description', 'Template oficial CHARMS com hierarquia Study → Models',
      'hierarchy', true,
      'changelog', 'v2.0: Added hierarchical structure with prediction_models as parent entity'
    )
  ) RETURNING id INTO charms_v2_id;

  RAISE NOTICE 'CHARMS v2.0 criado: %', charms_v2_id;

  -- ========== STUDY-LEVEL ENTITIES (parent_entity_type_id = NULL) ==========
  
  -- 1. Source of Data
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, parent_entity_type_id, sort_order
  ) VALUES (
    charms_v2_id, 'source_of_data', 'Source of Data', 
    'Data source and study setting', 'one', NULL, 1
  ) RETURNING id INTO source_data_id;
  
  INSERT INTO extraction_fields (entity_type_id, name, label, field_type, is_required, sort_order) VALUES
    (source_data_id, 'data_source', 'Source of data', 'text', true, 1),
    (source_data_id, 'recruitment_method', 'Recruitment method', 'text', true, 2),
    (source_data_id, 'recruitment_dates', 'Recruitment dates', 'text', true, 3),
    (source_data_id, 'study_setting', 'Study setting', 'text', true, 4),
    (source_data_id, 'study_sites_regions', 'Study sites (Regions)', 'text', false, 5),
    (source_data_id, 'study_sites_number', 'Study sites (Number of centers)', 'number', false, 6);

  -- 2. Participants
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, parent_entity_type_id, sort_order
  ) VALUES (
    charms_v2_id, 'participants', 'Participants',
    'Participant characteristics and eligibility', 'one', NULL, 2
  ) RETURNING id INTO participants_id;
  
  INSERT INTO extraction_fields (entity_type_id, name, label, field_type, is_required, sort_order) VALUES
    (participants_id, 'inclusion_criteria', 'Inclusion criteria', 'text', true, 1),
    (participants_id, 'exclusion_criteria', 'Exclusion criteria', 'text', true, 2),
    (participants_id, 'participant_description', 'Participant description', 'text', false, 3),
    (participants_id, 'age_of_participants', 'Age of participants', 'text', false, 4);

  -- 3. Outcome
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, parent_entity_type_id, sort_order
  ) VALUES (
    charms_v2_id, 'outcome', 'Outcome to be Predicted',
    'Definition and characteristics of the outcome', 'one', NULL, 3
  ) RETURNING id INTO outcome_id;
  
  INSERT INTO extraction_fields (entity_type_id, name, label, field_type, is_required, sort_order) VALUES
    (outcome_id, 'outcome', 'Outcome', 'text', true, 1),
    (outcome_id, 'outcome_definition', 'Outcome definition', 'text', true, 2),
    (outcome_id, 'same_outcome_definition', 'Same outcome definition for all participants', 'boolean', true, 3),
    (outcome_id, 'type_of_outcome', 'Type of outcome', 'text', true, 4),
    (outcome_id, 'outcome_assessed_blinded', 'Was outcome assessed without knowledge of predictors?', 'text', false, 5),
    (outcome_id, 'predictors_part_of_outcome', 'Were candidate predictors part of outcome?', 'boolean', false, 6),
    (outcome_id, 'time_of_outcome', 'Time of outcome occurrence', 'text', false, 7);

  -- 4. Sample Size
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, parent_entity_type_id, sort_order
  ) VALUES (
    charms_v2_id, 'sample_size', 'Sample Size',
    'Overall sample size and events', 'one', NULL, 4
  ) RETURNING id INTO sample_size_id;
  
  INSERT INTO extraction_fields (entity_type_id, name, label, field_type, is_required, sort_order, unit) VALUES
    (sample_size_id, 'number_of_participants', 'Number of participants', 'number', true, 1, 'participants'),
    (sample_size_id, 'number_of_events', 'Number of outcomes/events', 'number', true, 2, 'events');

  -- 5. Missing Data
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, parent_entity_type_id, sort_order
  ) VALUES (
    charms_v2_id, 'missing_data', 'Missing Data',
    'Handling of missing data', 'one', NULL, 5
  ) RETURNING id INTO missing_data_id;
  
  INSERT INTO extraction_fields (entity_type_id, name, label, field_type, is_required, sort_order) VALUES
    (missing_data_id, 'participants_with_missing', 'Number of participants with any missing value', 'number', false, 1),
    (missing_data_id, 'handling_of_missing', 'Handling of missing data', 'text', false, 2);

  -- ========== MODEL-LEVEL ENTITIES (parent_entity_type_id = prediction_models_id) ==========
  
  -- 6. Prediction Models (TOP-LEVEL PARENT para model-specific data)
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, parent_entity_type_id, sort_order
  ) VALUES (
    charms_v2_id, 'prediction_models', 'Prediction Models',
    'Individual prediction models developed in the study', 'many', NULL, 6
  ) RETURNING id INTO prediction_models_id;
  
  INSERT INTO extraction_fields (entity_type_id, name, label, field_type, is_required, sort_order) VALUES
    (prediction_models_id, 'model_name', 'Model name', 'text', true, 1),
    (prediction_models_id, 'modelling_method', 'Modelling method', 'text', true, 2);

  -- 6.1. Candidate Predictors (CHILD de prediction_models)
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, parent_entity_type_id, sort_order
  ) VALUES (
    charms_v2_id, 'candidate_predictors', 'Candidate Predictors',
    'Predictors initially considered', 'one', prediction_models_id, 1
  ) RETURNING id INTO candidate_predictors_id;
  
  INSERT INTO extraction_fields (entity_type_id, name, label, field_type, is_required, sort_order) VALUES
    (candidate_predictors_id, 'number_of_candidates', 'Number of candidate predictors', 'number', true, 1),
    (candidate_predictors_id, 'type_of_predictors', 'Type of predictors', 'text', false, 2),
    (candidate_predictors_id, 'timing_of_measurement', 'Timing of predictors measurement', 'text', false, 3),
    (candidate_predictors_id, 'predictors_definition_similar', 'Predictors definition similar for all', 'boolean', false, 4),
    (candidate_predictors_id, 'predictors_assessed_blinded', 'Were predictors assessed blinded?', 'text', false, 5),
    (candidate_predictors_id, 'handling_continuous', 'Handling of continuous predictors', 'text', false, 6);

  -- 6.2. Final Predictors (CHILD de prediction_models)
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, parent_entity_type_id, sort_order
  ) VALUES (
    charms_v2_id, 'final_predictors', 'Final Predictors',
    'Predictors included in final model', 'many', prediction_models_id, 2
  ) RETURNING id INTO final_predictors_id;
  
  INSERT INTO extraction_fields (entity_type_id, name, label, field_type, is_required, sort_order) VALUES
    (final_predictors_id, 'predictor_name', 'Predictor name', 'text', true, 1),
    (final_predictors_id, 'predictor_weight', 'Predictor weight/coefficient', 'number', false, 2);

  -- 6.3. Model Development (CHILD de prediction_models)
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, parent_entity_type_id, sort_order
  ) VALUES (
    charms_v2_id, 'model_development', 'Model Development',
    'Methods used for model development', 'one', prediction_models_id, 3
  ) RETURNING id INTO model_development_id;
  
  INSERT INTO extraction_fields (entity_type_id, name, label, field_type, is_required, sort_order) VALUES
    (model_development_id, 'epv_epp', 'Events per variable (EPV) or parameter (EPP)', 'number', false, 1),
    (model_development_id, 'selection_method_candidates', 'Method for selection of candidate predictors', 'text', false, 2),
    (model_development_id, 'selection_method_multivariable', 'Method for selection during multivariable modelling', 'text', false, 3),
    (model_development_id, 'shrinkage', 'Shrinkage of weights or coefficients', 'text', false, 4);

  -- 6.4. Model Performance (CHILD de prediction_models)
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, parent_entity_type_id, sort_order
  ) VALUES (
    charms_v2_id, 'model_performance', 'Model Performance',
    'Performance measures of the model', 'one', prediction_models_id, 4
  ) RETURNING id INTO model_performance_id;
  
  INSERT INTO extraction_fields (entity_type_id, name, label, field_type, is_required, sort_order) VALUES
    (model_performance_id, 'calibration_plot', 'Calibration plot', 'boolean', false, 1),
    (model_performance_id, 'calibration_slope', 'Calibration slope', 'number', false, 2),
    (model_performance_id, 'calibration_in_large', 'Calibration-in-the-large (CITL)', 'number', false, 3),
    (model_performance_id, 'hosmer_lemeshow', 'Hosmer-Lemeshow test', 'text', false, 4),
    (model_performance_id, 'c_statistic', 'C-Statistic', 'number', false, 5),
    (model_performance_id, 'auc_graph', 'AUC graph', 'boolean', false, 6),
    (model_performance_id, 'brier_score', 'Brier score', 'number', false, 7);

  -- 6.5. Model Validation (CHILD de prediction_models)
  INSERT INTO extraction_entity_types (
    template_id, name, label, description, cardinality, parent_entity_type_id, sort_order
  ) VALUES (
    charms_v2_id, 'model_validation', 'Model Validation',
    'Validation methods used', 'one', prediction_models_id, 5
  ) RETURNING id INTO model_validation_id;
  
  INSERT INTO extraction_fields (entity_type_id, name, label, field_type, is_required, sort_order) VALUES
    (model_validation_id, 'internal_validation', 'Internal validation', 'text', false, 1),
    (model_validation_id, 'external_validation', 'External validation', 'text', false, 2),
    (model_validation_id, 'model_adjusted', 'Model adjusted after poor validation?', 'boolean', false, 3);

  RAISE NOTICE '================================';
  RAISE NOTICE 'CHARMS v2.0 criado com sucesso!';
  RAISE NOTICE 'Template ID: %', charms_v2_id;
  RAISE NOTICE 'Study-level entities: 5';
  RAISE NOTICE 'Model-level parent: 1 (prediction_models)';
  RAISE NOTICE 'Model-level children: 5';
  RAISE NOTICE '================================';
  RAISE NOTICE 'CHARMS v1.0 mantido intacto com 177 instances preservadas';
  RAISE NOTICE 'Novos projetos podem importar CHARMS v2.0';
  RAISE NOTICE '================================';
  
END $$;


