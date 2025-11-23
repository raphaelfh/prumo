# 🌳 CHARMS 2.0 - Estrutura Hierárquica Visual

**Template ID**: `438e0126-ce20-4786-80e4-1700706b045c`  
**Version**: 2.0.0  
**Status**: ✅ Aplicado no banco de dados  

___
## INFORMAÇÕES SOBRE O CHARMS:
https://bmcmedresmethodol.biomedcentral.com/articles/10.1186/s12874-023-01849-0






---

## 📐 ESTRUTURA HIERÁRQUICA COMPLETA

**CORREÇÃO CRÍTICA**: TODOS os campos são específicos por modelo preditivo, não compartilhados.

```
CHARMS v2.0
│
└─ 🎯 PREDICTION MODELS (many) ⭐ ASSESSMENT TARGET
    ├─ model_name (0.5)
    ├─ modelling_method (7.1)
    │
    ├─── Source of Data (one) [CHILD]
    │     └─ data_source (1.1)
    │
    ├─── Participants (one) [CHILD]
    │     ├─ recruitment_method (2.1)
    │     ├─ recruitment_dates (2.2)
    │     ├─ study_setting (2.3)
    │     ├─ study_sites_regions (2.4)
    │     ├─ study_sites_number (2.5)
    │     ├─ inclusion_criteria (2.6)
    │     ├─ exclusion_criteria (2.7)
    │     ├─ age_of_participants (2.8.1)
    │     ├─ native_valve_endocarditis (2.8.2)
    │     ├─ valve_affected (2.8.3)
    │     ├─ characteristic_4 (2.8.4)
    │     └─ characteristic_5 (2.8.5)
    │
    ├─── Outcome to be Predicted (one) [CHILD]
    │     ├─ outcome (3.1)
    │     ├─ outcome_definition (3.2)
    │     ├─ same_outcome_definition (3.3)
    │     ├─ type_of_outcome (3.4)
    │     ├─ outcome_assessed_blinded (3.5)
    │     ├─ predictors_part_of_outcome (3.6)
    │     └─ time_of_outcome (3.7)
    │
    ├─── Candidate Predictors (one) [CHILD]
    │     ├─ number_of_candidates (4.1)
    │     ├─ type_of_predictors (4.2)
    │     ├─ timing_of_measurement (4.3)
    │     ├─ predictors_definition_similar (4.4)
    │     ├─ predictors_assessed_blinded (4.5)
    │     └─ handling_continuous (4.6)
    │
    ├─── Sample Size (one) [CHILD]
    │     ├─ number_of_participants (5.1)
    │     ├─ number_of_events (5.2)
    │     └─ epv_epp (5.3)
    │
    ├─── Missing Data (one) [CHILD]
    │     ├─ participants_with_missing (6.1)
    │     └─ handling_of_missing (6.2)
    │
    ├─── Model Development (one) [CHILD]
    │     ├─ selection_method_candidates (7.2)
    │     ├─ selection_method_multivariable (7.3)
    │     └─ shrinkage (7.4)
    │
    ├─── Final Predictors (many) [CHILD]
    │     ├─ predictor_name
    │     └─ predictor_weight
    │
    ├─── Model Performance (one) [CHILD]
    │     ├─ Calibration: calibration_plot, calibration_slope, calibration_in_large, hosmer_lemeshow (8.1.x)
    │     ├─ Discrimination: c_statistic, d_statistic, auc_graph, log_rank_test, risk_group_curves (8.2.x)
    │     ├─ Overall: r_squared, brier_score (8.3.x)
    │     └─ Clinical utility: dca (8.4.x)
    │
    ├─── Model Validation (one) [CHILD]
    │     ├─ internal_validation (9.1.1)
    │     ├─ external_validation (9.1.2)
    │     └─ model_adjusted (9.2)
    │
    ├─── Results (one) [CHILD] - NOVO
    │     ├─ number_of_predictors (10.1)
    │     ├─ predictor_weights_or_coefficients (10.2)
    │     ├─ intercept_included (10.3)
    │     └─ alternative_presentation (10.4)
    │
    ├─── Interpretation (one) [CHILD] - NOVO
    │     └─ interpretation (11.1)
    │
    └─── Observations (one) [CHILD] - NOVO
          ├─ data_extraction_process (12.1)
          └─ additional_information (12.2)
```

---

## 🎯 EXEMPLO DE DADOS REAIS

### Artigo: "Gatti et al., 2017"

