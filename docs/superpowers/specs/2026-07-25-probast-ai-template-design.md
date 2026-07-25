---
status: draft
last_reviewed: 2026-07-25
owner: '@raphaelfh'
---

# PROBAST+AI canonical quality-assessment template — design

> **Status:** Draft · Date: 2026-07-25 · Deciders: @raphaelfh
> **Scope:** seed the PROBAST+AI instrument (Moons KGM et al., BMJ 2025) as a
> canonical `quality_assessment` template, plus the minimum surrounding work
> for it to function faithfully: computed overall judgments, data-driven
> judgment rendering, and two in-blast-path fixes.
> **Source of truth for wording/structure:** the reviewer's dictionary at
> `pj_multimodal_ml_heart_failure_sr/docs/quality_assessment/probast_ai_fields.md`
> (34 signaling questions, 14 domain judgments, 4 derived overalls) and its
> generated mirror `schema/probast_ai_schema.yaml`; aggregation semantics from
> `tools/probast_judgment.py` in the same repo.

## Decisions (settled with the user)

1. **One flat template**, not two and not a parent/child tree. A grouping
   "Part" node is unrepresentable (role CHECK forces grouping parents to be
   `model_container`; partial unique index allows at most one per template),
   and two templates would force two runs/consensus cycles per article.
2. **Overall judgments are computed, never stored.** No Overall section, no
   field to type into — contradiction with the domains is unrepresentable.
3. **Rule runs in the backend exactly once**, configured by a
   `derived_judgments` spec seeded into the template's `schema` JSONB. The QA
   read payload and the export both consume the same module. The frontend
   renders, never computes.
4. **Judgment fields are detected data-driven** (select whose
   `allowed_values ⊆ {Low, High, Unclear}`), replacing the hardcoded
   name allowlist, so the development part can honestly judge "Quality".

Standing conventions applied without discussion: English-only seed content
(official text verbatim; `llm_description` = English translation of the
dictionary's per-item `ai_prompt`, judgment prompts keeping their embedded
aggregation criteria); ADR-0016 dispositions (answer set stays `Y/PY/PN/N`,
`no_information` universal, `not_applicable` as per-field flag).

## 1. Template & sections (seed-only, no migration)

New `seed_probast_ai()` in `backend/app/seed.py`, registered in `main()`
next to `seed_probast`. Global template row:

- id `00ba0000-0000-0000-0000-000000000001` (prefix convention: `00b0`
  PROBAST, `00d0` QUADAS-2, `00ba` PROBAST+AI), name `PROBAST+AI`,
  `framework=CUSTOM`, `kind=quality_assessment`, version `1.0.0`,
  description citing Moons 2025.
- `schema` JSONB carries the `derived_judgments` spec (section 2).

**10 entity types** (`00ba0001..00ba000a`), all `study_section`,
`cardinality='one'`, parentless, `sort_order` 1–10. **58 fields** total
(42 signaling incl. A/I/E triplication + 16 judgments), all
`field_type='select'`, `is_required=True`:

| # | Section (name / label) | Signaling fields | Judgment fields |
|---|---|---|---|
| 1 | `dev_d1_participants` — Development D1: Participants and data sources | q1–q3 | `quality_concern`, `applicability_concerns` |
| 2 | `dev_d2_predictors` — Development D2: Predictors | q1–q4 | `quality_concern`, `applicability_concerns` |
| 3 | `dev_d3_outcome` — Development D3: Outcome | q1–q4 | `quality_concern`, `applicability_concerns` |
| 4 | `dev_d4_analysis` — Development D4: Analysis | q1–q5 | `quality_concern` |
| 5 | `eval_d1_participants` — Evaluation D1: Participants and data sources | q1–q3 | `risk_of_bias`, `applicability_concerns` |
| 6 | `eval_d2_predictors` — Evaluation D2: Predictors | q1–q4 | `risk_of_bias`, `applicability_concerns` |
| 7 | `eval_d3_outcome` — Evaluation D3: Outcome | q1–q4 | `risk_of_bias`, `applicability_concerns` |
| 8 | `eval_d4_analysis_apparent` — Evaluation D4: Analysis (apparent performance) | q1 gate, q2, q3, q4, q7 | `risk_of_bias` |
| 9 | `eval_d4_analysis_internal` — Evaluation D4: Analysis (internal validation) | q2–q7 | `risk_of_bias` |
| 10 | `eval_d4_analysis_external` — Evaluation D4: Analysis (external validation) | q2, q3, q4, q7 | `risk_of_bias` |

