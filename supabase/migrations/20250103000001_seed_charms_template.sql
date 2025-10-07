-- =====================================================
-- SEED: Template CHARMS Padrão
-- =====================================================
-- Descrição: Insere o template CHARMS como template global padrão
-- com todas as entidades e campos necessários
-- 
-- ROLLBACK: DELETE FROM extraction_entity_types WHERE template_id = (SELECT id FROM extraction_templates WHERE name = 'CHARMS');
--           DELETE FROM extraction_templates WHERE name = 'CHARMS';
-- =====================================================

-- =================== TEMPLATE CHARMS ===================
INSERT INTO extraction_templates (
  name,
  description,
  framework,
  version,
  is_global,
  schema
) VALUES (
  'CHARMS',
  'Checklist for critical Appraisal and data extraction for systematic Reviews of prediction Modelling Studies',
  'CHARMS',
  '1.0.0',
  true,
  '{
    "description": "Template para estudos de modelos preditivos seguindo o framework CHARMS",
    "domains": [
      {
        "name": "source_of_data",
        "label": "Fonte dos Dados",
        "description": "Informações sobre a origem dos dados utilizados"
      },
      {
        "name": "participants",
        "label": "Participantes", 
        "description": "Características da população estudada"
      },
      {
        "name": "outcome_to_be_predicted",
        "label": "Desfecho a ser Predito",
        "description": "Definição e características do desfecho"
      },
      {
        "name": "predictors",
        "label": "Preditores",
        "description": "Variáveis preditoras incluídas no modelo"
      },
      {
        "name": "sample_size",
        "label": "Tamanho da Amostra",
        "description": "Informações sobre o tamanho e poder da amostra"
      },
      {
        "name": "missing_data",
        "label": "Dados Perdidos",
        "description": "Tratamento de valores ausentes"
      },
      {
        "name": "statistical_analysis_methods",
        "label": "Métodos de Análise Estatística",
        "description": "Técnicas estatísticas utilizadas"
      },
      {
        "name": "risk_of_bias",
        "label": "Risco de Viés",
        "description": "Avaliação da qualidade metodológica"
      },
      {
        "name": "results",
        "label": "Resultados",
        "description": "Principais achados do estudo"
      },
      {
        "name": "discussion",
        "label": "Discussão",
        "description": "Interpretação e limitações dos resultados"
      }
    ]
  }'::jsonb
);

-- Obter o ID do template CHARMS
DO $$
DECLARE
  charms_template_id UUID;
BEGIN
  SELECT id INTO charms_template_id FROM extraction_templates WHERE name = 'CHARMS';
  
  -- =================== ENTIDADES CHARMS ===================
  
  -- Source of Data
  INSERT INTO extraction_entity_types (template_id, name, label, description, cardinality, sort_order, is_required) VALUES
  (charms_template_id, 'source_of_data', 'Fonte dos Dados', 'Informações sobre a origem dos dados utilizados no estudo', 'one', 1, true);
  
  -- Participants
  INSERT INTO extraction_entity_types (template_id, name, label, description, cardinality, sort_order, is_required) VALUES
  (charms_template_id, 'participants', 'Participantes', 'Características da população estudada', 'one', 2, true);
  
  -- Outcome to be Predicted
  INSERT INTO extraction_entity_types (template_id, name, label, description, cardinality, sort_order, is_required) VALUES
  (charms_template_id, 'outcome_to_be_predicted', 'Desfecho a ser Predito', 'Definição e características do desfecho principal', 'one', 3, true);
  
  -- Predictors
  INSERT INTO extraction_entity_types (template_id, name, label, description, cardinality, sort_order, is_required) VALUES
  (charms_template_id, 'predictors', 'Preditores', 'Variáveis preditoras incluídas no modelo', 'many', 4, true);
  
  -- Sample Size
  INSERT INTO extraction_entity_types (template_id, name, label, description, cardinality, sort_order, is_required) VALUES
  (charms_template_id, 'sample_size', 'Tamanho da Amostra', 'Informações sobre o tamanho e poder da amostra', 'one', 5, true);
  
  -- Missing Data
  INSERT INTO extraction_entity_types (template_id, name, label, description, cardinality, sort_order, is_required) VALUES
  (charms_template_id, 'missing_data', 'Dados Perdidos', 'Tratamento de valores ausentes no estudo', 'one', 6, false);
  
  -- Statistical Analysis Methods
  INSERT INTO extraction_entity_types (template_id, name, label, description, cardinality, sort_order, is_required) VALUES
  (charms_template_id, 'statistical_analysis_methods', 'Métodos de Análise Estatística', 'Técnicas estatísticas utilizadas na modelagem', 'one', 7, true);
  
  -- Risk of Bias
  INSERT INTO extraction_entity_types (template_id, name, label, description, cardinality, sort_order, is_required) VALUES
  (charms_template_id, 'risk_of_bias', 'Risco de Viés', 'Avaliação da qualidade metodológica do estudo', 'one', 8, true);
  
  -- Results
  INSERT INTO extraction_entity_types (template_id, name, label, description, cardinality, sort_order, is_required) VALUES
  (charms_template_id, 'results', 'Resultados', 'Principais achados e métricas de performance do modelo', 'many', 9, true);
  
  -- Discussion
  INSERT INTO extraction_entity_types (template_id, name, label, description, cardinality, sort_order, is_required) VALUES
  (charms_template_id, 'discussion', 'Discussão', 'Interpretação dos resultados e limitações do estudo', 'one', 10, false);

