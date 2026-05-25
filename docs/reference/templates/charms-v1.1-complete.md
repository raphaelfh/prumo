---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
template_version: '1.1.0'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh
> Reflects the CHARMS template state after the 2026-05-17 study-level / per-model split (template version 1.1.0).

# CHARMS v1.1 — Complete Template

**Template ID**: Created via migration `0017_charms_2_0_complete_template.sql`  
**Version**: 1.1.0  
**Status**: Applied in the database  
**Framework**: CHARMS

## Hierarchical structure

The CHARMS v1.1 template has 7 study-level entity types at the root plus
the per-model `prediction_models` container. For the full visual tree,
see [`charms-v1.1-hierarchy.md`](./charms-v1.1-hierarchy.md).

## CHARMS → Entity Types → Fields mapping

### 0.5 Model Name

- **Entity Type**: `prediction_models`
- **Field**: `model_name` (text)

### 1. Source of Data

**Entity Type**: `source_of_data`

- **1.1** `data_source` (select)
  - Values: ["Prospective cohort", "Retrospective cohort", "Case-control", "Case series", "Other (specify)"]
  - Conditional field: `data_source_other_specify` (text) — required when "Other (specify)" is selected

### 2. Participants

**Entity Type**: `participants`

- **2.1** `recruitment_method` (select)
  - Values: ["Consecutive patients", "Random sampling", "Convenience sampling", "Stratified sampling", "Other (specify)", "No information"]
  - Conditional field: `recruitment_method_other_specify` (text)
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
  - Values: ["Yes", "No", "Unclear", "No information"]
- **3.4** `type_of_outcome` (select)
  - Values: ["Single", "Composite", "Time-to-event"]
- **3.5** `outcome_assessed_blinded` (select)
  - Values: ["Yes", "No", "Unclear", "No information"]
- **3.6** `predictors_part_of_outcome` (select)
  - Values: ["Yes", "No", "Unclear", "No information"]
- **3.7** `time_of_outcome` (text)

### 4. Candidate Predictors

**Entity Type**: `candidate_predictors`

- **4.1** `number_of_candidates` (number, unit: predictors)
- **4.2** `type_of_predictors` (text)
- **4.3** `timing_of_measurement` (select)
  - Values: ["Pre-operative", "Post-operative", "At baseline", "During follow-up", "Other (specify)", "No information"]
  - Conditional field: `timing_of_measurement_other_specify` (text)
- **4.4** `predictors_definition_similar` (select)
  - Values: ["Yes", "No", "Unclear", "No information"]
- **4.5** `predictors_assessed_blinded` (select)
  - Values: ["Yes", "No", "Unclear", "No information"]
- **4.6** `handling_continuous` (select)
  - Values: ["Kept continuous", "Categorized", "Restricted cubic spline function", "Other (specify)", "No information"]
  - Conditional field: `handling_continuous_other_specify` (text)

### 5. Sample Size

**Entity Type**: `sample_size`

- **5.1** `number_of_participants` (number, unit: participants)
- **5.2** `number_of_events` (number, unit: events)
- **5.3** `epv_epp` (number, unit: events/variable)

### 6. Missing Data

**Entity Type**: `missing_data`

- **6.1** `participants_with_missing` (text)
- **6.2** `handling_of_missing` (select)
  - Values: ["Complete case analysis", "Multiple imputation", "Single imputation", "Other (specify)", "No information"]
  - Conditional field: `handling_of_missing_other_specify` (text)

### 7. Model Development

**Entity Type**: `model_development`

- **7.1** `modelling_method` (select) — also in `prediction_models`
  - Values: ["Logistic regression", "Cox regression", "Linear regression", "Poisson regression", "Other (specify)"]
  - Conditional field: `modelling_method_other_specify` (text)
- **7.2** `selection_method_candidates` (select)
  - Values: ["Based on univariable associations", "Based on literature", "All candidates", "Clinical expertise", "Other (specify)", "No information"]
  - Conditional field: `selection_method_candidates_other_specify` (text)
- **7.3** `selection_method_multivariable` (select)
  - Values: ["Backward elimination", "Forward selection", "Stepwise", "LASSO", "Ridge regression", "Elastic net", "Best subset", "Other (specify)", "No information"]
  - Conditional field: `selection_method_multivariable_other_specify` (text)