Field naming: `q<N>_<slug>`, `N` = question number within the source domain,
so the dictionary id maps mechanically (`dev_d1_q1` → section
`dev_d1_participants`, field `q1_appropriate_data_sources`). Triplicated
sections reuse identical names (the duplicate-name guard is scoped per entity
type). Slugs:

- D1 (both parts): `q1_appropriate_data_sources`, `q2_appropriate_study_design`,
  `q3_representative_dataset`
- D2 (both parts): `q1_similar_definition_assessment`, `q2_similar_preprocessing`,
  `q3_blind_to_outcome`, `q4_available_at_intended_use`
- D3 (both parts): `q1_appropriate_definition`, `q2_similar_definition_assessment`,
  `q3_blind_to_predictors`, `q4_appropriate_time_interval`
- Dev D4: `q1_reasonable_sample_size`, `q2_continuous_categorical_handling`,
  `q3_missing_censored_handling`, `q4_imbalance_recalibration`,
  `q5_overfitting_methods`
- Eval D4: `q1_apparent_only_avoided` (gate, apparent section only),
  `q2_reasonable_sample_size`, `q3_missing_censored_handling`,
  `q4_uncorrected_imbalance_evaluation`, `q5_data_leakage_avoided`
  (internal only), `q6_resampling_replicates_all_steps` (internal only),
  `q7_appropriate_performance_measures`

The instrument's per-type NA defaults (`d4_q5`/`d4_q6` are NA for apparent
and external) are expressed by **omission** — those fields simply do not
exist in sections 8 and 10. Signaling questions pass the module constant
`_PROBAST_SIGNALING` (`Y/PY/PN/N`) so the existing identity check sets
`allows_not_applicable=True` on all of them — matching the instrument, whose
value set includes NA universally. Judgment fields use `Low/High/Unclear`
with no disposition flags. Judgment labels are short — "Quality",
"Risk of bias", "Applicability concerns" — with the official judgment text
verbatim in `description` (signaling questions: official text as both label
and description, as `_signaling` already does). The gate
`q1_apparent_only_avoided` is answered once (in the apparent section, first
field) even when the study reports no apparent performance; its
`llm_description` says so explicitly.

## 2. Computed overalls (the calculated field — handle with care)

**Spec as data.** Seeded into the global template's `schema` JSONB (copied
verbatim by the project clone, which already copies `schema`):

```jsonc
"derived_judgments": [
  { "id": "dev_overall_quality", "label": "Overall quality (development)",
    "rule": "worst_domain",
    "inputs": [ {"section": "dev_d1_participants", "field": "quality_concern"},
                {"section": "dev_d2_predictors",   "field": "quality_concern"},
                {"section": "dev_d3_outcome",      "field": "quality_concern"},
                {"section": "dev_d4_analysis",     "field": "quality_concern"} ] },
  { "id": "dev_overall_applicability", "label": "Overall applicability (development)",
    "rule": "worst_domain",
    "inputs": [ D1–D3 dev `applicability_concerns` ] },
  { "id": "eval_overall_rob", "label": "Overall risk of bias (evaluation)",
    "rule": "worst_domain",
    "inputs": [ D1–D3 eval `risk_of_bias`,
                { "collapse": "worst_of",
                  "inputs": [ apparent/internal/external `risk_of_bias` ] } ] },
  { "id": "eval_overall_applicability", "label": "Overall applicability (evaluation)",
    "rule": "worst_domain",
    "inputs": [ D1–D3 eval `applicability_concerns` ] }
]
```

**One implementation.** New `backend/app/services/derived_judgment_service.py`
— a pure function over (spec, values-by-(section, field)) porting
`probast_judgment.py` semantics exactly, including its deliberate asymmetry:

- Severity order `Low < Unclear < High`.
- **Collapse step (`worst_of`, inside an input): lenient** — ignores
  empty/invalid members (unreported performance types don't count against);
  returns null only if *no* member is judged.
- **Overall step (`worst_domain`, across inputs): strict** — if *any* input
  is empty, a marker (`no_information`/`not_applicable`), or not in
  `{Low, High, Unclear}`, the overall is **null (incomplete), never Low**.
  One does not conclude low risk from an incomplete assessment.
- Values are read through `value_semantics.unwrap_value_envelope`; markers
  count as not-judged.

**Two consumers, zero duplicates:**

- **QA read payload:** the session/run read for `kind=quality_assessment`
  gains an optional typed block `derived_judgments:
  list[{id, label, value: Low|High|Unclear|null}] | null` (null when the
  template has no spec — classic PROBAST/QUADAS-2 payloads are unchanged).
  Computed over the value set the payload already returns to that viewer:
  per-reviewer during blind extract, canonical after consensus/finalize.
  Regenerate `frontend/types/api/*`.
- **Export:** for templates *with* a spec, the appraisal-summary sheet
  derives its overall row(s) from the same module — four labelled overall
  columns/rows replacing the legacy single worst-case "Overall"; templates
  without a spec keep today's behavior byte-for-byte.

**Frontend:** a dumb banner on the QA page (chips for the four overalls,
grouped Development / Evaluation, "—" when null, copy via `lib/copy/qa.ts`).
No rule logic in the frontend, ever.

## 3. Data-driven judgment rendering

`frontend/components/assessment/QASectionAccordion.tsx` replaces the
`SUMMARY_FIELD_NAMES` allowlist (`risk_of_bias`, `applicability_concerns`,
`overall_risk_of_bias`, `overall_applicability`) with: *select field whose
`allowed_values` is non-empty and ⊆ {low, high, unclear} (case-insensitive)*
— the same discriminant the export's `_is_verdict` applies. Classic
PROBAST/QUADAS-2 judgment fields all satisfy the rule, so they render
identically; the literal "Domain judgment" card title moves into
`lib/copy/qa.ts` while we're in the file.

## 4. In-blast-path fixes (not scope creep)

- **Clone drops ADR-0016 flags.** `TemplateCloneService` field copy omits
  `allows_not_applicable`/`allows_not_evaluated`, so every NA-enabled
  signaling question loses its "Not applicable" affordance the moment a
  project adopts the template — defeating section 1. Fix: copy both columns;
  add a clone test. Also repairs classic PROBAST and CHARMS clones.
- **QA prompt names the framework enum, not the instrument.** QA AI runs
  currently interpolate `template.framework` (`CUSTOM`) into "assessing a
  study using {label}". Pass `template.name` instead — runs say "using
  PROBAST+AI" — avoiding an `extraction_framework` enum migration entirely.

## 5. Tests

- Unit: `derived_judgment_service` — worst-domain table, strict
  incomplete→null, lenient D4 collapse, all-types-unreported → null,
  marker/invalid handling. Vectors match the dictionary's documented rules.
- Integration: seed test for PROBAST+AI (10 sections, 58 fields, flag and
  vocabulary assertions), modeled on `test_qa_seed.py` (name-scoped, so
  existing PROBAST assertions are untouched).
- Unit: add `seed_probast_ai` to the `test_seed_dispositions` parametrize.
- Unit: clone preserves both disposition flags.
- Frontend: accordion detection (judgment vs signaling partition incl.
  classic templates), overall banner rendering (values + null), copy keys.
- Contract: `npm run generate:api-types` output committed.

## 6. Non-goals

- No QA completeness/finalize gate (pre-existing gap, separate decision).
- No export rework for the second judgment axis (appraisal sheet keeps
  showing the primary judgment per section — known pre-existing limitation;
  the per-section tidy sheets still contain every field).
- No per-question AI prompt storage beyond `llm_description`; no
  `model_ref`/`driving_questions` output contract (future automation phase
  in the source methodology).
- No new reference doc; only this spec plus a one-row addition to
  `docs/how-to/seed-database.md`'s seeded-templates list.

## Delivery

- **PR1** — seed + clone-flags fix + prompt-name fix (+ their tests):
  template immediately usable end-to-end, minus overalls.
- **PR2** — derived overalls: rule module, QA payload block, export
  integration, banner, accordion detection (+ tests, type regen).
