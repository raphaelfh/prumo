# CHARMS 2.0 - Template Completo

**Template ID**: Criado via migration `0017_charms_2_0_complete_template.sql`  
**Version**: 2.0.0  
**Status**: ✅ Implementado no banco de dados  
**Framework**: CHARMS

## Estrutura Hierárquica

**TODOS os campos são específicos por modelo preditivo**, não compartilhados entre modelos. Cada modelo tem suas próprias seções e campos.

### Hierarquia

```
prediction_models (ROOT - cardinality='many')
│
├─ source_of_data (cardinality='one')
├─ participants (cardinality='one')
├─ outcome_to_be_predicted (cardinality='one')
├─ candidate_predictors (cardinality='one')
├─ sample_size (cardinality='one')
├─ missing_data (cardinality='one')
├─ model_development (cardinality='one')
├─ final_predictors (cardinality='many')
├─ model_performance (cardinality='one')
├─ model_validation (cardinality='one')
├─ model_results (cardinality='one')
├─ model_interpretation (cardinality='one')
└─ model_observations (cardinality='one')
```

**Total**: 1 ROOT + 14 CHILDREN = 15 entity types

## Mapeamento CHARMS → Entity Types → Fields

### 0.5 Model Name
- **Entity Type**: `prediction_models`
- **Field**: `model_name` (text)

### 1. Source of Data

**Entity Type**: `source_of_data`

- **1.1** `data_source` (select)
  - Valores: ["Prospective cohort", "Retrospective cohort", "Case-control", "Case series", "Other (specify)"]
  - Campo condicional: `data_source_other_specify` (text) - obrigatório quando "Other (specify)" selecionado

### 2. Participants

**Entity Type**: `participants`

- **2.1** `recruitment_method` (select)
  - Valores: ["Consecutive patients", "Random sampling", "Convenience sampling", "Stratified sampling", "Other (specify)", "No information"]
  - Campo condicional: `recruitment_method_other_specify` (text)
- **2.2** `recruitment_dates` (text)
- **2.3** `study_setting` (text)
- **2.4** `study_sites_regions` (text)
- **2.5** `study_sites_number` (number, unit: centers)
- **2.6** `inclusion_criteria` (text)
- **2.7** `exclusion_criteria` (text)
- **2.8.1** `age_of_participants` (text)
- **2.8.2** `native_valve_endocarditis` (text)
- **2.8.3** `valve_affected` (text)
- **2.8.4** `characteristic_4` (text)
- **2.8.5** `characteristic_5` (text)

### 3. Outcome to be Predicted

**Entity Type**: `outcome_to_be_predicted`

- **3.1** `outcome` (text)
- **3.2** `outcome_definition` (text)
- **3.3** `same_outcome_definition` (select)
  - Valores: ["Yes", "No", "Unclear", "No information"]
- **3.4** `type_of_outcome` (select)
  - Valores: ["Single", "Composite", "Time-to-event"]
- **3.5** `outcome_assessed_blinded` (select)
  - Valores: ["Yes", "No", "Unclear", "No information"]
- **3.6** `predictors_part_of_outcome` (select)
  - Valores: ["Yes", "No", "Unclear", "No information"]
- **3.7** `time_of_outcome` (text)

### 4. Candidate Predictors

**Entity Type**: `candidate_predictors`

- **4.1** `number_of_candidates` (number, unit: predictors)
- **4.2** `type_of_predictors` (text)
- **4.3** `timing_of_measurement` (select)
  - Valores: ["Pre-operative", "Post-operative", "At baseline", "During follow-up", "Other (specify)", "No information"]
  - Campo condicional: `timing_of_measurement_other_specify` (text)
- **4.4** `predictors_definition_similar` (select)
  - Valores: ["Yes", "No", "Unclear", "No information"]
- **4.5** `predictors_assessed_blinded` (select)
  - Valores: ["Yes", "No", "Unclear", "No information"]
- **4.6** `handling_continuous` (select)
  - Valores: ["Kept continuous", "Categorized", "Restricted cubic spline function", "Other (specify)", "No information"]
  - Campo condicional: `handling_continuous_other_specify` (text)

### 5. Sample Size

**Entity Type**: `sample_size`

- **5.1** `number_of_participants` (number, unit: participants)
- **5.2** `number_of_events` (number, unit: events)
- **5.3** `epv_epp` (number, unit: events/variable)

### 6. Missing Data

**Entity Type**: `missing_data`

- **6.1** `participants_with_missing` (text)
- **6.2** `handling_of_missing` (select)
  - Valores: ["Complete case analysis", "Multiple imputation", "Single imputation", "Other (specify)", "No information"]
  - Campo condicional: `handling_of_missing_other_specify` (text)

### 7. Model Development

**Entity Type**: `model_development`

