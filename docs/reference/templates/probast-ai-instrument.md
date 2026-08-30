---
status: stable
last_reviewed: 2026-08-30
owner: '@raphaelfh'
---

# PROBAST+AI instrument → template mapping

How the official PROBAST+AI instrument maps onto prumo's PROBAST+AI v2
quality-assessment template (global id `00ba0000-0000-0000-0000-000000000002`,
seeded by `backend/app/seed_probast_ai.py`). Companion design:
[`docs/superpowers/specs/2026-08-22-probast-ai-derived-domain-judgments-design.md`](../../superpowers/specs/2026-08-22-probast-ai-derived-domain-judgments-design.md).

## Sources

Cite as: Moons KGM, Damen JAA, Kaul T, et al. *PROBAST+AI: an updated
quality, risk of bias, and applicability assessment tool for prediction
models using regression or artificial intelligence methods.* BMJ
2025;388:e082505. doi:10.1136/bmj-2024-082505. License CC BY-NC (open
access via PMC11931409).

| Document | Content | URL |
|---|---|---|
| Main paper | Rationale, Box 1, Table 2 (all items) | <https://www.bmj.com/content/388/bmj-2024-082505> |
| Suppl. Table 3 (`mook082505.ww2.pdf`) | The fillable tool: Steps 1–4, describe boxes, answer columns, Step-4 roll-up tables | <https://www.bmj.com/content/bmj/suppl/2025/03/24/bmj-2024-082505.DC1/mook082505.ww2.pdf> |
| Suppl. Table 4 (`mook082505.ww3.pdf`) | Explanation & Elaboration Light: per-item guidance and examples | <https://www.bmj.com/content/bmj/suppl/2025/03/24/bmj-2024-082505.DC1/mook082505.ww3.pdf> |

The BMJ links sit behind a bot challenge; a scriptable mirror is Europe
PMC: `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11931409/supplementaryFiles`
(zip with ww1–ww3).

## The four steps and where each lives

| Step (once per…) | Instrument | In prumo |
|---|---|---|
| 1. Intended purpose (review) | PICOTS table: Population, Index model(s), Comparator model(s), Outcome(s), Timing, Setting/intended use | The project's structured PICOTS (`projects.picots_config_ai_review`, Project Settings → Review). It renders into every AI call as a `Review question and scope:` block, is pinned per run under `results.provenance.review_context`, and is the reference for every applicability judgment. Retyping it into the template's ✨ instruction is the pre-2026-08-30 workaround and is no longer needed |
| 2. Classify study type (model × publication) | development only / evaluation only / combination | `assessment_scope.study_type` (select, AI-proposed). Informational — it tells the reviewer which part of the form applies; blank sections of the unused part stay blank |
| 3. Domain assessment (publication × outcome) | Describe boxes → signalling questions → domain judgment + rationale; applicability on domains 1–3 | The 11 domain sections below; judgments carry a derived default computed from the SQ answers, overridable with a mandatory rationale |
| 4. Overall judgments (model) | Four roll-up tables + summary boxes | Four computed overalls (`derived_judgments` spec, `worst_domain` rule) + four assessor summary fields in `overall_judgement` |

## Answer scale