- **7.4** `shrinkage` (select)
  - Values: ["Yes", "No", "No information"]

### 8. Model Performance

**Entity Type**: `model_performance`

#### 8.1 Calibration Measures

- **8.1.1** `calibration_plot` (select)
  - Values: ["Yes", "No", "No information"]
- **8.1.2** `calibration_slope` (select)
  - Values: ["Yes", "No", "No information"]
  - Fields: `calibration_slope_value` (number) + `calibration_slope_ci` (text)
- **8.1.3** `calibration_in_large` (select)
  - Values: ["Yes", "No", "No information"]
  - Fields: `calibration_in_large_value` (number) + `calibration_in_large_ci` (text)
- **8.1.4** `hosmer_lemeshow` (select)
  - Values: ["Yes", "No", "No information"]
  - Field: `hosmer_lemeshow_p_value` (text)
- **8.1.5** `calibration_other` (select)
  - Values: ["Yes", "No", "No information"]
  - Conditional field: `calibration_other_specify` (text)

#### 8.2 Discrimination Measures

- **8.2.1** `c_statistic` (select)
  - Values: ["Yes", "No", "No information"]
  - Fields: `c_statistic_value` (number) + `c_statistic_ci` (text)
- **8.2.2** `d_statistic` (select)
  - Values: ["Yes", "No", "No information"]
  - Fields: `d_statistic_value` (number) + `d_statistic_ci` (text)
- **8.2.3** `auc_graph` (select)
  - Values: ["Yes", "No", "No information"]
- **8.2.4** `log_rank_test` (select)
  - Values: ["Yes", "No", "Not applicable", "No information"]
  - Field: `log_rank_test_p_value` (text)
- **8.2.5** `risk_group_curves` (select)
  - Values: ["Yes", "No", "Not applicable", "No information"]
- **8.2.6** `discrimination_other` (select)
  - Values: ["Yes", "No", "No information"]
  - Conditional field: `discrimination_other_specify` (text)

#### 8.3 Overall Measures

- **8.3.1** `r_squared` (select)
  - Values: ["Yes", "No", "Not evaluated", "No information"]
  - Fields: `r_squared_value` (number) + `r_squared_ci` (text) + `r_squared_type` (text)
- **8.3.2** `brier_score` (select)
  - Values: ["Yes", "No", "Not evaluated", "No information"]
  - Fields: `brier_score_value` (number) + `brier_score_ci` (text)
- **8.3.3** `overall_other` (select)
  - Values: ["Yes", "No", "No information"]
  - Conditional field: `overall_other_specify` (text)

#### 8.4 Clinical Utility

- **8.4.1** `dca` (select)
  - Values: ["Yes", "No", "Not evaluated", "No information"]
- **8.4.2** `clinical_utility_other` (select)
  - Values: ["Yes", "No", "No information"]
  - Conditional field: `clinical_utility_other_specify` (text)

### 9. Model Validation

**Entity Type**: `model_validation`

- **9.1.1** `internal_validation` (select)
  - Values: ["Bootstrap", "Cross-validation", "Split-sample", "Other (specify)", "None", "No information"]
  - Conditional field: `internal_validation_other_specify` (text)
- **9.1.2** `external_validation` (select)
  - Values: ["Geographical", "Temporal", "Different population", "Other (specify)", "None", "No information"]
  - Conditional field: `external_validation_other_specify` (text)
- **9.2** `model_adjusted` (select)
  - Values: ["Yes", "No", "No information"]

### 10. Results

**Entity Type**: `model_results`

- **10.1** `number_of_predictors` (number, unit: predictors)
- **10.2** `predictor_weights_or_coefficients` (select)
  - Values: ["Predictor weights", "Regression coefficients", "Both", "No information"]
- **10.3** `intercept_included` (select)
  - Values: ["Yes", "No", "No information"]
- **10.4** `alternative_presentation` (select)
  - Values: ["Score system", "Nomogram", "Web calculator", "Mobile app", "Other (specify)", "None", "No information"]
  - Conditional field: `alternative_presentation_other_specify` (text)

