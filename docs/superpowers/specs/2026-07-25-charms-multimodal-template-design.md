---
status: draft
last_reviewed: 2026-07-25
owner: '@raphaelfh'
---

# CHARMS + Multimodal extraction template — design

Locked with the user 2026-07-25 through a brainstorming cycle. Goal:
seed the CHARMS + multimodal-extension data-extraction instrument (built
for the multimodal-ML heart-failure systematic review) into prumo as a
global catalogue template, so it can be imported into a project and drive
grounded AI extraction + the HITL flow.

Source of truth for the instrument is the research repo:

- `pj_multimodal_ml_heart_failure_sr/docs/data_extraction/data_extraction_fields.md`
  (field dictionary — one field per row, with the Portuguese `prompt-IA`)
- `pj_multimodal_ml_heart_failure_sr/docs/data_extraction/methodology.md`
  (CHARMS methodology + the multimodal extension rationale)

This spec is the English materialization of that instrument onto prumo's
`extraction_templates_global` → `entity_types` → `fields` model.

## Decisions locked

1. **Delivery: a new global seed template.** A `seed_charms_mm()`
   function in `backend/app/seed.py` with fixed UUIDs, wired into
   `main()` next to `seed_charms` / `seed_probast` / `seed_quadas2`.
   Idempotent by existence-check. CI already replays the seed against a
   fresh DB, so the template is reproducible across environments — which
   matters for systematic-review reproducibility. No Alembic migration:
   this is seed data on existing tables.
2. **Language: all English.** Labels, descriptions, and the per-field AI
   prompts (`llm_description`) are English — the English-only rule
   applies to committed seed code, and the source papers are English. The
   Portuguese field dictionary stays the research-repo source of truth;
   the `prompt-IA` text is translated field-by-field, with special care
   for the embedded modality/provenance definitions on `mm_modalities`
   and `mm_n_domains`.
3. **Structure: native study/model split** (not a flat per-model form).
   Study-level sections are filled once per article; per-model sections
   repeat per prediction model via the `prediction_models`
   `model_container`. This matches CHARMS methodology and prumo's
   established CHARMS skeleton, and avoids re-typing study data per model.
4. **Interpretation is study-level.** The three `intp_*` fields describe
   the paper ("os autores comparam / declaram / destinam"), so they sit
   in a study-level `Interpretation` section rather than repeating per
   model.
5. **`number_ci` becomes two `number` fields.** prumo has no CI type; each
   confidence interval is split into `*_ci_low` / `*_ci_high` `number`
   fields, alongside the separate point-estimate `number` field.

## Why this is not an edit of the existing `seed_charms`

The existing `seed_charms()` template is flavored for a **different**
review (it carries `native_valve_endocarditis` / `valve_affected`
participant fields — an endocarditis instrument). The heart-failure
multimodal instrument is a genuinely new template and gets its own seed
function and its own fixed-UUID block. The existing CHARMS template is
left untouched.

## Template identity