Signalling questions: `Y / PY / PN / N` plus the universal
`no_information` marker. **`not_applicable` exists on exactly four
conditional items** (the form's asterisked ones): dev 4.4, eval 4.4,
eval 4.5, eval 4.6 — six field rows after the A/I/E split. Domain
judgments and overalls: `Low / High / Unclear`.

## Judgment flow (what the instrument actually prescribes)

1. **Describe first.** Each domain opens with free-text describe boxes —
   the factual record the judgment rests on. In prumo these are optional
   text fields the AI pre-fills with evidence; the assessor verifies.
2. **Answer the signalling questions.** All phrased so Y/PY = low
   concern. The AI proposes answers with verbatim quotes; quotes are
   locatable in the article panel.
3. **Judge the domain — with discretion.** Any N/PN "flags the potential
   for" a concern; the tool says "you will need to use your judgement",
   and every judgment has a "Rationale of … rating" box. The E&E gives
   explicit judge-through examples: an NI on blinding (2.3) or on
   missing-data handling (4.3) does not force an Unclear domain, and an
   apparent-only evaluation (eval 4.1 = N) "may still be judged as low"
   risk when the development sample is large. prumo therefore computes a
   **derived default** (N/PN → High, NI → Unclear, all Y/PY → Low,
   strict on completeness, High propagates early) and the assessor
   records the final value — overriding requires the paired rationale.
4. **Overalls are mechanical.** The Step-4 tables are exactly
   worst-domain (Low < Unclear < High; "at least one domain high →
   high" without requiring the rest to be rated). prumo computes them;
   they are never typed. Each pairs with an assessor summary box.
5. **Applicability is a direct judgment** (domains 1–3 of each part,
   no signalling questions), made against the Step-1 PICOTS. It stays a
   stored field with AI proposal + rationale box.

## Item map — model development

Sections `dev_d1_participants`, `dev_d2_predictors`, `dev_d3_outcome`,
`dev_d4_analysis`. Field order inside a section mirrors the form:
describe → SQs → judgment → rationale → (applicability describe →
applicability → rationale).

| Instrument item | Field |
|---|---|
| D1 describe (data sources, selection criteria) | `desc_data_sources` |
| 1.1 appropriate data sources | `q1_appropriate_data_sources` |
| 1.2 appropriate study design | `q2_appropriate_study_design` |
| 1.3 representative dataset | `q3_representative_dataset` |
| D1 quality concern + rationale | `quality_concern`, `quality_concern_rationale` |
| D1 applicability describe (sources, participants, setting, dates) | `desc_setting_dates` |
| D1 applicability concern + rationale | `applicability_concerns`, `applicability_concerns_rationale` |
| D2 describe (predictors, definitions, timing) | `desc_predictors` |
| 2.1 similar definition/assessment | `q1_similar_definition_assessment` |
| 2.2 similar pre-processing | `q2_similar_preprocessing` |
| 2.3 blinded to outcome | `q3_blind_to_outcome` |
| 2.4 available at intended use | `q4_available_at_intended_use` |
| D2 judgment/applicability (+ rationales) | as D1; D2 has no applicability describe box |
| D3 describe (outcome, determination, interval) | `desc_outcome` |
| 3.1 appropriate definition | `q1_appropriate_definition` |
| 3.2 similar definition/assessment | `q2_similar_definition_assessment` |
| 3.3 blinded to predictors | `q3_blind_to_predictors` |
| 3.4 appropriate time interval | `q4_appropriate_time_interval` |
| D3 applicability describe (time point; composite distribution) | `desc_outcome_timing` |
| D4 describes ×4 (numbers; how developed; performance measures; missing data) | `desc_sample_numbers`, `desc_model_development`, `desc_performance_measures`, `desc_missing_data` |
| 4.1 reasonable sample size | `q1_reasonable_sample_size` |
| 4.2 continuous/categorical handling | `q2_continuous_categorical_handling` |
| 4.3 missing/censored handling | `q3_missing_censored_handling` |
| 4.4* imbalance → recalibration (NA-eligible) | `q4_imbalance_recalibration` |
| 4.5 overfitting methods | `q5_overfitting_methods` |
| D4 quality concern + rationale (no applicability in D4) | `quality_concern`, `quality_concern_rationale` |

## Item map — model evaluation

Sections `eval_d1_participants`, `eval_d2_predictors`,
`eval_d3_outcome` repeat the D1–D3 shape above with the judgment named
`risk_of_bias` (+ `risk_of_bias_rationale`).

Domain 4 distinguishes apparent (A) / internal (I) / external (E)
performance. The form's A/I/E answer columns become three SQ sections;
the domain has **one** judgment, exactly as the form:

| Instrument item | Section / field |
|---|---|
| 4.1 apparent-only avoided (answered once, full-width row) | `eval_d4_analysis_apparent.q1_apparent_only_avoided` |
| 4.2 reasonable sample size (per type) | `q2_reasonable_sample_size` in each type section |
| 4.3 missing/censored handling (per type) | `q3_missing_censored_handling` in each type section |
| 4.4* evaluation without imbalance correction (per type, NA-eligible) | `q4_uncorrected_imbalance_evaluation` in each type section |
| 4.5* data leakage avoided (I only; shaded NA for A/E) | `eval_d4_analysis_internal.q5_data_leakage_avoided` |
| 4.6* resampling replicates all steps (I only; shaded NA for A/E) | `eval_d4_analysis_internal.q6_resampling_replicates_all_steps` |
| 4.7 performance evaluated appropriately (per type) | `q7_appropriate_performance_measures` in each type section |
| D4 describes ×4 (numbers/events per predictor; performance measures; excluded participants; missing data) | `eval_d4_judgment.desc_sample_numbers`, `desc_performance_measures`, `desc_excluded_participants`, `desc_missing_data` |
| D4 risk of bias + rationale (one per domain) | `eval_d4_judgment.risk_of_bias`, `risk_of_bias_rationale` |

Documented deviations from the form's page layout (not from its
semantics): the A/I/E columns render as sections, and the D4 describe
boxes render beside the domain judgment (`eval_d4_judgment`) instead of
above item 4.1. The value entering Step 4 is identical.

The form's copy rule — for apparent-only evaluations the dev D1–D3
signalling answers "can directly be copied" into eval D1–D3 (the
judgments still made anew) — is manual for now; a one-click affordance
is a recorded follow-up in the design spec.

## Scope and overall sections

| Instrument | Section / field |
|---|---|
| Step 2 classification | `assessment_scope.study_type` (`development_only` / `evaluation_only` / `combination`) |
| Step 3 header: models of interest / outcome of interest | `assessment_scope.models_of_interest`, `assessment_scope.outcome_of_interest` |
| Step 4 summary boxes ×4 | `overall_judgement.summary_quality_development`, `summary_rob_evaluation`, `summary_applicability_development`, `summary_applicability_evaluation` |

The four overall *values* are computed (never stored): dev quality over
the four dev domains; eval RoB over eval D1–D3 + the single D4
judgment; applicability per part over its three domains.

## Who fills what

| Fields | Filled by |
|---|---|
| Scope (3), describes (18), signalling questions (42), applicability (6) + applicability rationales (6) | AI proposes with evidence; reviewer decides |
| Quality/RoB judgments (8) + their rationales (8), Step-4 summaries (4) | Assessor only — excluded from every LLM call (spec-declared coordinates); judgments carry a computed derived default |
| Overalls (4) | Computed; never entered by anyone |

13 sections, 95 fields.