END $$;

-- =================== CAMPOS PARA CADA ENTIDADE ===================

DO $$
DECLARE
  charms_template_id UUID;
  entity_type_id UUID;
BEGIN
  SELECT id INTO charms_template_id FROM extraction_templates WHERE name = 'CHARMS';
  
  -- =================== CAMPOS: SOURCE OF DATA ===================
  SELECT id INTO entity_type_id FROM extraction_entity_types WHERE template_id = charms_template_id AND name = 'source_of_data';
  
  INSERT INTO extraction_fields (entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values) VALUES
  (entity_type_id, 'data_source', 'Fonte dos Dados', 'Origem dos dados (coorte, registro, ensaio clínico, etc.)', 'select', true, 1, '["Coorte prospectiva", "Coorte retrospectiva", "Registro médico", "Ensaio clínico", "Banco de dados administrativo", "Outro"]'::jsonb),
  (entity_type_id, 'data_collection_period', 'Período de Coleta', 'Período em que os dados foram coletados', 'date', true, 2, NULL),
  (entity_type_id, 'geographic_location', 'Localização Geográfica', 'País ou região onde o estudo foi conduzido', 'text', true, 3, NULL),
  (entity_type_id, 'data_availability', 'Disponibilidade dos Dados', 'Se os dados estão disponíveis para outros pesquisadores', 'select', false, 4, '["Sim, disponível", "Não, não disponível", "Sob solicitação", "Não informado"]'::jsonb),
  (entity_type_id, 'ethics_approval', 'Aprovação Ética', 'Se o estudo teve aprovação de comitê de ética', 'boolean', false, 5, NULL);
  
  -- =================== CAMPOS: PARTICIPANTS ===================
  SELECT id INTO entity_type_id FROM extraction_entity_types WHERE template_id = charms_template_id AND name = 'participants';
  
  INSERT INTO extraction_fields (entity_type_id, name, label, description, field_type, is_required, sort_order) VALUES
  (entity_type_id, 'inclusion_criteria', 'Critérios de Inclusão', 'Critérios para inclusão de participantes no estudo', 'text', true, 1),
  (entity_type_id, 'exclusion_criteria', 'Critérios de Exclusão', 'Critérios para exclusão de participantes do estudo', 'text', true, 2),
  (entity_type_id, 'age_range', 'Faixa Etária', 'Faixa de idade dos participantes (anos)', 'text', true, 3),
  (entity_type_id, 'gender_distribution', 'Distribuição por Sexo', 'Proporção de homens e mulheres', 'text', true, 4),
  (entity_type_id, 'baseline_characteristics', 'Características Basais', 'Principais características demográficas e clínicas', 'text', true, 5);
  
  -- =================== CAMPOS: OUTCOME TO BE PREDICTED ===================
  SELECT id INTO entity_type_id FROM extraction_entity_types WHERE template_id = charms_template_id AND name = 'outcome_to_be_predicted';
  
  INSERT INTO extraction_fields (entity_type_id, name, label, description, field_type, is_required, sort_order, allowed_values, unit) VALUES
  (entity_type_id, 'outcome_definition', 'Definição do Desfecho', 'Definição clara e operacional do desfecho', 'text', true, 1, NULL, NULL),
  (entity_type_id, 'outcome_type', 'Tipo de Desfecho', 'Classificação do tipo de desfecho', 'select', true, 2, '["Binário (sim/não)", "Contínuo", "Categórico", "Sobrevida", "Outro"]'::jsonb, NULL),
  (entity_type_id, 'measurement_method', 'Método de Medição', 'Como o desfecho foi medido ou determinado', 'text', true, 3, NULL, NULL),
  (entity_type_id, 'follow_up_period', 'Período de Seguimento', 'Tempo de seguimento para o desfecho', 'text', true, 4, NULL, NULL),
  (entity_type_id, 'outcome_frequency', 'Frequência do Desfecho', 'Proporção de participantes com o desfecho', 'number', true, 5, NULL, '%');
  
  -- =================== CAMPOS: PREDICTORS ===================
  SELECT id INTO entity_type_id FROM extraction_entity_types WHERE template_id = charms_template_id AND name = 'predictors';
  
  INSERT INTO extraction_fields (entity_type_id, name, label, description, field_type, is_required, sort_order) VALUES
  (entity_type_id, 'predictor_name', 'Nome do Preditor', 'Nome ou descrição da variável preditora', 'text', true, 1),
  (entity_type_id, 'predictor_type', 'Tipo do Preditor', 'Classificação do tipo de preditor', 'select', true, 2),
  (entity_type_id, 'measurement_method', 'Método de Medição', 'Como o preditor foi medido', 'text', true, 3),
  (entity_type_id, 'timing_of_measurement', 'Momento da Medição', 'Quando o preditor foi medido em relação ao desfecho', 'select', true, 4),
  (entity_type_id, 'missing_data_handling', 'Tratamento de Dados Ausentes', 'Como dados ausentes foram tratados', 'text', false, 5);
  
  UPDATE extraction_fields SET allowed_values = '["Demográfico", "Clínico", "Laboratorial", "Imagem", "Genético", "Outro"]'::jsonb 
  WHERE entity_type_id = entity_type_id AND name = 'predictor_type';
  
  UPDATE extraction_fields SET allowed_values = '["No momento do diagnóstico", "Pré-tratamento", "Durante o tratamento", "Pós-tratamento", "Outro"]'::jsonb 
  WHERE entity_type_id = entity_type_id AND name = 'timing_of_measurement';
  
  -- =================== CAMPOS: SAMPLE SIZE ===================
  SELECT id INTO entity_type_id FROM extraction_entity_types WHERE template_id = charms_template_id AND name = 'sample_size';
  
  INSERT INTO extraction_fields (entity_type_id, name, label, description, field_type, is_required, sort_order) VALUES
  (entity_type_id, 'total_sample_size', 'Tamanho Total da Amostra', 'Número total de participantes incluídos', 'number', true, 1),
  (entity_type_id, 'events_count', 'Número de Eventos', 'Número de participantes com o desfecho', 'number', true, 2),
  (entity_type_id, 'sample_size_justification', 'Justificativa do Tamanho', 'Justificativa para o tamanho da amostra', 'text', false, 3),
  (entity_type_id, 'power_calculation', 'Cálculo de Poder', 'Se foi realizado cálculo de poder estatístico', 'boolean', false, 4),
  (entity_type_id, 'events_per_predictor', 'Eventos por Preditor', 'Razão entre eventos e número de preditores', 'number', false, 5);
  
  UPDATE extraction_fields SET unit = 'participantes' 
  WHERE entity_type_id = entity_type_id AND name = 'total_sample_size';
  
  UPDATE extraction_fields SET unit = 'eventos' 
  WHERE entity_type_id = entity_type_id AND name = 'events_count';
  
  -- =================== CAMPOS: MISSING DATA ===================
  SELECT id INTO entity_type_id FROM extraction_entity_types WHERE template_id = charms_template_id AND name = 'missing_data';
  
  INSERT INTO extraction_fields (entity_type_id, name, label, description, field_type, is_required, sort_order) VALUES
  (entity_type_id, 'missing_data_reported', 'Dados Ausentes Relatados', 'Se dados ausentes foram explicitamente relatados', 'boolean', false, 1),
  (entity_type_id, 'missing_data_percentage', 'Percentual de Dados Ausentes', 'Percentual de valores ausentes', 'number', false, 2),
  (entity_type_id, 'handling_method', 'Método de Tratamento', 'Método usado para tratar dados ausentes', 'select', false, 3),
  (entity_type_id, 'sensitivity_analysis', 'Análise de Sensibilidade', 'Se foi realizada análise de sensibilidade', 'boolean', false, 4);
  
  UPDATE extraction_fields SET unit = '%' 
  WHERE entity_type_id = entity_type_id AND name = 'missing_data_percentage';
  
  UPDATE extraction_fields SET allowed_values = '["Exclusão de casos", "Imputação simples", "Imputação múltipla", "Modelos para dados ausentes", "Não especificado"]'::jsonb 
  WHERE entity_type_id = entity_type_id AND name = 'handling_method';
  
  -- =================== CAMPOS: STATISTICAL ANALYSIS ===================
  SELECT id INTO entity_type_id FROM extraction_entity_types WHERE template_id = charms_template_id AND name = 'statistical_analysis_methods';
  
  INSERT INTO extraction_fields (entity_type_id, name, label, description, field_type, is_required, sort_order) VALUES
  (entity_type_id, 'model_development', 'Desenvolvimento do Modelo', 'Método usado para desenvolver o modelo', 'select', true, 1),
  (entity_type_id, 'variable_selection', 'Seleção de Variáveis', 'Método para seleção de variáveis', 'select', true, 2),
  (entity_type_id, 'model_validation', 'Validação do Modelo', 'Método de validação utilizado', 'select', true, 3),
  (entity_type_id, 'statistical_software', 'Software Estatístico', 'Software usado para as análises', 'text', false, 4),
  (entity_type_id, 'significance_level', 'Nível de Significância', 'Nível de significância utilizado', 'number', false, 5);
  
  UPDATE extraction_fields SET allowed_values = '["Regressão logística", "Regressão de Cox", "Machine Learning", "Outro"]'::jsonb 
  WHERE entity_type_id = entity_type_id AND name = 'model_development';
  
  UPDATE extraction_fields SET allowed_values = '["Seleção manual", "Stepwise", "Lasso", "Ridge", "Random Forest", "Outro"]'::jsonb 
  WHERE entity_type_id = entity_type_id AND name = 'variable_selection';
  
  UPDATE extraction_fields SET allowed_values = '["Validação interna", "Validação externa", "Validação cruzada", "Bootstrap", "Não realizada"]'::jsonb 
  WHERE entity_type_id = entity_type_id AND name = 'model_validation';
  
  UPDATE extraction_fields SET unit = 'α' 
  WHERE entity_type_id = entity_type_id AND name = 'significance_level';
  
  -- =================== CAMPOS: RISK OF BIAS ===================
  SELECT id INTO entity_type_id FROM extraction_entity_types WHERE template_id = charms_template_id AND name = 'risk_of_bias';
  
  INSERT INTO extraction_fields (entity_type_id, name, label, description, field_type, is_required, sort_order) VALUES
  (entity_type_id, 'participant_selection', 'Seleção de Participantes', 'Avaliação do risco de viés na seleção', 'select', true, 1),
  (entity_type_id, 'predictors_measurement', 'Medição dos Preditores', 'Avaliação do risco de viés na medição', 'select', true, 2),
  (entity_type_id, 'outcome_measurement', 'Medição do Desfecho', 'Avaliação do risco de viés na medição do desfecho', 'select', true, 3),
  (entity_type_id, 'missing_data_bias', 'Viés por Dados Ausentes', 'Avaliação do risco de viés por dados ausentes', 'select', true, 4),
  (entity_type_id, 'analysis_bias', 'Viés na Análise', 'Avaliação do risco de viés na análise', 'select', true, 5);
  
  UPDATE extraction_fields SET allowed_values = '["Baixo", "Moderado", "Alto", "Crítico", "Não informado"]'::jsonb 
  WHERE entity_type_id = entity_type_id AND name IN ('participant_selection', 'predictors_measurement', 'outcome_measurement', 'missing_data_bias', 'analysis_bias');
  
  -- =================== CAMPOS: RESULTS ===================
  SELECT id INTO entity_type_id FROM extraction_entity_types WHERE template_id = charms_template_id AND name = 'results';
  
  INSERT INTO extraction_fields (entity_type_id, name, label, description, field_type, is_required, sort_order) VALUES
  (entity_type_id, 'metric_name', 'Nome da Métrica', 'Nome da métrica de performance (ex: AUC, sensibilidade)', 'select', true, 1),
  (entity_type_id, 'metric_value', 'Valor da Métrica', 'Valor numérico da métrica', 'number', true, 2),
  (entity_type_id, 'confidence_interval', 'Intervalo de Confiança', 'Intervalo de confiança da métrica', 'text', false, 3),
  (entity_type_id, 'validation_type', 'Tipo de Validação', 'Contexto da validação (desenvolvimento, validação, etc.)', 'select', true, 4),
  (entity_type_id, 'sample_size_for_metric', 'Tamanho da Amostra', 'Tamanho da amostra usada para calcular a métrica', 'number', false, 5);
  
  UPDATE extraction_fields SET allowed_values = '["AUC/ROC", "Sensibilidade", "Especificidade", "Valor Preditivo Positivo", "Valor Preditivo Negativo", "C-index", "R²", "Outro"]'::jsonb 
  WHERE entity_type_id = entity_type_id AND name = 'metric_name';
  
  UPDATE extraction_fields SET allowed_values = '["Desenvolvimento", "Validação interna", "Validação externa", "Validação cruzada"]'::jsonb 
  WHERE entity_type_id = entity_type_id AND name = 'validation_type';
  
  UPDATE extraction_fields SET unit = 'participantes' 
  WHERE entity_type_id = entity_type_id AND name = 'sample_size_for_metric';
  
  -- =================== CAMPOS: DISCUSSION ===================
  SELECT id INTO entity_type_id FROM extraction_entity_types WHERE template_id = charms_template_id AND name = 'discussion';
  
  INSERT INTO extraction_fields (entity_type_id, name, label, description, field_type, is_required, sort_order) VALUES
  (entity_type_id, 'key_findings', 'Principais Achados', 'Principais resultados e implicações', 'text', false, 1),
  (entity_type_id, 'limitations', 'Limitações', 'Principais limitações do estudo', 'text', false, 2),
  (entity_type_id, 'generalizability', 'Generalizabilidade', 'Aplicabilidade dos resultados a outras populações', 'text', false, 3),
  (entity_type_id, 'clinical_utility', 'Utilidade Clínica', 'Potencial utilidade clínica do modelo', 'text', false, 4),
  (entity_type_id, 'future_research', 'Pesquisas Futuras', 'Sugestões para pesquisas futuras', 'text', false, 5);

END $$;

-- =================== VERIFICAÇÃO ===================
DO $$
DECLARE
  template_count INTEGER;
  entity_count INTEGER;
  field_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO template_count FROM extraction_templates WHERE name = 'CHARMS';
  SELECT COUNT(*) INTO entity_count FROM extraction_entity_types WHERE template_id = (SELECT id FROM extraction_templates WHERE name = 'CHARMS');
  SELECT COUNT(*) INTO field_count FROM extraction_fields WHERE entity_type_id IN (
    SELECT id FROM extraction_entity_types WHERE template_id = (SELECT id FROM extraction_templates WHERE name = 'CHARMS')
  );
  
  RAISE NOTICE 'Template CHARMS criado com sucesso:';
  RAISE NOTICE '- Templates: %', template_count;
  RAISE NOTICE '- Entidades: %', entity_count;
  RAISE NOTICE '- Campos: %', field_count;
END $$;
