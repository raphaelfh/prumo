---
status: draft
last_reviewed: 2026-08-22
owner: '@raphaelfh'
---

# PROBAST+AI derived domain judgments — design

## Problem

The PROBAST+AI template (`00ba…0001`, seeded by `backend/app/seed_probast_ai.py`)
stores its 16 domain judgments as ordinary select fields. The 10 Quality /
Risk-of-bias judgments are a function of the domain's signaling-question
answers, yet today they are filled manually by reviewers AND sent to the LLM,
whose `llm_description` literally instructs it to "aggregate the answers …
of this domain's signaling questions". A computed quantity treated as an
input can contradict its own inputs — the exact failure the computed
overalls were built to prevent.

## Decisions (settled with the user)

1. **Domain Quality/RoB judgments become computed** from the signaling
   questions — strict, **no human override**. They leave the form and the
   LLM call entirely.
2. **Applicability (6 fields) stays stored**: human-entered, with AI
   proposals. The instrument gives applicability no signaling questions —
   it is a first-order judgment of match to the review question, not a
   derivable one.
3. **The AI answers only what remains**: signaling questions +
   applicability. No new filter in `section_extraction_service` — the
   removed fields simply no longer exist.
4. The mechanism must be **adoptable by the other QA templates (classic
   PROBAST, QUADAS-2) as a pure seed-data change** (§10).
5. Deliverables also include: verify signaling-question **evidence locate**
   works on the QA screen (§6), per-SQ **traceability** of each computed
   judgment (§4, §6), and an **xlsx export review** (§7).

## Instrument fidelity — documented deviation

Deep-read of the official instrument (Moons et al., BMJ 2025;388:e082505 +
supplementary tool documents; PROBAST 2019 form; QUADAS-2 background doc)
established:

- Officially, an N/PN answer "flags the potential" for a high concern and
  the final domain rating is discretionary ("use your judgement"); an N
  "does not automatically result in" a High rating. The same discretion
  exists at Step 4 (overall reclassification).
- The Step-4 overall tables are exactly worst-domain
  (`Low < Unclear < High`), and "at least one domain high → high" does
  **not** require the other domains to be rated.
- NA is official on only **four conditional items**: dev 4.4, eval 4.4,
  eval 4.5, eval 4.6. Domains 1–3 have no NA at all.
- Applicability is judged for domains 1–3 of each part, Low/High/Unclear,
  with no signaling questions — a direct judgment.
- Splitting evaluation D4 into per-performance-type sections with per-type
  judgments is an app extension; the official form answers the signaling
  questions per type but records ONE domain judgment. Our lenient
  `worst_of` collapse restores the official single value before Step 4.

**Deviation, deliberately accepted:** prumo computes the domain judgment
mechanically (a *strict reading*: it can only rate a domain equal to or
worse than an assessor would, never better). This is documented in the
template description, in this spec, and in the adoption recipe (§10) —
not hidden. Rationale: reproducibility, contradiction-unrepresentable,
and the user's explicit decision against an override mechanism.

## 1. Derivation rule: `signaling_worst`

New rule in `derived_judgment_service`, sibling of `worst_domain` /
`worst_of` (same `JUDGMENT_SEVERITY`, same marker helpers; `_SUPPORTED_RULE`
becomes a two-entry dispatch so an unknown rule still resolves to None).

Per input coordinate (a signaling question), map the stored answer,
casefolded:

| stored answer | contribution |
|---|---|
| `y`, `py` | Low |
| `pn`, `n` | High |
| `unclear` (QUADAS-2 vocabulary) | Unclear |
| `no_information` marker | Unclear |
| any other absent-reason marker (`not_applicable`, `not_evaluated`) | excluded |
| unanswered, or a value outside the table | missing |

Aggregation (precedence matters — High is monotone, Low/Unclear are not):

1. any contribution High → **High** (fires even with missing siblings:
   more answers can only sustain or worsen it — matches the official
   "at least one … → high").