- **7.1** `modelling_method` (select) - também em `prediction_models`
  - Valores: ["Logistic regression", "Cox regression", "Linear regression", "Poisson regression", "Other (specify)"]
  - Campo condicional: `modelling_method_other_specify` (text)
- **7.2** `selection_method_candidates` (select)
  - Valores: ["Based on univariable associations", "Based on literature", "All candidates", "Clinical expertise", "Other (specify)", "No information"]
  - Campo condicional: `selection_method_candidates_other_specify` (text)
- **7.3** `selection_method_multivariable` (select)
  - Valores: ["Backward elimination", "Forward selection", "Stepwise", "LASSO", "Ridge regression", "Elastic net", "Best subset", "Other (specify)", "No information"]
  - Campo condicional: `selection_method_multivariable_other_specify` (text)
- **7.4** `shrinkage` (select)
  - Valores: ["Yes", "No", "No information"]

### 8. Model Performance

**Entity Type**: `model_performance`

#### 8.1 Calibration Measures

- **8.1.1** `calibration_plot` (select)
  - Valores: ["Yes", "No", "No information"]
- **8.1.2** `calibration_slope` (select)
  - Valores: ["Yes", "No", "No information"]
  - Campos: `calibration_slope_value` (number) + `calibration_slope_ci` (text)
- **8.1.3** `calibration_in_large` (select)
  - Valores: ["Yes", "No", "No information"]
  - Campos: `calibration_in_large_value` (number) + `calibration_in_large_ci` (text)
- **8.1.4** `hosmer_lemeshow` (select)
  - Valores: ["Yes", "No", "No information"]
  - Campo: `hosmer_lemeshow_p_value` (text)
- **8.1.5** `calibration_other` (select)
  - Valores: ["Yes", "No", "No information"]
  - Campo condicional: `calibration_other_specify` (text)

#### 8.2 Discrimination Measures

- **8.2.1** `c_statistic` (select)
  - Valores: ["Yes", "No", "No information"]
  - Campos: `c_statistic_value` (number) + `c_statistic_ci` (text)
- **8.2.2** `d_statistic` (select)
  - Valores: ["Yes", "No", "No information"]
  - Campos: `d_statistic_value` (number) + `d_statistic_ci` (text)
- **8.2.3** `auc_graph` (select)
  - Valores: ["Yes", "No", "No information"]
- **8.2.4** `log_rank_test` (select)
  - Valores: ["Yes", "No", "Not applicable", "No information"]
  - Campo: `log_rank_test_p_value` (text)
- **8.2.5** `risk_group_curves` (select)
  - Valores: ["Yes", "No", "Not applicable", "No information"]
- **8.2.6** `discrimination_other` (select)
  - Valores: ["Yes", "No", "No information"]
  - Campo condicional: `discrimination_other_specify` (text)

#### 8.3 Overall Measures

- **8.3.1** `r_squared` (select)
  - Valores: ["Yes", "No", "Not evaluated", "No information"]
  - Campos: `r_squared_value` (number) + `r_squared_ci` (text) + `r_squared_type` (text)
- **8.3.2** `brier_score` (select)
  - Valores: ["Yes", "No", "Not evaluated", "No information"]
  - Campos: `brier_score_value` (number) + `brier_score_ci` (text)
- **8.3.3** `overall_other` (select)
  - Valores: ["Yes", "No", "No information"]
  - Campo condicional: `overall_other_specify` (text)

#### 8.4 Clinical Utility

- **8.4.1** `dca` (select)
  - Valores: ["Yes", "No", "Not evaluated", "No information"]
- **8.4.2** `clinical_utility_other` (select)
  - Valores: ["Yes", "No", "No information"]
  - Campo condicional: `clinical_utility_other_specify` (text)

### 9. Model Validation

**Entity Type**: `model_validation`

- **9.1.1** `internal_validation` (select)
  - Valores: ["Bootstrap", "Cross-validation", "Split-sample", "Other (specify)", "None", "No information"]
  - Campo condicional: `internal_validation_other_specify` (text)
- **9.1.2** `external_validation` (select)
  - Valores: ["Geographical", "Temporal", "Different population", "Other (specify)", "None", "No information"]
  - Campo condicional: `external_validation_other_specify` (text)
- **9.2** `model_adjusted` (select)
  - Valores: ["Yes", "No", "No information"]

### 10. Results

**Entity Type**: `model_results`

- **10.1** `number_of_predictors` (number, unit: predictors)
- **10.2** `predictor_weights_or_coefficients` (select)
  - Valores: ["Predictor weights", "Regression coefficients", "Both", "No information"]
- **10.3** `intercept_included` (select)
  - Valores: ["Yes", "No", "No information"]
- **10.4** `alternative_presentation` (select)
  - Valores: ["Score system", "Nomogram", "Web calculator", "Mobile app", "Other (specify)", "None", "No information"]
  - Campo condicional: `alternative_presentation_other_specify` (text)

