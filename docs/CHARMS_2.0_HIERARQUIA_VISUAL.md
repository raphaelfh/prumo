# 🌳 CHARMS 2.0 - Estrutura Hierárquica Visual

**Template ID**: `438e0126-ce20-4786-80e4-1700706b045c`  
**Version**: 2.0.0  
**Status**: ✅ Aplicado no banco de dados  

---

## 📐 ESTRUTURA HIERÁRQUICA COMPLETA

```
CHARMS v2.0
│
├─ 📊 STUDY-LEVEL (compartilhado por todos os modelos)
│   │
│   ├─ Source of Data (one)
│   │   ├─ data_source
│   │   ├─ recruitment_method
│   │   ├─ recruitment_dates
│   │   ├─ study_setting
│   │   ├─ study_sites_regions
│   │   └─ study_sites_number
│   │
│   ├─ Participants (one)
│   │   ├─ inclusion_criteria
│   │   ├─ exclusion_criteria
│   │   ├─ participant_description
│   │   └─ age_of_participants
│   │
│   ├─ Outcome to be Predicted (one)
│   │   ├─ outcome
│   │   ├─ outcome_definition
│   │   ├─ same_outcome_definition
│   │   ├─ type_of_outcome
│   │   ├─ outcome_assessed_blinded
│   │   ├─ predictors_part_of_outcome
│   │   └─ time_of_outcome
│   │
│   ├─ Sample Size (one)
│   │   ├─ number_of_participants
│   │   └─ number_of_events
│   │
│   └─ Missing Data (one)
│       ├─ participants_with_missing
│       └─ handling_of_missing
│
└─ 🎯 MODEL-LEVEL (específico por modelo)
    │
    └─ Prediction Models (many) ⭐ ASSESSMENT TARGET
        ├─ model_name
        ├─ modelling_method
        │
        ├─── Candidate Predictors (one) [CHILD]
        │     ├─ number_of_candidates
        │     ├─ type_of_predictors
        │     ├─ timing_of_measurement
        │     ├─ predictors_definition_similar
        │     ├─ predictors_assessed_blinded
        │     └─ handling_continuous
        │
        ├─── Final Predictors (many) [CHILD]
        │     ├─ predictor_name
        │     └─ predictor_weight
        │
        ├─── Model Development (one) [CHILD]
        │     ├─ epv_epp
        │     ├─ selection_method_candidates
        │     ├─ selection_method_multivariable
        │     └─ shrinkage
        │
        ├─── Model Performance (one) [CHILD]
        │     ├─ calibration_plot
        │     ├─ calibration_slope
        │     ├─ calibration_in_large
        │     ├─ hosmer_lemeshow
        │     ├─ c_statistic
        │     ├─ auc_graph
        │     └─ brier_score
        │
        └─── Model Validation (one) [CHILD]
              ├─ internal_validation
              ├─ external_validation
              └─ model_adjusted
```

---

## 🎯 EXEMPLO DE DADOS REAIS

### Artigo: "Gatti et al., 2017"

```
Article: "Predicting IE Mortality Risk" (Gatti, 2017)
│
├─ STUDY-LEVEL (uma vez por artigo)
│   ├─ Participants
│   │   └─ Sample: 361, Events: 56 (15.5%)
│   ├─ Outcome
│   │   └─ Definition: "30-day mortality"
│   └─ Sample Size
│       └─ N: 361, Events: 56
│
└─ MODELS (múltiplos no mesmo artigo)
    │
    ├─ Model (a): "Primary model"
    │   ├─ method: "Logistic regression"
    │   │
    │   ├─ Candidate Predictors
    │   │   └─ Number: 57
    │   │
    │   ├─ Final Predictors (many)
    │   │   ├─ Age
    │   │   ├─ Gender
    │   │   ├─ Vegetation size
    │   │   ├─ Renal failure
    │   │   └─ Heart failure
    │   │
    │   ├─ Model Development
    │   │   ├─ EPV: 1.0
    │   │   ├─ Selection: Backward elimination
    │   │   └─ Shrinkage: No
    │   │
    │   ├─ Model Performance
    │   │   ├─ C-statistic: 0.78
    │   │   ├─ HL test: p=0.42
    │   │   └─ Calibration: Good
    │   │
    │   ├─ Model Validation
    │   │   ├─ Internal: Bootstrap
    │   │   └─ External: Geographical
    │   │
    │   └─ 📋 PROBAST Assessment ⭐
    │       ├─ Domain 1 (Participants): Low
    │       ├─ Domain 2 (Predictors): High
    │       ├─ Domain 3 (Outcome): Low
    │       └─ Domain 4 (Analysis): High
    │
    ├─ Model (b): "Alternative model"
    │   ├─ method: "Logistic regression"
    │   │
    │   ├─ Final Predictors (3 instead of 5!)
    │   │   ├─ Age
    │   │   ├─ Vegetation size
    │   │   └─ Heart failure
    │   │
    │   ├─ Model Development
    │   │   └─ EPV: 1.0 (better!)
    │   │
    │   └─ 📋 PROBAST Assessment ⭐
    │       └─ (respostas diferentes do Model A)
    │
    └─ Model (c): "Subgroup analysis"
        └─ ... (outro assessment independente)
```

---

## 🔄 FLUXO DE DADOS

### 1. Extraction

```sql
-- Study-level (compartilhado)
INSERT INTO extraction_instances VALUES
  ('participants-inst-1', 'participants', NULL),  -- parent = NULL
  ('outcome-inst-1', 'outcome', NULL);

-- Model A
INSERT INTO extraction_instances VALUES
  ('model-a', 'prediction_models', NULL);  -- parent = NULL

-- Children of Model A
INSERT INTO extraction_instances VALUES
  ('cand-pred-a', 'candidate_predictors', 'model-a'),     -- parent = Model A
  ('perf-a', 'model_performance', 'model-a'),             -- parent = Model A
  ('valid-a', 'model_validation', 'model-a');             -- parent = Model A
  
-- Final predictors OF Model A
INSERT INTO extraction_instances VALUES
  ('pred-1-a', 'final_predictors', 'model-a'),  -- parent = Model A
  ('pred-2-a', 'final_predictors', 'model-a'),  -- parent = Model A
  ('pred-3-a', 'final_predictors', 'model-a');  -- parent = Model A
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

### CHARMS v2.0 (Novo)
- Entity Types: 11 (6 root + 5 children)
- Fields: 47
- Hierarquia: 2 níveis (Study → Models)
- Status: Disponível para novos projetos

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