2. else any missing → **null** (incomplete; a value outside the vocabulary
   is deliberately "missing", never silently Low).
3. else any Unclear → **Unclear**.
4. else if every input was excluded → **null** (nothing to judge — matches
   `worst_of`'s empty-set behavior).
5. else → **Low**.

This also resolves the eval-D4 gate without special-casing: an
internal-validation-only study leaves the apparent section's q2–q7 blank →
apparent domain null → the collapse ignores it; an apparent-only study
answers the gate N → High fires immediately.

`DerivedInput` rows for a `signaling_worst` entry carry the **raw stored
answer** (e.g. `"PN"`, the marker label, or null) — traceability means
showing which SQ caused the judgment in the reviewer's own vocabulary,
not the mapped contribution.

### Change to `worst_domain` (existing rule, both template generations)

Adopt the same High-propagation: any input High → High even when other
inputs are unjudged; Low/Unclear remain completeness-gated ("one does not
conclude low risk from an unfinished assessment" still holds — only the
monotone verdict propagates). This is a deliberate behavior change for
existing v1 runs' overalls (a High + an unrated domain used to show "—",
now shows High) and is more faithful to the official Step-4 tables.

## 2. Spec shape: two layers via `{"derived": "<id>"}` references

`derived_judgments` (template `schema` JSONB) gains 10 domain entries and
rewires 2 of the 4 overalls:

```jsonc
[
  { "id": "dev_d1_quality", "label": "Development D1: quality",
    "rule": "signaling_worst",
    "inputs": [ {"section": "dev_d1_participants", "field": "q1_…"}, … ] },
  // … 9 more domain entries (dev d1–d4 quality; eval d1–d3 + d4×3 rob) …
  { "id": "dev_overall_quality", "rule": "worst_domain",
    "inputs": [ {"derived": "dev_d1_quality"}, … ] },
  { "id": "eval_overall_rob", "rule": "worst_domain",
    "inputs": [ {"derived": "eval_d1_rob"}, {"derived": "eval_d2_rob"},
                {"derived": "eval_d3_rob"},
                { "collapse": "worst_of", "label": "Evaluation D4: Analysis",
                  "inputs": [ {"derived": "eval_d4_apparent_rob"}, … ] } ] },
  // applicability overalls unchanged: (section, field) coordinate inputs
]
```

- `compute_derived_judgments` evaluates in spec order, accumulating results
  by id; `_resolve_input` gains a `derived` branch (valid inside collapse
  groups too). A forward or unknown ref resolves to None **and is logged**
  (§8) — fails loudly, per the module's own convention.
- `_input_identity` for a ref names the referenced entry by looking up its
  `label` in the spec, so the overall's breakdown rows are never blank.
- `spec_coordinates` learns to skip ref items (they carry no coordinate)
  and to return ref ids separately for validation.
- **No `"section"` key on spec entries.** The payload infers the anchor
  (§5): an entry whose inputs all live in one section belongs to that
  section; anything else (overalls) is global. One source of truth — the
  coordinates.

## 3. Seed: PROBAST+AI 2.0.0 under a NEW global UUID

A **new global template row** — template id
`00ba0000-0000-0000-0000-000000000002`, entity types reusing v1's
first-group pattern with the final group set to `…0002`
(`00ba0001-0000-0000-0000-000000000002` … `00ba000a-…-0002`) — because the
v1 UUID is unreachable for existing projects: `TemplateClonesService.clone`
dedupes by `(project_id, global_template_id)` and heals only against the
clone's own active snapshot, and clones with runs are delete-RESTRICTed.
Keeping the id would freeze every project that ever imported v1 out of the
fix. `seed_probast_ai` seeds only v2 from now on.

Content changes relative to v1:

- **58 → 48 fields**: the 10 Quality/RoB `_judgment_field` rows are not
  seeded. Applicability rows remain.
