---
status: draft
last_reviewed: 2026-08-22
owner: '@raphaelfh'
---

# PROBAST+AI instrument-exact assessment flow — design

## Problem

The PROBAST+AI template (`00ba…0001`, seeded by `backend/app/seed_probast_ai.py`)
treats its domain judgments as ordinary input fields: reviewers type them,
and the LLM is asked to return them (its `llm_description` literally says
"aggregate the answers … of this domain's signaling questions"). The
official instrument works differently: the signaling questions are the
evidence-bearing inputs; the domain judgment is *informed* by them and
recorded by the assessor with a rationale; the overalls are mechanical
roll-up tables. The app should digitize exactly that process.

## Decisions (settled with the user)

1. **Instrument-exact flow** (revised from an earlier "strict computed, no
   override" direction after the deep-read of the official tool): each
   domain Quality/RoB judgment gets a **derived default computed from the
   signaling questions**, and the assessor records the final rating,
   overriding only with a rationale — mirroring the official form's
   "Rationale of … rating" boxes.
2. **Discretion lives at the domain level only.** The four overalls stay
   100% computed — the official Step-4 tables ARE mechanical. The
   overall-reclassification possibility mentioned in the paper's prose is
   exercised by adjusting a domain judgment with rationale.
3. **Rationale fields are seeded like the official form**: one per
   judgment (Quality/RoB and Applicability). UI requires a rationale when
   the recorded judgment diverges from the derived default.
4. **Evaluation D4 records ONE judgment** for the whole domain, as the
   official form does (the apparent/internal/external columns belong to
   the signaling questions only). The per-type judgment fields of v1 are
   removed.
5. **The AI answers signaling questions and applicability only** (user
   decision: applicability keeps AI proposals — it is a first-order
   judgment with no signaling questions, not a derivable one). Judgment
   and judgment-rationale fields are excluded from the LLM call.
6. The mechanism must be **adoptable by classic PROBAST and QUADAS-2 as a
   seed-data change** (§11).
7. Also in scope: verify signaling-question **evidence locate** on the QA
   screen (§7), per-SQ **traceability** of each derived default (§4, §6),
   and the **xlsx export review** (§8).

## Instrument fidelity

Grounded in the official publication (Moons et al., BMJ 2025;388:e082505 +
supplementary tool documents; PROBAST 2019 form; QUADAS-2 background doc):

- Domain rating: N/PN "flags the potential" for a high concern; an N
  "does not automatically result in" High; the assessor judges, with a
  rationale box under every judgment. → derived default + assessor
  decision + rationale (§3–§5). **Exact.**
- Step-4 overalls: mechanical tables, exactly worst-domain
  (`Low < Unclear < High`); "at least one domain high → high" does not
  require the other domains to be rated. → computed overalls with High
  propagating through unrated domains (§2). **Exact.**
- NA is official on only four conditional items (dev 4.4, eval 4.4, 4.5,
  4.6); domains 1–3 have no NA. → NA flags restricted (§5). **Exact.**
- Applicability: direct Low/High/Unclear judgment on domains 1–3 of each
  part, no signaling questions. → stays a stored, human+AI field with a
  rationale box. **Exact.**
- Eval D4: signaling questions answered per performance type; ONE domain
  judgment. → per-type SQ sections + one judgment section (§5). **Exact**
  (the three type *sections* are a presentation of the form's three
  answer columns, not a semantic change).
- Remaining documented convention: overall-level reclassification (paper
  prose) is channeled through domain-level rationale, keeping
  overall×domain contradiction unrepresentable.

## 1. Derivation rule: `signaling_worst` (computes the DEFAULT)

New rule in `derived_judgment_service`, sibling of `worst_domain` /
`worst_of` (same `JUDGMENT_SEVERITY`, same marker/envelope helpers;
`_SUPPORTED_RULE` becomes a two-entry dispatch — an unknown rule still
resolves to None).

Per plain input coordinate (a signaling question), map the stored answer,
casefolded:

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
entry (not a group member), so gate=N fires High immediately, and an
internal-only study (gate=Y, apparent group unreported) derives from the
internal group alone.

`DerivedInput` rows for a `signaling_worst` entry carry the **raw stored
answer** (e.g. `"PN"`, a marker label, or null) — traceability means
showing which SQ caused the default in the reviewer's own vocabulary.
Group rows carry the group's `label` (performance type) and its resolved
contribution.

### Change to `worst_domain` (existing rule)

Adopt High-propagation: any input High → High even when other inputs are
unjudged; Low/Unclear remain completeness-gated. Matches the official
Step-4 tables ("at least one … → high"). Deliberate behavior change for
existing v1 runs' overalls (High + an unrated domain used to show "—").

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
  // over the STORED judgment coordinates (the D4 collapse of v1 dies —
  // there is one stored D4 judgment now).
  { "id": "eval_overall_rob", "label": "Overall risk of bias (evaluation)",
    "rule": "worst_domain",
    "inputs": [ {"section": "eval_d1_participants", "field": "risk_of_bias"}, …,
                {"section": "eval_d4_judgment",     "field": "risk_of_bias"} ] },
  // dev_overall_quality, dev/eval_overall_applicability likewise (coords).
]
```

- **No `{"derived": …}` references, no two-layer evaluation** — overalls
  read the stored judgments (the assessor's record), exactly as today.
- `spec_coordinates` additionally walks `target`/`rationale` so the
  dangling-reference warning covers them.
- The derived default is a RECOMMENDATION; it is never stored and never
  enters the overalls. The stored field is the record.

## 3. Assessor-owned fields and the LLM

The **LLM exclusion set** for a QA template is the union of every
recommendation entry's `target` and `rationale` coordinates — declared
data, no name conventions, generic for any adopting template.

- `section_extraction_service` filters those fields out of the pinned
  field list before building the output schema (all extract paths pass
  `fields_override` already). A section whose eligible list ends up empty
  is skipped — `build_output_models` already defines empty → no LLM call.
- Applicability (value AND its rationale box) is NOT in the exclusion
  set: the AI proposes a rating + rationale pair and the human reviews —
  the user's explicit decision.
- The `quality_assessment` prompt needs no change.

## 4. Payload

`RunViewDerivedJudgment` gains three nullable fields resolved by
`derived_judgment_payload` from the spec coordinates against the frozen
tree: `target_entity_type_id`, `target_field_id`, `rationale_field_id`.
Overalls carry nulls (the banner filter). v2 templates return 12 entries
(8 recommendations + 4 overalls); v1 clones keep returning their own 4 —
their `schema_` copy is untouched. `values_for_derivation` (own values
while blind, published after reveal) applies unchanged, so each
reviewer's recommendations reflect their own SQ answers while blind.
Regenerate `frontend/types/api/*` (api-contract CI) and the hand-mirrored
`frontend/hooks/runs/types.ts`.

## 5. Seed: PROBAST+AI 2.0.0 under a NEW global UUID

A **new global template row** — template id
`00ba0000-0000-0000-0000-000000000002`, entity types reusing v1's pattern
with the final UUID group set to `…0002` — because the v1 id is
unreachable for existing projects: `TemplateClonesService.clone` dedupes
by `(project_id, global_template_id)` and heals only against the clone's
own active snapshot, and clones with runs are delete-RESTRICTed.
`seed_probast_ai` seeds only v2 from now on.

Structure: **11 sections, 70 fields** (v1: 10/58).

- Sections 1–10 as v1, plus section 11 `eval_d4_judgment` ("Evaluation
  D4: Analysis — domain judgment"): holds the single domain `risk_of_bias`
  judgment + its rationale, covering all reported performance types. The
  three D4 type sections lose their per-type judgment fields.
- 42 signaling questions (unchanged texts; gate stays in the apparent
  section, as the official 4.1 single row).
- 14 stored judgments: dev `quality_concern` ×4, dev/eval
  `applicability_concerns` ×6, eval `risk_of_bias` D1–D3 ×3 + D4 ×1.
- 14 rationale fields, `field_type='text'`, `is_required=False`, named
  `<judgment>_rationale`, labeled after the official boxes ("Rationale of
  quality rating", "Rationale of risk of bias rating", applicability
  rationale).
- **NA restricted to the instrument's four conditional items** (6 field
  rows after triplication: dev-D4 `q4_imbalance_recalibration`; eval-D4
  `q4_uncorrected_imbalance_evaluation` ×3; internal-only
  `q5_data_leakage_avoided`, `q6_resampling_replicates_all_steps`). The
  other 36 signaling rows drop `allows_not_applicable`;
  `_ANSWER_INSTRUCTION` gets with/without-NA variants. Closes the
  loophole where a universal NA silently deletes a question from the
  derivation.
- **Quality/RoB judgment fields drop their `llm_description`** (excluded
  fields need none);
  **applicability `llm_description` rewritten** as the first-order
  match-to-review-question judgment it is (lean on the project's general
  instructions when present), and descriptions restore the official
  "the assessor's intended use" wording.
- `derived_judgments` per §2; `version="2.0.0"` (nothing parses it);
  template description states the flow: derived defaults + assessor
  decision with rationale, computed overalls.

## 6. Frontend

- `QASectionAccordion` judgment card, per judgment with a recommendation
  (matched via `target_field_id`):
  - a **derived-default chip** ("derivado das signaling questions") with
    the per-SQ breakdown (raw answers; causing rows highlighted; D4 shows
    per-type group rows);
  - **Apply** sets the stored field through the normal value flow (a
    human decision, normal provenance);
  - the judgment `FieldInput` stays editable; when its value diverges
    from the derived default, the card shows a divergence state and the
    **UI requires the paired rationale** (`rationale_field_id`) before
    dispatching the save — client-side gate; the backend stays
    permissive (documented).
  - Applicability + its rationale render as ordinary editable fields with
    the AI suggestion flow.
- AI affordances (suggestion badge, section AI button) hide for excluded
  fields / for sections whose fields are all excluded (the payload's
  target/rationale ids are the source).
- `OverallJudgmentBanner`: renders entries with null `target_field_id`
  (the 4 overalls) — unchanged look.
- Copy via `lib/copy/qa.ts` (chip, divergence message, incomplete "—"
  wording covering "not reported / not finished"); presentation-only
  color mapping for raw answers. No rule logic in the frontend.
- **Evidence locate**: SQ rows already render the shared
  `AISuggestionReviewPopover` (locate included) via `FieldInput`. Verify
  on the QA screen with the design-review loop; fix if broken —
  acceptance criterion, not new machinery.

## 7. Consensus and lifecycle

Unchanged mechanics: judgments and rationales are ordinary stored fields
— blind fill, consensus, finalize, completion gates all work as today
(rationales are optional, so gates don't block on them). What changes is
only where their values come from: an assessor decision informed by a
visible derived default instead of a blank dropdown or an AI guess.

## 8. Export (xlsx)

- Stored judgments remain the record and the appraisal sheet's domain
  columns: `_is_verdict` picks them per section as today; the three D4
  type sections simply stop contributing a column (no judgment field) and
  `eval_d4_judgment` contributes the single D4 verdict. **No relabeling
  needed** — every section's first risk-vocabulary select is again the
  domain judgment.
- Derived columns: only entries **without `target`** (the 4 overalls) —
  one filter in `_build_appraisal_model`/`appraisal_summary`
  (recommendations are advice, not record; today's code would render all
  12). Rationale text fields don't match `_is_verdict` and stay in the
  tidy per-section sheets.
- Per-reviewer derived columns: not added (status quo; per-reviewer SQ
  detail lives in the matrix sheets).
- Screen↔workbook parity: same rule module; extend
  `test_derived_overall_screen_workbook_parity` to `signaling_worst`.

## 9. Observability

- `qa_derived_spec_dangling_ref` extends to `target`/`rationale`
  coordinates.
- The export path gains the same warning when spec coordinates don't
  resolve (today it silently blanks columns).
- A user-visible "spec doesn't match template" indicator stays a
  recorded **non-goal** (logs only, as today).

## 10. Rollout

- Local: `make db-fresh` (seed now creates v2 only).
- Prod (test-only data): run the seed to insert v2; one manual UPDATE
  renames the v1 global row to "PROBAST+AI (v1 — superseded)" (the global
  model has no active flag). **Never touch project clone rows or their
  `schema_`.**
- Existing projects keep their v1 clone and behavior (except the §1
  `worst_domain` High-propagation, which is shared rule code); to adopt
  v2 they import the new template and select it as the active QA
  template. Old runs stay on v1.

## 11. Adoption recipe for the other QA templates (mapeamento)

Adopting the instrument-exact flow for classic PROBAST (`00b0`) and
QUADAS-2 (`00d0`) is a seed-data change per template, no new code:

1. Add `derived_judgments`: one `signaling_worst` recommendation per
   domain (target = the existing stored judgment field; add a rationale
   field and name it in `rationale`), plus `worst_domain` overalls over
   the stored judgment coordinates (replacing any stored overall fields).
2. Seed the rationale fields; drop stored overall fields if present.
3. New global UUID + republish story identical to §10.

Template-specific notes, from the instrument review:

- **Classic PROBAST**: official scale is Y/PY/PN/N/NI with **no NA
  anywhere** — its seed's universal `allows_not_applicable` is the same
  loophole fixed here and must be removed when it migrates. Its official
  overall-Low footnote (no external validation → consider downgrading)
  is discretionary prose; with domain-level rationale the assessor
  exercises it the same way as PROBAST+AI's reclassification.
- **QUADAS-2**: SQ vocabulary Y/N/Unclear — the answer `unclear` is
  already in the §1 mapping. QUADAS-2 officially has **no overall
  roll-up** (it warns against summary scores): seed it with
  recommendation entries only and no overall entries; a computed overall
  there would be an app convention, deliberately not added.

## 12. Tests

- Unit (`derived_judgment_service`): mapping table incl. `unclear`;
  High-propagation through missing (both rules); Unclear
  completeness-gating; group semantics (unreported vs in-progress vs
  judged; gate as plain input); all-excluded → null; out-of-vocabulary →
  null; raw-answer breakdown values; target/rationale in
  `spec_coordinates`.
- Seed: counts (11 sections / 70 fields), NA flags on exactly 6 rows,
  judgment fields carry no `llm_description`, rationale fields optional,
  spec resolves (inputs/target/rationale → seeded fields), new UUIDs.
- LLM exclusion: excluded fields never reach `build_output_models`; a
  fully-excluded section skips the call; applicability + rationale still
  included.
- Payload: target/rationale id resolution, 12 entries for v2 / 4 for
  v1-shaped specs, blind vs revealed unchanged.
- Export: D4 type sections contribute no column, `eval_d4_judgment`
  does; derived columns = overalls only; parity for `signaling_worst`;
  dangling warning on the export path.
- Frontend: chip + apply + divergence-requires-rationale, banner filter
  (`target_field_id == null`), AI affordances hidden on excluded
  fields/sections, copy keys; update existing QA suites (seed counts,
  dispositions assertions, appraisal resolution, run-view derived
  judgments).
- Manual/design-review: evidence locate on the QA screen (§6).

## Non-goals

- Overall-level override (discretion is domain-level; §Decisions 2).
- Migrating classic PROBAST / QUADAS-2 seeds now (§11 is the recipe).
- Per-reviewer derived columns in the export.
- User-visible dangling-spec indicator (§9, logs only).
- Backend enforcement of divergence-rationale (UI-level; backend stays
  permissive).
- Any Alembic migration — entirely seed/data + rule code.