- `name`: **"CHARMS + Multimodal (ML prediction)"** (final name is the
  user's call; used as the catalogue label in the Import dialog).
- `framework`: `"CHARMS"` · `version`: `"1.0.0"` · `kind`: `extraction`.
- Fixed UUID block: template `000e0000-0000-0000-0000-000000000001`;
  entity types `000e00xx-…` (see the plan for the exact assignment).
- **`is_required`:** `False` on every **entity type** (hardcoded by
  `_entity_type_from_spec`); **`True` on every field**, matching all three
  existing seeded templates (CHARMS / PROBAST / QUADAS-2 all leave the
  `_f` / `_qa_field` `required=True` default in place). This is
  deliberate, not incidental: the finalize gate counts an
  `no_information` marker as **filled**, so a required field turns the
  instrument's "if absent, NI" into an *explicitly recorded* answer
  rather than a silent blank — constitution §IX ("a 'no information'
  outcome is a recorded proposal, not a silent drop"). Managers relax
  `is_required` per project clone if they want a looser gate.
- The gate measures required fields **per existing instance**, so the two
  `many` sections stay safe: a model with no `Numeric Performance`
  instance contributes nothing, and reviewers create only the validation
  blocks the paper actually reports.
- `description`: study-level sections (Source of Data, Participants,
  Outcome, Candidate Predictors, Sample Size, Missing Data,
  Interpretation) filled once per article; per-model sections (Model
  Development, Performance, Evaluation, Results, Multimodal Extension,
  Numeric Performance) filled once per prediction model.

## Entity-type tree (14 entity types)

Roles: `study_section` (root, filled once), `model_container` (root,
`cardinality='many'`, drives the model selector), `model_section` (child
of the container, rendered per model). The container-child trigger
requires each `model_section` parent to be the `model_container`.

| Section | Role | Cardinality | Source fields |
| --- | --- | --- | --- |
| Source of Data | `study_section` | one | `src_*` (4) |
| Participants | `study_section` | one | `par_*` (5) |
| Outcome | `study_section` | one | `out_*` (6) |
| Candidate Predictors | `study_section` | one | `prd_*` (5) |
| Sample Size | `study_section` | one | `ss_*` (3) |
| Missing Data | `study_section` | one | `miss_*` (2) |
| Interpretation | `study_section` | one | `intp_*` (3) |
| Prediction Models | `model_container` | **many** | `mdl_*` (2) |
| Model Development | `model_section` | one | `dev_*` (4) |
| Model Performance | `model_section` | one | `perf_*` (3) |
| Model Evaluation | `model_section` | one | `eval_*` (3) |
| Results | `model_section` | one | `res_*` (2) |
| Multimodal Extension | `model_section` | one | `mm_*` (7) |
| Numeric Performance | `model_section` | **many** | `pnum_*` (17) |

`mdl_id` from the field dictionary is not a field — it is the model
instance itself. `Numeric Performance` is a per-model `cardinality='many'`
section (one instance per validation type), directly analogous to the
existing CHARMS `final_predictors` many-section, so the container-child
trigger is satisfied.

Totals: **14 entity types**, **66 fields**.

## Field-type & disposition mapping

| Dictionary type | prumo `field_type` | Notes |
| --- | --- | --- |
| `string` | `text` | |
| `integer` / `number` | `number` | `unit` set where meaningful |
| `number_ci` | two `number` (`*_ci_low`, `*_ci_high`) | point estimate stays a separate `number` |
| `enum` | `select` + `allowed_values` | controlled vocab kept verbatim |
| `enum_list` | `multiselect` + `allowed_values` | `mm_modalities`, `pnum_explainability` |
| `boolean` | `boolean` | |

Disposition markers (ADR-0016):

- **`no_information` is universal** — no seeded "NI" option; this is the
  instrument's "NI por padrão" default on every field.
- **`allows_not_applicable=True`** only where a prompt invokes NA on a
  field with no in-band NA value: `eval_external_source`.
- **`allows_not_evaluated=True`** where a prompt distinguishes "not
  evaluated/assessed" (calibration): `perf_calibration`,
  `pnum_calib_slope`, `pnum_calib_intercept`.
- In-band controlled-vocab values that are **substantive classifications**
  (`none` for a comparator, `na` for imaging provenance, `unclear`) are
  kept as real `allowed_values`, mirroring how PROBAST keeps `Unclear`
  while NI/NA moved to markers.

`llm_description` for each field = the English translation of that field's
`prompt-IA`. Per-field prompts carry only the field instruction; prumo's
extraction wrapper supplies grounding, the evidence-quote/page requirement,
and the `{value, evidence_quote, page, confidence}` output contract, so
those are not repeated per field.

## Field roster

Study-level sections first, then the model container and its per-model
sections. `T` = `field_type`; `Disp.` = disposition flags beyond the
universal `no_information`.

### Source of Data (`study_section`, one)

| field | T | allowed_values / unit |
| --- | --- | --- |
| `src_design` | select | cohort-prospective, cohort-retrospective, case-control, rct, registry, cross-sectional, other |
| `src_data_source` | text | |
| `src_country` | text | |
| `src_recruit_period` | text | |

### Participants (`study_section`, one)

| field | T | allowed_values / unit |
| --- | --- | --- |
| `par_eligibility` | text | |
| `par_setting` | select | inpatient, outpatient, ed, mixed, population, unclear |
| `par_n_centers` | number | unit: centers |
| `par_inclusion` | text | |
| `par_exclusion` | text | |

### Outcome (`study_section`, one)

| field | T | allowed_values / unit |
| --- | --- | --- |
| `out_definition` | text | |
| `out_type` | select | diagnostic, prognostic, both |
| `out_timing` | text | |
| `out_blinded` | select | yes, no, unclear |
| `out_hf_phenotype` | select | HFpEF, HFrEF, HFmrEF, mixed, unspecified |
| `out_endpoint` | text | |

### Candidate Predictors (`study_section`, one)

| field | T | allowed_values / unit |
| --- | --- | --- |
| `prd_list` | text | |
| `prd_n_candidates` | number | unit: count |
| `prd_timing` | text | |
| `prd_blinded` | select | yes, no, unclear |
| `prd_type` | text | |

### Sample Size (`study_section`, one)

| field | T | allowed_values / unit |
| --- | --- | --- |
| `ss_n_participants` | number | unit: participants |
| `ss_n_events` | number | unit: events |
| `ss_epv` | number | unit: events/predictor |

### Missing Data (`study_section`, one)

| field | T | allowed_values / unit |
| --- | --- | --- |
| `miss_reported` | select | yes, no, unclear |
| `miss_method` | select | complete-case, single-imputation, multiple-imputation, model-based, none, unclear |

### Interpretation (`study_section`, one)

| field | T | allowed_values / unit |
| --- | --- | --- |
| `intp_comparison` | text | |
| `intp_limitations` | text | |
| `intp_applicability` | text | |

### Prediction Models (`model_container`, many)

| field | T | allowed_values / unit |
| --- | --- | --- |
| `mdl_name` | text | |
| `mdl_role` | select | multimodal, unimodal-comparator, baseline, guideline-score |

### Model Development (`model_section`, one)

| field | T | allowed_values / unit |
| --- | --- | --- |
| `dev_method` | text | |
| `dev_selection` | text | |
| `dev_hyperparam` | text | |
| `dev_internal_val` | select | none, split, cv, bootstrap, nested-cv, other |

### Model Performance (`model_section`, one)

| field | T | allowed_values / unit · Disp. |
| --- | --- | --- |
| `perf_discrimination` | text | |
| `perf_calibration` | text | not_evaluated |
| `perf_classification` | text | |

### Model Evaluation (`model_section`, one)

| field | T | allowed_values / unit · Disp. |
| --- | --- | --- |
| `eval_validation_type` | select | apparent-only, internal, external, both |
| `eval_external_source` | text | not_applicable |
| `eval_comparator` | text | |

### Results (`model_section`, one)

| field | T | allowed_values / unit |
| --- | --- | --- |
| `res_final_model` | text | |
| `res_coefficients` | select | full, partial, none |

### Multimodal Extension (`model_section`, one)

| field | T | allowed_values / unit |
| --- | --- | --- |
| `mm_modalities` | multiselect | ecg, pcg, cxr, echo, cmr, clinical-text, tabular-ehr, ehr-timeseries, omics, hrv, wearable-iot |
| `mm_n_domains` | number | unit: count |
| `mm_fusion_type` | select | early, intermediate, late, none |
| `mm_representation_tier` | select | tier-1, tier-2, tier-3 |
| `mm_encoders` | text | |
| `mm_provenance_flag` | select | separate-stream, single-field-imaging-origin, na |
| `mm_comparator_type` | select | guideline-score, unimodal-ml, logistic-linear, human-expert, none |

`mm_modalities` and `mm_n_domains` carry the protocol's embedded modality
definition in their prompt (Schouten 2025 domain vocabulary, the
single-acquisition-derivation rule, and the provenance criterion). These
two prompts are translated with extra care and reviewed against the source.

### Numeric Performance (`model_section`, many — one instance per validation type)

| field | T | allowed_values / unit · Disp. |
| --- | --- | --- |
| `pnum_validation_type` | select | apparent, internal, external (block key) |
| `pnum_auc` | number | 0–1 |
| `pnum_auc_ci_low` | number | |
| `pnum_auc_ci_high` | number | |
| `pnum_cindex` | number | 0–1 |
| `pnum_cindex_ci_low` | number | |
| `pnum_cindex_ci_high` | number | |
| `pnum_sensitivity` | number | |
| `pnum_specificity` | number | |
| `pnum_accuracy` | number | |
| `pnum_calib_slope` | number | not_evaluated |
| `pnum_calib_intercept` | number | not_evaluated |
| `pnum_nri` | number | |
| `pnum_brier` | number | 0–1 |
| `pnum_n` | number | unit: participants |
| `pnum_events` | number | unit: events |
| `pnum_explainability` | multiselect | shap, integrated-gradients, feature-importance, attention, grad-cam, none |

## Testing

- **Unit test** (mirroring the existing seed tests): assert the tree —
  14 entity types with correct roles/cardinalities, exactly two
  `cardinality='many'` sections (`prediction_models`, `Numeric
  Performance`), one `model_container`, per-section field counts, the
  `field_type` of representative fields, and the disposition flags
  (`allows_not_applicable` on `eval_external_source`;
  `allows_not_evaluated` on the three calibration fields).
- **Seed idempotency**: the existence-check short-circuit is covered by
  running the seed twice in a test (or reusing the existing seed
  idempotency harness).
- **CI seed replay** already guards drift against a fresh DB.

## Delivery / rollout

1. Add `seed_charms_mm()` + fixed UUIDs to `backend/app/seed.py`; call it
   from `main()`.
2. `cd backend && uv run python -m app.seed` locally (idempotent) to
   materialize it; verify the tree via the unit test and a quick UI import
   into a scratch project.
3. Ship via PR to `dev` (seed-only, no migration). Add the new domain
   tokens to `.github/cspell-words.txt` so docs-ci stays green.
4. In the heart-failure project, import via the existing **Import
   template** dialog (`POST /api/v1/projects/{id}/templates/clone` with
   `global_template_id`, `kind=extraction`), then run extraction.

## Out of scope

- No new `field_type` (`number_ci` is modeled as two `number` fields; no
  schema change).
- No changes to the extraction/HITL pipeline, prompts wrapper, or export.
- No auto-required marking — required-field policy is a per-project clone
  decision by the manager.
- Prompt-quality tuning beyond a faithful English translation of the
  existing `prompt-IA` is a follow-up, not part of this seed.
