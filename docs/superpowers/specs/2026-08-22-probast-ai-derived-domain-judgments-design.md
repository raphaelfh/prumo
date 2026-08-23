---
status: draft
last_reviewed: 2026-08-23
owner: '@raphaelfh'
---

# PROBAST+AI instrument-exact assessment flow — design

## Problem

The PROBAST+AI template (`00ba…0001`, seeded by `backend/app/seed_probast_ai.py`)
treats its domain judgments as ordinary input fields: reviewers type them,
and the LLM is asked to return them (its `llm_description` literally says
"aggregate the answers … of this domain's signaling questions"). The
official instrument works differently: describe boxes record the facts,
the signaling questions are the evidence-bearing inputs, the domain
judgment is *informed* by them and recorded by the assessor with a
rationale, and the overalls are mechanical roll-up tables. The app
should digitize exactly that process.

The instrument itself (fillable tool + E&E Light, read in full) is
mapped item-by-item in
[`docs/reference/templates/probast-ai-instrument.md`](../../reference/templates/probast-ai-instrument.md)
— the normative companion to this spec.

## Decisions (settled with the user)

1. **Instrument-exact flow** (revised from an earlier "strict computed,
   no override" direction): each domain Quality/RoB judgment gets a
   **derived default computed from the signaling questions**, and the
   assessor records the final rating, overriding only with a rationale —
   mirroring the official form's "Rationale of … rating" boxes.
2. **Discretion lives at the domain level only.** The four overalls stay
   100% computed — the official Step-4 tables ARE mechanical. The
   overall-reclassification possibility in the paper's prose is
   exercised by adjusting a domain judgment with rationale.
3. **Rationale fields seeded like the official form**: one per judgment
   (Quality/RoB and Applicability). UI requires a rationale when the
   recorded judgment diverges from the derived default.
4. **Evaluation D4 records ONE judgment** for the whole domain, as the
   official form does (the A/I/E columns belong to the signaling
   questions only). The per-type judgment fields of v1 are removed.
5. **The AI answers the descriptive and signaling layers only**:
   scope fields, describe boxes, signaling questions, applicability (+
   its rationale). Quality/RoB judgments, their rationales, and the
   Step-4 summaries are assessor-owned and excluded from the LLM call.
6. **The full form ships** (user decisions on the deep-read): the 18
   official describe boxes as optional AI-prefilled text fields; an
   `assessment_scope` section for Steps 2–3 (study-type classification +
   models/outcome of interest); the four Step-4 summary boxes beside the
   computed overalls. Step 1 (PICOTS, once per review) maps to the
   project template's ✨ instruction — documented, no new machinery.
7. The mechanism must be **adoptable by classic PROBAST and QUADAS-2 as
   a seed-data change** (§11).
8. Also in scope: verify signaling-question **evidence locate** on the
   QA screen (§7), per-SQ **traceability** of each derived default, and
   the **xlsx export review** (§8).

## Instrument fidelity

Grounded in the official tool (Suppl. Table 3) and E&E Light (Suppl.
Table 4), both read in full — see the instrument mapping doc for
citations:

- Domain rating: N/PN "flags the potential"; "you will need to use your
  judgement"; rationale box under every judgment. The E&E sanctions
  judging through an NI (items 1.3, 2.2, 2.3, 4.3) and even through a
  flagged N: eval 4.1 = N with a large development sample "may still be
  judged as low". → derived default + assessor decision + rationale.
  **Exact.**
- Step-4 overalls: mechanical tables, exactly worst-domain
  (`Low < Unclear < High`); "at least one domain high → high" does not
  require the other domains to be rated; each overall pairs with a
  summary box. → computed overalls + assessor summary fields. **Exact.**
- NA is official on only four conditional items (dev 4.4, eval 4.4,
  4.5, 4.6); domains 1–3 have no NA. → NA flags restricted. **Exact.**
- Applicability: direct Low/High/Unclear judgment on domains 1–3 of each
  part, no signaling questions, judged against the Step-1 PICOTS. →
  stored human+AI field with rationale. **Exact.**
- Eval D4: signaling questions per performance type; ONE domain
  judgment. → per-type SQ sections + one judgment section. **Exact**
  (documented layout deviations: A/I/E columns render as sections; the
  D4 describe boxes render beside the domain judgment).
- Copy rule: for apparent-only evaluations the dev D1–D3 signaling
  answers "can directly be copied" to eval D1–D3. Manual for now; a
  one-click affordance is a recorded follow-up (§Non-goals).

## 1. Derivation rule: `signaling_worst` (computes the DEFAULT)

New rule in `derived_judgment_service`, sibling of `worst_domain` /
`worst_of` (same `JUDGMENT_SEVERITY`, same marker/envelope helpers;
`_SUPPORTED_RULE` becomes a two-entry dispatch — an unknown rule still
resolves to None).

Per plain input coordinate (a signaling question), map the stored
answer, casefolded:

| stored answer | contribution |
|---|---|
| `y`, `py` | Low |
| `pn`, `n` | High |
| `unclear` (QUADAS-2 vocabulary) | Unclear |
| `no_information` marker | Unclear |
| any other absent-reason marker | excluded |
| unanswered, or a value outside the table | missing |

Collapse-group input (used only by eval D4, §2): evaluate the group's
members with the same mapping —

- every member unanswered/excluded → the group is **unreported** and is
  ignored (a study is not marked down for a validation type it never
  claimed to perform);
- any member High → the group contributes High;
- otherwise any member missing → the group is **in-progress** (see
  aggregation);
- otherwise worst of the members' contributions.

Aggregation across resolved inputs (precedence matters — High is
monotone, Low/Unclear are not):

1. any High (plain or group) → **High**.
2. else any missing plain input or in-progress group → **null**
   (incomplete; out-of-vocabulary values are deliberately "missing",
   never a silent Low).
3. else any Unclear → **Unclear**.
4. else nothing judged at all → **null**.
5. else → **Low**.

The eval-D4 gate needs no special-casing: it is a plain input of the D4
entry (not a group member), so gate=N fires a High default immediately
(the assessor may still override to Low per the E&E's large-sample
example — with rationale), and an internal-only study (gate=Y, apparent
group unreported) derives from the internal group alone.

`DerivedInput` rows for a `signaling_worst` entry carry the **raw
stored answer** (e.g. `"PN"`, a marker label, or null) — traceability
means showing which SQ caused the default in the reviewer's own
vocabulary. Group rows carry the group's `label` (performance type) and
its resolved contribution.

### Change to `worst_domain` (existing rule)

Adopt High-propagation: any input High → High even when other inputs
are unjudged; Low/Unclear remain completeness-gated. Matches the
official Step-4 tables. Deliberate behavior change for existing v1
runs' overalls (High + an unrated domain used to show "—").

## 2. Spec shape: recommendations with a target + computed overalls

`derived_judgments` (template `schema` JSONB) carries two kinds of
entries, distinguished by the presence of `target`:

```jsonc
[
  // 8 RECOMMENDATION entries — compute the derived DEFAULT for a stored
  // judgment field; `target`/`rationale` name the assessor-owned fields.
  { "id": "dev_d1_quality", "label": "Development D1: quality",
    "rule": "signaling_worst",
    "target":    {"section": "dev_d1_participants", "field": "quality_concern"},
    "rationale": {"section": "dev_d1_participants", "field": "quality_concern_rationale"},
    "inputs": [ {"section": "dev_d1_participants", "field": "q1_…"}, … ] },
  // … dev d2–d4 quality, eval d1–d3 rob …
  { "id": "eval_d4_rob", "label": "Evaluation D4: Analysis",
    "rule": "signaling_worst",
    "target":    {"section": "eval_d4_judgment", "field": "risk_of_bias"},
    "rationale": {"section": "eval_d4_judgment", "field": "risk_of_bias_rationale"},
    "inputs": [
      {"section": "eval_d4_analysis_apparent", "field": "q1_apparent_only_avoided"},
      { "collapse": "worst_of", "label": "Apparent performance",
        "inputs": [ apparent q2, q3, q4, q7 ] },
      { "collapse": "worst_of", "label": "Internal validation",
        "inputs": [ internal q2…q7 ] },
      { "collapse": "worst_of", "label": "External validation",
        "inputs": [ external q2, q3, q4, q7 ] } ] },
  // 4 OVERALL entries — unchanged rule, no target: plain worst_domain
  // over the STORED judgment coordinates. `summary` names the paired
  // assessor narrative field (Step-4 box) for UI pairing + AI exclusion.
  { "id": "eval_overall_rob", "label": "Overall risk of bias (evaluation)",
    "rule": "worst_domain",
    "summary": {"section": "overall_judgement", "field": "summary_rob_evaluation"},
    "inputs": [ {"section": "eval_d1_participants", "field": "risk_of_bias"}, …,
                {"section": "eval_d4_judgment",     "field": "risk_of_bias"} ] },
  // dev_overall_quality, dev/eval_overall_applicability likewise.
]
```

- **No `{"derived": …}` references, no two-layer evaluation** — overalls
  read the stored judgments (the assessor's record).
- `spec_coordinates` additionally walks `target`/`rationale`/`summary`
  so the dangling-reference warning covers them.
- The derived default is a RECOMMENDATION; it is never stored and never
  enters the overalls. The stored field is the record.

## 3. Assessor-owned fields and the LLM

The **LLM exclusion set** for a QA template is the union of every
entry's `target`, `rationale`, and `summary` coordinates — declared
data, no name conventions, generic for any adopting template. For v2
that is 20 fields: 8 judgments + 8 judgment rationales + 4 summaries.

- `section_extraction_service` filters those fields out of the pinned
  field list before building the output schema (all extract paths pass
  `fields_override` already). A section whose eligible list ends up
  empty is skipped — `build_output_models` already defines empty → no
  LLM call (the `overall_judgement` section is always skipped;
  `eval_d4_judgment` only its describes reach the AI).
- Scope fields, describe boxes, signaling questions, applicability and
  its rationale are all AI-proposable: the first three are descriptive
  extraction; applicability is the user's explicit decision.
- The `quality_assessment` prompt needs no change.

### Shared-pipeline modularity (invariants, not aspirations)

QA extraction is the SAME pipeline as data extraction — one
`section_extraction_service`, where `run.kind` only selects the prompt
pair and both prompts share one response shape. Everything else is
inherited: field-schema builder, proposal writes, evidence, engine
pinning, per-section repeat/model choice, per-proposal engine
provenance, ✨ template instruction (`general_instructions_for_version`
— where the Step-1 PICOTS lives, shared by every call). This design
must keep it that way:

- The exclusion filter is a pure helper over spec data (the
  `target`/`rationale`/`summary` coordinates), applied at the single
  point where `fields_override` is assembled. A template without a
  spec yields an empty exclusion set and passes through byte-identical.
- **No new `kind == "quality_assessment"` branch anywhere** in the
  extraction path; the filter is template-data-driven and kind-agnostic.
- Within a section, describes + SQs go to the model in ONE call (the
  instrument's describe-then-answer flow inside a single response);
  across sections there is no chaining — each call stands alone, which
  is what makes per-section repeat with a different model coherent.
- Regression guard (§12): an extraction-kind template with no spec
  reaches `build_output_models` with its field list unchanged — so
  future extraction-pipeline updates keep propagating to QA and
  vice versa.

## 4. Payload

`RunViewDerivedJudgment` gains nullable fields resolved by
`derived_judgment_payload` from the spec coordinates against the frozen
tree: `target_entity_type_id`, `target_field_id`, `rationale_field_id`,
`summary_field_id`. Recommendations carry the first three; overalls
carry only `summary_field_id`. v2 templates return 12 entries (8
recommendations + 4 overalls); v1 clones keep returning their own 4 —
their `schema_` copy is untouched. `values_for_derivation` (own values
while blind, published after reveal) applies unchanged, so each
reviewer's recommendations reflect their own SQ answers while blind.
Regenerate `frontend/types/api/*` (api-contract CI) and the
hand-mirrored `frontend/hooks/runs/types.ts`.

## 5. Seed: PROBAST+AI 2.0.0 under a NEW global UUID

A **new global template row** — template id
`00ba0000-0000-0000-0000-000000000002`, entity types reusing v1's
pattern with the final UUID group set to `…0002` — because the v1 id is
unreachable for existing projects: `TemplateClonesService.clone` dedupes
by `(project_id, global_template_id)` and heals only against the
clone's own active snapshot, and clones with runs are delete-RESTRICTed.
`seed_probast_ai` seeds only v2 from now on.

Structure: **13 sections, 95 fields** (v1: 10/58). Field order inside a
domain mirrors the form: describes → SQs → judgment → rationale →
(applicability describe → applicability → rationale).

| # | Section | Fields |
|---|---|---|
| 1 | `assessment_scope` | `study_type` (select: `development_only` / `evaluation_only` / `combination`, required), `models_of_interest`, `outcome_of_interest` (text, optional) — 3 |
| 2 | `dev_d1_participants` | `desc_data_sources`, q1–q3, `quality_concern` (+rationale), `desc_setting_dates`, `applicability_concerns` (+rationale) — 9 |
| 3 | `dev_d2_predictors` | `desc_predictors`, q1–q4, judgment+rationale, applicability+rationale — 9 |
| 4 | `dev_d3_outcome` | `desc_outcome`, q1–q4, judgment+rationale, `desc_outcome_timing`, applicability+rationale — 10 |
| 5 | `dev_d4_analysis` | `desc_sample_numbers`, `desc_model_development`, `desc_performance_measures`, `desc_missing_data`, q1–q5, `quality_concern`+rationale — 11 |
| 6–8 | `eval_d1_participants` / `eval_d2_predictors` / `eval_d3_outcome` | same shapes as 2–4 with `risk_of_bias` — 9, 9, 10 |
| 9 | `eval_d4_analysis_apparent` | gate `q1_apparent_only_avoided`, q2, q3, q4, q7 — 5 |
| 10 | `eval_d4_analysis_internal` | q2–q7 — 6 |
| 11 | `eval_d4_analysis_external` | q2, q3, q4, q7 — 4 |
| 12 | `eval_d4_judgment` | `desc_sample_numbers`, `desc_performance_measures`, `desc_excluded_participants`, `desc_missing_data`, `risk_of_bias`+rationale — 6 |
| 13 | `overall_judgement` | `summary_quality_development`, `summary_rob_evaluation`, `summary_applicability_development`, `summary_applicability_evaluation` — 4 |

Content rules:

- Describe boxes: `field_type='text'`, optional, official prompt as
  label/description, `llm_description` phrased as descriptive
  extraction. Duplicate names across sections are fine (the name guard
  is per entity type).
- Rationales: `field_type='text'`, optional, named
  `<judgment>_rationale`, labeled after the official boxes.
- **NA restricted to the instrument's four conditional items** (6 field
  rows after triplication: dev-D4 `q4_imbalance_recalibration`; eval-D4
  `q4_uncorrected_imbalance_evaluation` ×3; internal-only
  `q5_data_leakage_avoided`, `q6_resampling_replicates_all_steps`). The
  other 36 signaling rows drop `allows_not_applicable`;
  `_ANSWER_INSTRUCTION` gets with/without-NA variants.
- **Quality/RoB judgment fields, their rationales and the summaries
  carry no `llm_description`** (excluded from the AI);
  **applicability `llm_description` rewritten** as the first-order
  match-to-review-question judgment it is (leaning on the project's ✨
  instruction/PICOTS), and descriptions restore the official
  "the assessor's intended use" wording.
- `derived_judgments` per §2; `version="2.0.0"`; template description
  states the flow: describe → answer → judge (derived default +
  rationale on divergence), computed overalls.

## 6. Frontend

- `QASectionAccordion` judgment card, per judgment with a
  recommendation (matched via `target_field_id`):
  - a **derived-default chip** with the per-SQ breakdown (raw answers;
    causing rows highlighted; D4 shows per-type group rows);
  - **Apply** sets the stored field through the normal value flow;
  - the judgment `FieldInput` stays editable; when its value diverges
    from the derived default, the card shows a divergence state and the
    **UI requires the paired rationale** before dispatching the save —
    client-side gate; the backend stays permissive (documented).
  - Applicability + its rationale + describes render as ordinary
    editable fields with the AI suggestion flow.
- `overall_judgement` section renders each summary field next to its
  computed overall value (matched via `summary_field_id`); the
  `OverallJudgmentBanner` keeps rendering entries with null
  `target_field_id`.
- `assessment_scope` renders first; its `study_type` may badge which
  parts apply (display hint only — no gating).
- AI affordances (suggestion badge, section AI button) hide for
  excluded fields / sections whose fields are all excluded.
- Copy via `lib/copy/qa.ts`; presentation-only color mapping for raw
  answers. No rule logic in the frontend.
- **Evidence locate**: SQ rows already render the shared
  `AISuggestionReviewPopover` (locate included) via `FieldInput`.
  Verify on the QA screen with the design-review loop; fix if broken.

## 7. Consensus and lifecycle

Unchanged mechanics: every stored field (scope, describes, SQs,
judgments, rationales, summaries) goes through blind fill, consensus,
finalize and completion gates as today (text fields are optional, so
gates don't block on them). What changes is only where judgment values
come from: an assessor decision informed by a visible derived default
instead of a blank dropdown or an AI guess.

## 8. Export (xlsx)

- Stored judgments remain the record and the appraisal sheet's domain
  columns: `_is_verdict` picks them per section as today; the three D4
  type sections and `assessment_scope`/`overall_judgement` contribute
  no column (no risk-vocabulary select), `eval_d4_judgment` contributes
  the single D4 verdict. Text fields (describes, rationales, summaries)
  stay in the tidy per-section sheets.
- Derived columns: only entries **without `target`** (the 4 overalls) —
  one filter in `_build_appraisal_model`/`appraisal_summary`
  (recommendations are advice, not record).
- Per-reviewer derived columns: not added (status quo).
- Screen↔workbook parity: same rule module; extend
  `test_derived_overall_screen_workbook_parity` to `signaling_worst`.

## 9. Observability

- `qa_derived_spec_dangling_ref` extends to `target`/`rationale`/
  `summary` coordinates.
- The export path gains the same warning when spec coordinates don't
  resolve (today it silently blanks columns).
- A user-visible "spec doesn't match template" indicator stays a
  recorded **non-goal** (logs only, as today).

## 10. Rollout

- Local: `make db-fresh` (seed now creates v2 only). Coordinate with
  peer sessions before wiping the shared local stack.
- Prod (test-only data): run the seed to insert v2; one manual UPDATE
  renames the v1 global row to "PROBAST+AI (v1 — superseded)" (the
  global model has no active flag). **Never touch project clone rows or
  their `schema_`.**
- Existing projects keep their v1 clone and behavior (except the §1
  `worst_domain` High-propagation, which is shared rule code); to adopt
  v2 they import the new template and select it as the active QA
  template. Old runs stay on v1.

## 11. Adoption recipe for the other QA templates (mapeamento)

Adopting the instrument-exact flow for classic PROBAST (`00b0`) and
QUADAS-2 (`00d0`) is a seed-data change per template, no new code:

1. Add `derived_judgments`: one `signaling_worst` recommendation per
   domain (target = the existing stored judgment field; seed a rationale
   field and name it in `rationale`), plus `worst_domain` overalls over
   the stored judgment coordinates (replacing any stored overall
   fields; add `summary` fields if the instrument has them).
2. Optionally seed that instrument's describe boxes the same way.
3. New global UUID + republish story identical to §10.

Template-specific notes, from the instrument review:

- **Classic PROBAST**: official scale is Y/PY/PN/N/NI with **no NA
  anywhere** — its seed's universal `allows_not_applicable` is the same
  loophole fixed here and must be removed when it migrates. Its official
  overall-Low footnote (no external validation → consider downgrading)
  is discretionary prose; the assessor exercises it through domain
  rationale, as with PROBAST+AI's reclassification.
- **QUADAS-2**: SQ vocabulary Y/N/Unclear — the answer `unclear` is
  already in the §1 mapping. QUADAS-2 officially has **no overall
  roll-up** (it warns against summary scores): seed it with
  recommendation entries only and no overall entries; a computed
  overall there would be an app convention, deliberately not added.

## 12. Tests

- Unit (`derived_judgment_service`): mapping table incl. `unclear`;
  High-propagation through missing (both rules); Unclear
  completeness-gating; group semantics (unreported vs in-progress vs
  judged; gate as plain input); all-excluded → null; out-of-vocabulary
  → null; raw-answer breakdown values; `target`/`rationale`/`summary`
  in `spec_coordinates`.
- Seed: counts (13 sections / 95 fields), NA flags on exactly 6 rows,
  excluded fields carry no `llm_description`, describes/rationales/
  summaries optional, `study_type` required, spec resolves
  (inputs/target/rationale/summary → seeded fields), new UUIDs.
- LLM exclusion: excluded fields never reach `build_output_models`; the
  `overall_judgement` section skips the call; describes + applicability
  + rationale still included. Modularity guard: a spec-less
  extraction template passes the filter byte-identical, and no
  QA-kind branch exists in the extraction path (grep-able assertion).
- Payload: target/rationale/summary id resolution, 12 entries for v2 /
  4 for v1-shaped specs, blind vs revealed unchanged.
- Export: D4 type + scope + overall sections contribute no verdict
  column, `eval_d4_judgment` does; derived columns = overalls only;
  parity for `signaling_worst`; dangling warning on the export path.
- Frontend: chip + apply + divergence-requires-rationale, banner
  filter, summaries beside overalls, AI affordances hidden on excluded
  fields/sections, copy keys; update existing QA suites (seed counts,
  dispositions assertions, appraisal resolution, run-view derived
  judgments).
- Manual/design-review: evidence locate on the QA screen (§6).

## Non-goals

- Overall-level override (discretion is domain-level).
- One-click "copy dev D1–D3 answers to eval D1–D3" for apparent-only
  studies (instrument-sanctioned; recorded follow-up).
- Structured per-review PICOTS storage (Step 1 lives in the project
  template's ✨ instruction, documented in the instrument mapping doc).
- Migrating classic PROBAST / QUADAS-2 seeds now (§11 is the recipe).
- Per-reviewer derived columns in the export.
- User-visible dangling-spec indicator (§9, logs only).
- Backend enforcement of divergence-rationale (UI-level; backend stays
  permissive).
- Any Alembic migration — entirely seed/data + rule code.