- **NA restricted to the instrument's four conditional items** (6 field
  rows after triplication: dev-D4 `q4_imbalance_recalibration`; eval-D4
  `q4_uncorrected_imbalance_evaluation` ×3; internal-only
  `q5_data_leakage_avoided`, `q6_resampling_replicates_all_steps`).
  The other 36 signaling rows drop `allows_not_applicable`;
  `_ANSWER_INSTRUCTION` gets with/without-NA variants. Closes the loophole
  where a universal NA silently deletes a question from the computation.
- **Applicability `llm_description` rewritten**: it is a first-order
  judgment of whether participants/predictors/outcome match the review
  question and the assessor's intended use (lean on the project's general
  instructions when present) — the current text wrongly instructs SQ
  aggregation. Description text also restores the official
  "the assessor's intended use" wording.
- `derived_judgments` spec per §2; `version="2.0.0"` (cosmetic — nothing
  parses it); template description states: overalls AND domain
  Quality/RoB judgments are computed (strict derivation, documented
  deviation), per-type D4 judgments are an app extension.

## 4. Payload

`RunViewDerivedJudgment` gains `section: str | null` (the inferred anchor,
§2). `derived_judgments` now returns 14 entries for v2 templates (10
domain + 4 overall); v1 clones keep returning 4 — their own `schema_` copy
is untouched. `values_for_derivation` (own values while blind, published
after reveal) applies unchanged to the new entries; a reviewer's domain
chips reflect their own answers while blind. Regenerate
`frontend/types/api/*` (api-contract CI) and the hand-mirrored
`frontend/hooks/runs/types.ts`.

## 5. Frontend

- `OverallJudgmentBanner` renders only entries with `section == null`
  (unchanged look: the 4 overalls, whose per-domain breakdown now names
  the derived domain entries).
- `QASectionAccordion`: the summary card shows, for its section's derived
  entry, a **read-only judgment chip + per-SQ breakdown** (each SQ label
  with its raw answer; the row(s) that caused the verdict highlighted).
  Applicability keeps rendering as an editable `FieldInput` with AI
  suggestion flow. D4 sections (no stored judgment left) still show the
  card — chip only.
- Copy via `lib/copy/qa.ts`: chip title, "computed from the signaling
  questions (strict reading)" explainer, incomplete state ("—") wording
  that covers both "not reported" and "not finished";
  `overallExplainRule` reworded.
- Presentation-only color mapping for raw answers (N/PN destructive,
  NI/Unclear warning, Y/PY success) — no rule logic in the frontend.
- **Evidence locate**: SQ rows already render the shared
  `AISuggestionReviewPopover` (locate included) via `FieldInput`. During
  implementation, verify on the QA screen with the design-review loop and
  fix if broken — acceptance criterion, not new machinery.

## 6. Export (xlsx)

For spec-carrying templates, in `_build_appraisal_model` +
`appraisal_summary`:

- Derived columns (already spec-ordered) become 10 domain + 4 overall.
- Stored-verdict columns: after the removal, `_is_verdict`'s
  first-select-per-section pick lands on **applicability** — mandatory
  relabel to `"<section label> — <field label>"` for spec templates so a
  section-labeled column never silently shows applicability values.
  D4 sections simply contribute no stored column.
- Column order stays `Record | stored verdicts | derived (spec order)`;
  no dataclass restructuring.
- Per-reviewer derived columns: **not added** (status quo — derived values
  are consensus-only in all_users mode, per-reviewer SQ detail lives in
  the matrix sheets; the legacy per-reviewer Overall suppression for spec
  templates already documents this rationale).
- Screen↔workbook parity: same module, extend
  `test_derived_overall_screen_workbook_parity` to the new rule.

## 7. LLM flow

No changes to `section_extraction_service` or the `quality_assessment`
prompt: the AI receives the section's remaining fields (SQs +
applicability) because that is all the template carries. The prompt's
"signaling question or judgment field" phrasing stays correct
(applicability is a judgment field).

## 8. Observability

The dangling-reference surface grows (~40 SQ coordinates + refs vs 16
coordinates today), and a template-editor rename would null chips
silently:

- `qa_derived_spec_dangling_ref` extends to unknown/forward `derived`
  refs.
- The export path gains the same warning when spec coordinates/refs don't
  resolve (today it silently blanks columns).
- A user-visible "spec doesn't match template" indicator is a recorded
  **non-goal** for this iteration (logs only, as today).

## 9. Rollout

- Local: `make db-fresh` (seed now creates v2 only).
- Prod (test-only data): run the seed to insert v2; one manual UPDATE
  renames the v1 global row to "PROBAST+AI (v1 — superseded)" (the global
  model has no active flag). **Never touch project clone rows or their
  `schema_`** — recomputing an old run's overalls from SQs behind a
  finalized assessment's back is the one genuinely dangerous move here.
- Existing projects: keep their v1 clone and behavior (except the
  High-propagation change in §1, which is shared rule code); to adopt v2
  they import the new template from the catalogue and select it as the
  active QA template. Old runs stay on v1.

## 10. Adoption recipe for the other QA templates (mapeamento)

Adopting computed domain judgments for classic PROBAST (`00b0`) and
QUADAS-2 (`00d0`) is a seed-data change per template, no new code:

1. Add `derived_judgments`: one `signaling_worst` entry per domain (inputs
   = that section's SQ coordinates), overalls as `worst_domain` over
   `{"derived"}` refs; applicability overalls over stored coordinates.
2. Remove the domain RoB judgment fields (and any stored overall fields)
   from the seed; keep applicability fields.
3. New global UUID + republish story identical to §9.

Template-specific notes, from the instrument review:

- **Classic PROBAST**: official scale is Y/PY/PN/N/NI with **no NA
  anywhere** — the current seed's universal `allows_not_applicable` is the
  same loophole fixed here (§3) and must be removed when that template
  migrates. The official overall-Low row carries a conditional-downgrade
  footnote (no external validation → consider High) that a pure
  worst-domain cannot express; adopting means accepting the same
  documented strict-reading deviation.
- **QUADAS-2**: SQ vocabulary is Y/N/Unclear — the answer "Unclear" plays
  NI's role and is already in the §1 mapping table. QUADAS-2 officially
  has **no overall roll-up at all** (it warns against summary scores), so
  a computed overall there is an app convention and must be labeled as
  such; the per-domain `signaling_worst` entries are the faithful part.

## 11. Tests

- Unit (`derived_judgment_service`): mapping table incl. QUADAS-2
  `unclear`; High-propagation through missing (both rules); Unclear
  completeness-gating; all-excluded → null; unknown answer → null; marker
  handling; ref resolution incl. inside collapse, forward/unknown ref →
  None + warning; ref breakdown labels.
- Seed: counts (10 sections / 48 fields), NA flags on exactly 6 rows, spec
  resolves (coordinates → seeded fields, refs → spec ids), new UUIDs.
- Payload: `section` inference (single-section entry vs overalls), 14
  entries for v2 / 4 for v1-shaped specs, blind vs revealed unchanged.
- Export: applicability column relabel, D4 sections contribute no stored
  column, derived columns order, parity screen↔workbook for
  `signaling_worst`, dangling-ref warning on the export path.
- Frontend: banner filter, accordion chip + breakdown + raw-answer
  colors, applicability still editable with AI flow, copy keys; existing
  QA tests updated for the removed judgment inputs.
- Update existing suites listed in the adversarial review (seed counts,
  dispositions "16 → 6", appraisal model resolution, run-view derived
  judgments).
- Manual/design-review: evidence locate on the QA screen (§5).

## Non-goals

- Human override of computed judgments (user decision; revisit only if
  strictness proves too blunt in real assessments).
- Migrating classic PROBAST / QUADAS-2 seeds now (§10 is the recipe).
- Per-reviewer derived columns in the export.
- User-visible dangling-spec indicator (§8, logs only).
- Any Alembic migration — this is entirely seed/data + rule code.