### 11. Interpretation

**Entity Type**: `model_interpretation`

- **11.1** `interpretation` (text) - texto longo

### 12. Observations

**Entity Type**: `model_observations`

- **12.1** `data_extraction_process` (select)
  - Valores: ["All information has been successfully registered", "Some information missing", "Extraction incomplete"]
- **12.2** `additional_information` (text)

## Final Predictors (Múltiplos)

**Entity Type**: `final_predictors` (cardinality='many')

- `predictor_name` (text)
- `predictor_weight` (text)

## Decisões de Design

### 1. Participant Description (2.8.1-2.8.5)
✅ **Escolhido**: Campos diretos em `participants` (não sub-entidade)
- Simplifica queries e mantém estrutura plana

### 2. Campos com Confidence Interval (CI)
✅ **Escolhido**: Dois campos separados
- `value` (number) + `*_ci` (text)
- Exemplo: `c_statistic` (number) + `c_statistic_ci` (text como "0.64 to 0.78")
- Mais flexível para diferentes formatos de CI

### 3. Campos "Other" com Especificação
✅ **Escolhido**: Abordagem híbrida com `validation_schema`
- Campo principal: select com "Other (specify)" em `allowed_values`
- Campo especificação: text com `validation_schema` definindo dependência condicional
- Estrutura no `validation_schema`:
  ```json
  {
    "conditional_required": {
      "depends_on": "field_name",
      "required_when": "Other (specify)"
    }
  }
  ```
- Frontend renderiza campo `*_other_specify` condicionalmente quando "Other" selecionado

## Exemplo de Uso

### Criação de Instances para um Artigo com 2 Modelos

```sql
-- Artigo: "Gatti et al., 2017"

-- Model A: "AEPEI score"
INSERT INTO extraction_instances (article_id, template_id, entity_type_id, label, parent_instance_id)
VALUES (article_id, template_id, prediction_models_id, 'AEPEI score', NULL)
RETURNING id INTO model_a_id;

-- Children automáticos (cardinality='one') criados via extractionInstanceService.createHierarchy()
-- source_of_data, participants, outcome, candidate_predictors, sample_size, missing_data,
-- model_development, model_performance, model_validation, model_results, 
-- model_interpretation, model_observations

-- Final predictors (cardinality='many') - criados manualmente
INSERT INTO extraction_instances (article_id, template_id, entity_type_id, label, parent_instance_id)
VALUES 
  (article_id, template_id, final_predictors_id, 'Age', model_a_id),
  (article_id, template_id, final_predictors_id, 'Gender', model_a_id),
  (article_id, template_id, final_predictors_id, 'Vegetation size', model_a_id);

-- Model B: "Alternate AEPEI score"
INSERT INTO extraction_instances (article_id, template_id, entity_type_id, label, parent_instance_id)
VALUES (article_id, template_id, prediction_models_id, 'Alternate AEPEI score', NULL)
RETURNING id INTO model_b_id;

-- Children criados automaticamente...
```

## Queries Úteis

### Buscar todos os modelos de um artigo
```sql
SELECT id, label 
FROM extraction_instances
WHERE article_id = '<article_id>'
  AND entity_type_id = (
    SELECT id FROM extraction_entity_types 
    WHERE name = 'prediction_models'
    AND template_id = (SELECT id FROM extraction_templates_global WHERE name = 'CHARMS 2.0')
  );
```

### Buscar children de um modelo
```sql
SELECT et.name, et.label, ei.id, ei.label
FROM extraction_instances ei
JOIN extraction_entity_types et ON et.id = ei.entity_type_id
WHERE ei.parent_instance_id = '<model_id>'
ORDER BY et.sort_order, ei.sort_order;
```

### Buscar valores extraídos de um modelo
```sql
SELECT f.name, f.label, ev.value
FROM extracted_values ev
JOIN extraction_fields f ON f.id = ev.field_id
JOIN extraction_instances ei ON ei.id = ev.instance_id
WHERE ei.id IN (
  SELECT id FROM extraction_instances
  WHERE parent_instance_id = '<model_id>' OR id = '<model_id>'
)
ORDER BY f.sort_order;
```

## Estatísticas

- **Entity Types**: 15 (1 root + 14 children)
- **Fields**: ~80+ campos
- **Campos com CI**: 10+ (c_statistic, brier_score, calibration_slope, etc.)
- **Campos com "Other"**: 10+ (com campos condicionais `*_other_specify`)
- **Campos booleanos/select**: 30+
- **Campos text**: 40+

## Referências

- [CHARMS Checklist Original](https://journals.plos.org/plosmedicine/article/file?id=10.1371/journal.pmed.1001744&type=printable)
- [CHARMS 2023 Update](https://bmcmedresmethodol.biomedcentral.com/articles/10.1186/s12874-023-01849-0)