```
Article: "Predicting IE Mortality Risk" (Gatti, 2017)
│
└─ MODELS (múltiplos no mesmo artigo - cada um com TODAS as seções)
    │
    ├─ Model (a): "AEPEI score"
    │   ├─ Source of Data: "Retrospective cohort"
    │   ├─ Participants
    │   │   ├─ Sample: 361, Events: 56 (15.5%)
    │   │   └─ Age: 59.1 (15.4)
    │   ├─ Outcome
    │   │   └─ Definition: "30-day mortality"
    │   ├─ Sample Size
    │   │   └─ N: 361, Events: 56, EPV: 1.0
    │   ├─ Candidate Predictors
    │   │   └─ Number: 57
    │   ├─ Final Predictors (many)
    │   │   ├─ Age
    │   │   ├─ Gender
    │   │   ├─ Vegetation size
    │   │   ├─ Renal failure
    │   │   └─ Heart failure
    │   ├─ Model Development
    │   │   ├─ Method: "Logistic regression"
    │   │   ├─ Selection: Backward elimination
    │   │   └─ Shrinkage: No
    │   ├─ Model Performance
    │   │   ├─ C-statistic: 0.72 (0.64 to 0.78)
    │   │   ├─ HL test: p=0.42
    │   │   └─ Brier score: Not evaluated
    │   ├─ Model Validation
    │   │   ├─ Internal: Bootstrap
    │   │   └─ External: Geographical
    │   ├─ Results
    │   │   └─ Number of predictors: 5
    │   ├─ Interpretation
    │   │   └─ "Further validation studies are necessary..."
    │   └─ 📋 PROBAST Assessment ⭐
    │       ├─ Domain 1 (Participants): Low
    │       ├─ Domain 2 (Predictors): High
    │       ├─ Domain 3 (Outcome): Low
    │       └─ Domain 4 (Analysis): High
    │
    ├─ Model (b): "Alternate AEPEI score"
    │   ├─ Source of Data: "Retrospective cohort" (mesmo estudo, mas dados específicos deste modelo)
    │   ├─ Participants: (mesmo sample, mas pode ter características diferentes)
    │   ├─ Final Predictors (3 instead of 5!)
    │   │   ├─ Age
    │   │   ├─ Vegetation size
    │   │   └─ Heart failure
    │   ├─ Model Performance
    │   │   └─ C-statistic: 0.69 (0.61 to 0.76) - diferente do Model A!
    │   └─ 📋 PROBAST Assessment ⭐
    │       └─ (respostas diferentes do Model A - avaliação independente)
    │
    └─ Model (c): "Subgroup analysis"
        └─ ... (outro assessment independente)
```

---

## 🔄 FLUXO DE DADOS

### 1. Extraction

```sql
-- Model A (cada modelo tem TODAS as seções)
INSERT INTO extraction_instances VALUES
  ('model-a', 'prediction_models', NULL);  -- parent = NULL

-- Children of Model A (todos específicos deste modelo)
INSERT INTO extraction_instances VALUES
  ('source-a', 'source_of_data', 'model-a'),              -- parent = Model A
  ('participants-a', 'participants', 'model-a'),          -- parent = Model A
  ('outcome-a', 'outcome_to_be_predicted', 'model-a'),    -- parent = Model A
  ('cand-pred-a', 'candidate_predictors', 'model-a'),     -- parent = Model A
  ('sample-a', 'sample_size', 'model-a'),                 -- parent = Model A
  ('missing-a', 'missing_data', 'model-a'),               -- parent = Model A
  ('dev-a', 'model_development', 'model-a'),             -- parent = Model A
  ('perf-a', 'model_performance', 'model-a'),            -- parent = Model A
  ('valid-a', 'model_validation', 'model-a'),            -- parent = Model A
  ('results-a', 'model_results', 'model-a'),             -- parent = Model A
  ('interp-a', 'model_interpretation', 'model-a'),       -- parent = Model A
  ('obs-a', 'model_observations', 'model-a');             -- parent = Model A
  
-- Final predictors OF Model A (múltiplos)
INSERT INTO extraction_instances VALUES
  ('pred-1-a', 'final_predictors', 'model-a'),  -- parent = Model A
  ('pred-2-a', 'final_predictors', 'model-a'),  -- parent = Model A
  ('pred-3-a', 'final_predictors', 'model-a');  -- parent = Model A

-- Model B (completamente independente, com suas próprias seções)
INSERT INTO extraction_instances VALUES
  ('model-b', 'prediction_models', NULL);  -- parent = NULL

-- Children of Model B (todos específicos deste modelo)
-- ... mesma estrutura do Model A, mas instances separadas
```