### 11. Interpretation

**Entity Type**: `model_interpretation`

- **11.1** `interpretation` (text) — long text

### 12. Observations

**Entity Type**: `model_observations`

- **12.1** `data_extraction_process` (select)
  - Values: ["All information has been successfully registered", "Some information missing", "Extraction incomplete"]
- **12.2** `additional_information` (text)

## Final Predictors (multiple)

**Entity Type**: `final_predictors` (cardinality='many')

- `predictor_name` (text)
- `predictor_weight` (text)

## Design decisions

### 1. Participant Description (2.8.1-2.8.5)

**Chosen**: direct fields on `participants` (not a sub-entity).

- Keeps queries simple and the structure flat.

### 2. Fields with Confidence Interval (CI)

**Chosen**: two separate fields.

- `value` (number) + `*_ci` (text)
- Example: `c_statistic` (number) + `c_statistic_ci` (text, e.g. "0.64 to 0.78")
- More flexible across different CI formats.

### 3. "Other" fields with specification

**Chosen**: hybrid approach driven by `validation_schema`.

- Main field: select with "Other (specify)" in `allowed_values`.
- Specification field: text whose `validation_schema` declares the conditional dependency.
- Shape inside `validation_schema`:

  ```json
  {
    "conditional_required": {
      "depends_on": "field_name",
      "required_when": "Other (specify)"
    }
  }
  ```

- The frontend renders the `*_other_specify` field conditionally when "Other" is selected.

## Usage example

### Creating instances for an article with 2 models

```sql
-- Article: "Gatti et al., 2017"

-- Model A: "AEPEI score"
INSERT INTO extraction_instances (article_id, template_id, entity_type_id, label, parent_instance_id)
VALUES (article_id, template_id, prediction_models_id, 'AEPEI score', NULL)
RETURNING id INTO model_a_id;

-- Automatic children (cardinality='one') created via extractionInstanceService.createHierarchy()
-- source_of_data, participants, outcome, candidate_predictors, sample_size, missing_data,
-- model_development, model_performance, model_validation, model_results,
-- model_interpretation, model_observations

-- Final predictors (cardinality='many') - created manually
INSERT INTO extraction_instances (article_id, template_id, entity_type_id, label, parent_instance_id)
VALUES
  (article_id, template_id, final_predictors_id, 'Age', model_a_id),
  (article_id, template_id, final_predictors_id, 'Gender', model_a_id),
  (article_id, template_id, final_predictors_id, 'Vegetation size', model_a_id);

-- Model B: "Alternate AEPEI score"
INSERT INTO extraction_instances (article_id, template_id, entity_type_id, label, parent_instance_id)
VALUES (article_id, template_id, prediction_models_id, 'Alternate AEPEI score', NULL)
RETURNING id INTO model_b_id;

-- Children created automatically...
```

## Useful queries

### List every model for an article

```sql
SELECT id, label 
FROM extraction_instances
WHERE article_id = '<article_id>'
  AND entity_type_id = (
    SELECT id FROM extraction_entity_types 
    WHERE name = 'prediction_models'
    AND template_id = (SELECT id FROM extraction_templates_global WHERE name = 'CHARMS v1.1')
  );
```

### List the children of a model

```sql
SELECT et.name, et.label, ei.id, ei.label
FROM extraction_instances ei
JOIN extraction_entity_types et ON et.id = ei.entity_type_id
WHERE ei.parent_instance_id = '<model_id>'
ORDER BY et.sort_order, ei.sort_order;
```

### List extracted values for a model

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

## Statistics

- **Entity Types**: 15 (1 root + 14 children)
- **Fields**: 80+
- **Fields with CI**: 10+ (c_statistic, brier_score, calibration_slope, etc.)
- **Fields with "Other"**: 10+ (with conditional `*_other_specify` fields)
- **Boolean / select fields**: 30+
- **Text fields**: 40+

## References

- [Original CHARMS Checklist](https://journals.plos.org/plosmedicine/article/file?id=10.1371/journal.pmed.1001744&type=printable)
- [CHARMS 2023 Update](https://bmcmedresmethodol.biomedcentral.com/articles/10.1186/s12874-023-01849-0)