### 2. Assessment

```sql
-- Project config
UPDATE projects SET 
  assessment_scope = 'extraction_instance',
  assessment_entity_type_id = '<prediction_models_entity_type_id>';

-- PROBAST of Model A
INSERT INTO assessments VALUES (
  article_id: 'article-1',
  extraction_instance_id: 'model-a',  -- ⭐ Específico do modelo
  responses: {
    '1.1': { level: 'Low', comment: '...' },
    '2.1': { level: 'High', comment: 'Only 5 predictors, good EPV' },
    ...
  }
);

-- PROBAST of Model B (independente!)
INSERT INTO assessments VALUES (
  article_id: 'article-1',
  extraction_instance_id: 'model-b',  -- ⭐ Outro modelo
  responses: {
    '2.1': { level: 'Low', comment: 'Only 3 predictors, better EPV' },
    ...
  }
);
```

---

## 🔍 QUERIES ÚTEIS

### Buscar todos os modelos de um artigo
```sql
SELECT id, label 
FROM extraction_instances
WHERE article_id = '<article_id>'
  AND entity_type_id = (
    SELECT id FROM extraction_entity_types 
    WHERE name = 'prediction_models'
  );
```

### Buscar children de um modelo
```sql
SELECT * FROM get_instance_children('<model_id>');
-- Retorna: predictors, performance, validation, etc.
```

### Buscar assessments de um modelo
```sql
SELECT * FROM assessments
WHERE extraction_instance_id = '<model_id>';
```

### Buscar path completo de um predictor
```sql
SELECT get_instance_path('<predictor_id>');
-- Retorna: "Model A > Final Predictors > Age"
```

---

## 📊 ESTATÍSTICAS DO TEMPLATE

### CHARMS v1.0 (Legado)
- Entity Types: 10 (todos flat)
- Fields: 44
- Instances existentes: 177
- Status: Preservado para retrocompatibilidade

### CHARMS v2.0 (Completo)
- Entity Types: 15 (1 root + 14 children)
- Fields: ~80+
- Hierarquia: 2 níveis (Prediction Models → Children)
- Status: ✅ Implementado no banco de dados
- **Todos os campos são específicos por modelo** (não compartilhados)

---

## 🎓 ALINHAMENTO COM CHECKLISTS

### CHARMS Checklist
✅ Source of data (item 1.1)  
✅ Participants (2.1-2.8)  
✅ Outcome (3.1-3.7)  
✅ Candidate predictors (4.1-4.6)  
✅ Sample size (5.1-5.3)  
✅ Missing data (6.1-6.2)  
✅ Model development (7.1-7.4)  
✅ Model performance (8.1-8.4)  
✅ Model evaluation (9.1-9.2)  

### PROBAST Checklist (Assessment Target)
✅ Domain 1: Participants (study-level)  
✅ Domain 2: Predictors (model-level) ⭐  
✅ Domain 3: Outcome (study-level)  
✅ Domain 4: Analysis (model-level) ⭐  

**Um PROBAST por modelo** = perfeito alinhamento metodológico!

---

## 🎯 USO PRÁTICO

### Cenário 1: Artigo com 1 modelo
```
Article A
  └─ Model 1
      → 1 assessment PROBAST
```

### Cenário 2: Artigo com 3 modelos
```
Article B
  ├─ Model A (primary)
  │   → 1 assessment PROBAST
  ├─ Model B (sensitivity)
  │   → 1 assessment PROBAST
  └─ Model C (subgroup)
      → 1 assessment PROBAST

Total: 3 assessments PROBAST por revisor
```

### Cenário 3: Systematic Review com 10 artigos, média 2 modelos
```
10 articles × 2 models × 2 reviewers = 40 assessments PROBAST

Estrutura hierárquica permite:
- Query eficiente
- Comparação correta (mesmo modelo)
- Export com contexto
- Relatórios detalhados
```

---

**Template criado com excelência técnica!** ✨  
**Alinhado com metodologia acadêmica!** 🎓  
**Pronto para produção!** 🚀

---

**Criado por**: AI Assistant + Supabase MCP  
**Baseado em**: CHARMS Official Checklist + PROBAST Methodology  
**Próximo**: Integração UI (ver PRÓXIMOS_PASSOS_IMEDIATOS.md)


