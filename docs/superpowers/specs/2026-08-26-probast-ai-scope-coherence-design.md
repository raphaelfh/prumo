---
status: draft
last_reviewed: 2026-08-26
owner: '@raphaelfh'
---

# PROBAST+AI scope coherence — study-type gating, instrument-exact scale, seed convergence, finalize backstop

## Problem

PROBAST+AI v2's Step-2 classification (`assessment_scope.study_type`:
development_only / evaluation_only / combination) is a display hint and
nothing else. For a `development_only` study — the common case — the
consequences compound across every layer:

1. **Progress never reaches 100%.** All 49 fields of the evaluation part
   are `is_required=True` and stay in the denominator, so a COMPLETE
   assessment reads ~52% on the form header, the HITL worklist and the
   dashboard, forever "in progress".
2. **The AI answers the part the study doesn't have.** The LLM exclusion
   set covers only the 20 assessor-owned fields; evaluation signaling
   questions are proposable, so a section AI run (and the
   `extractAllSections` path, the day QA exposes it) invites the model to
   fabricate answers about validation the paper never performed.
3. **Nothing tells a reviewer they are filling the wrong part** beyond a
   passive badge; the mistake surfaces (if ever) at consensus.
4. **Two of the four overalls dash forever** (`worst_domain` is strict
   below High), indistinguishable from "unfinished" — the same
   unreported-vs-in-progress confusion #704 fixed inside D4, one level up.
5. **The signaling-question scale is split across two controls.** The
   instrument's SQ answer set is Y/PY/PN/N/**NI**, but the select
   carries only four answers and "No information" is a separate marker
   button — hardcoded as universal in `FieldInput` while its NA/NE
   siblings are opt-in per field. On judgments the button duplicates
   what the scale already encodes (NI → Unclear); on optional text
   boxes it is noise.
6. **`is_required=True` on every non-text field is the wrong tool.**
   Which part applies is unknown until Step 2, and an assessor may
   legitimately judge a domain without answering every SQ — yet
   requiredness hardcodes "all 95 fields owed" into the progress
   metric.

Two adjacent debts are folded in because this work depends on them:

7. **The boot-time seed converges by insertion only** (#715): every
   seeder early-returns on an existing row, so a corrected
   `derived_judgments` spec — or the `scope_rules` this design adds —
   never reaches an existing database. `version` is decorative.
8. **The divergence-rationale gate is client-side only.** A direct POST
   records a judgment diverging from its derived default with no
   rationale and no trace — against constitution §IX (every human
   selection traceable).

Plus one pattern debt fixed in passing: `useProjectQATemplate` is a
hand-rolled `useEffect`/`useState` fetch outside the TanStack Query
pattern the rest of the app (and #677 specifically) established.

## Decisions (settled with the user, 2026-08-26)

- **Strong hint, never a lock.** Out-of-scope sections stay visible and
  editable (the instrument says "leave the unused part blank", and a
  mid-assessment reclassification must be reversible with zero cleanup).
  They leave the progress denominator, leave the AI calls, and resolve
  their overalls as "not applicable".
- **No stored markers.** Choosing a study type writes nothing to the
  out-of-scope fields. Scope is a pure function of the current
  `study_type` value — flip it and everything recomputes.
- **The rule is declared data, single-sourced** (`scope_rules` on the
  template's `schema_`, sibling of `derived_judgments`). Each layer
  evaluates it where that layer acts; evaluation is set membership, not
  rule logic. This kills the last name-convention dependency in v2
  (`studyTypeScope.ts`'s hardcoded `dev_`/`eval_` prefixes).
- **"No information" leaves QA the clean way**: NI becomes the fifth SQ
  select answer (instrument-exact, one control) and the marker button
  becomes opt-in per field like its NA/NE siblings — a real disposition
  flag, not a client-side hide. Extraction keeps the button
  (constitution: a no-info outcome is a recorded proposal there).
- **Required = the deliverable, not the scaffolding**: the scope
  classifier, the domain judgments and applicability stay required;
  signaling questions and all text boxes are optional. Progress reads
  "in-scope domains judged".
- **Step-1 PICOTS gets a read-only run-screen surface** (2026-08-29):
  the wiring already passes the pinned ✨ instruction to every AI call;
  the gap is visibility. One disclosure at the top of the QA form,
  showing the PIN (what this run's AI actually sees), never the live
  column.
- **§11 migrations (classic PROBAST, QUADAS-2) are deferred** to their
  own follow-up — fully specified in the v2 spec §11, independent
  seed-data work. The seed convergence shipped here is what will make
  them cheap to deliver.
- **The spec-drift indicator stays a non-goal** (logs only, as today).

## 1. `scope_rules` — the declared rule

New key on the v2 template's `schema_`, beside `derived_judgments`:

```json
"scope_rules": {
  "classifier": {"section": "assessment_scope", "field": "study_type"},
  "excludes": {
    "development_only": [
      "eval_d1_participants", "eval_d2_predictors", "eval_d3_outcome",
      "eval_d4_analysis_apparent", "eval_d4_analysis_internal",
      "eval_d4_analysis_external", "eval_d4_judgment"
    ],
    "evaluation_only": [
      "dev_d1_participants", "dev_d2_predictors",
      "dev_d3_outcome", "dev_d4_analysis"
    ]
  }
}
```

- Coordinates use section/field NAMES, same idiom as `derived_judgments`;
  the seed test extends its dangling-ref assertion to the classifier
  coordinate and every excluded section name, and asserts the
  classifier's own section is never listed in `excludes` (a
  self-excluding classifier would collapse the form's entry point).
  No runtime dangling warning for `scope_rules` — unlike a nulled
  overall, this failure mode is visible (excluded sections simply
  reappear), so the seed test is enough.
- `combination`, a blank/unanswered classifier, an absent-reason marker,
  or an unknown value exclude **nothing** — the conservative default: an
  unclassified assessment shows the full form and full denominator.
- A template without `scope_rules` behaves byte-identically to today —
  kind-agnostic, like the LLM exclusion filter.
- Semantics are display + derivation + AI-call scoping ONLY. No lock, no
  writes, no lifecycle change.

Backend evaluation lives in `derived_judgment_service` as a sibling pure
helper (`out_of_scope_sections(schema, values_by_coord) -> set[str]`) —
it shares `unwrap_value_envelope`/absent-reason handling and the
coordinate idiom, and the module owns "spec-on-schema" interpretation.
Frontend evaluation replaces the prefix logic in
`frontend/lib/qa/studyTypeScope.ts` with the same trivial lookup over the
declared data (shipped to the client via the template `schema_`, §3).

**Reviewed alternative, cut:** serving a server-resolved
`out_of_scope_entity_type_ids` on the run-view payload. The worklist has
no run view per row and must evaluate client-side anyway; shipping
resolved ids to the form would create a second client path free to
diverge. One client evaluator, one backend evaluator, one data source.

## 1b. Instrument-exact scale, opt-in "No information", optionality

All carried by seed v2.1.0 (§4 delivers it) plus **one additive
migration**:

- **Model**: `allows_no_information` boolean on `extraction_fields`,
  `server_default true` — NI joins NA/NE as a per-field disposition and
  `FieldInput` loses its "universal NI" special case: three
  dispositions, uniformly flag-gated (net simplification). Every
  existing template behaves identically by default. The flag joins its
  siblings at the same touchpoints, no more: snapshot SQL, clone copy,
  template diff (SEMANTIC tier) + discard normalization, the
  template-config editor toggle, and the publish-contract default map.
- **Seed v2.1.0**: every field `allows_no_information=False`; SQ
  selects gain the instrument's fifth answer via a **v2-local** answer
  list (`{value: "NI", label: "No information"}` envelope — the shared
  `_PROBAST_SIGNALING` constant stays untouched for the classic seed);
  `_SIGNALING_MAP` gains `"ni" → Unclear`. Parity holds by
  construction: the export's label path resolves "No information"
  through the existing marker-label table to the same Unclear.
- **Judgments and text boxes**: no NI anywhere — the judgment scale
  already encodes it (NI → Unclear, the instrument's own semantics)
  and a blank optional text box needs no marker.
- **LLM instructions follow the scale**: the seeded texts still steer
  the model to the marker ("mark no information when the article is
  silent" on SQs; same tail on applicability). v2.1.0 rewrites them —
  SQs: "Answer Y, PY, PN, N or NI (no information)"; applicability:
  "answer Unclear when the article gives too little to judge". The
  response-schema enum picks up "NI" automatically from the allowed
  values. Applicability itself is untouched: it is already
  AI-proposable by design (judged directly against the Step-1 PICOTS,
  full suggestion flow in the no-entry judgment card path) — verified,
  not changed.
- **Optionality**: signaling questions become `is_required=False`;
  required = the scope classifier + the 8 domain judgments + the 6
  applicability judgments. `is_required` feeds only the progress
  metric (the finalize completeness gate is extraction-only, ADR-0009),
  so this is pure seed data. With §3's scope filtering, progress now
  means "in-scope domains judged" — a development_only study reaches
  100% by classifying and judging the development part. The 6
  conditional NA rows keep `allows_not_applicable` (an explicit
  "doesn't apply" beats a silent blank on exactly those rows).
- **Derivation unchanged**: `signaling_worst` is already
  completeness-gated below High, so a partially-answered domain simply
  offers no derived default and the assessor judges directly — the
  chip's nudge toward answering SQs survives without requiredness.
- Marker handling in the derivation stays (v1 / QUADAS-2 / CHARMS
  clones and extraction still use it) — already on the
  deliberately-not-dead list.

## 2. Backend consumers

### 2a. Scope-filtered values (the load-bearing rule)

Out-of-scope semantics for the DERIVATION are made real by **dropping
the excluded sections' values before the rules run** — one helper
(`scope_filtered_values`, beside `out_of_scope_sections`), applied by
the payload builder and the export. The aggregation rules stay
untouched and yield None naturally. Without this filter, a reviewer who
fills the evaluation part and THEN classifies `development_only` leaks
a real judgment into `eval_overall_rob` — the banner would show a
verdict for a part the UI calls "Not applicable" while progress reads
100%, and the §5 gate could demand a rationale for the inapplicable
part. Stored values are still never deleted (reclassify back and they
return); they are only invisible to the rules while out of scope,
mirroring what §3 does to the progress numerator.

### 2b. AI-path guard (authoritative)

At the single point in `section_extraction_service` where the eligible
field list is assembled (where `excluded_field_coordinates` already
applies), a section named in the resolved exclusion set is **skipped**,
reusing the existing "empty eligible list → no LLM call" semantics.
The classifier is resolved from the run's **newest proposal on the
classifier coordinate** — the same source the QA form hydrates from
("latest proposal per (instance, field)"), probed with the same idiom
as `_fields_with_recent_human_proposal`; one targeted query, no new
data path. This covers the per-section button AND the
`extractAllSections` path in one place — the client's button-hiding
(§3) is a courtesy, not the enforcement. No `kind ==` branch; a
template without rules passes through untouched (regression guard
reused from v2 §12).

### 2c. Derived-judgment state (the #704 pattern, one level up)

`derived_judgment_payload` stamps `state="out-of-scope"` on every
`RunViewDerivedInput` whose section(s) are all excluded, using the same
`values_for_derivation` set (own values while blind, published after
reveal — a reviewer's scope reflects their own classification while
blind, exactly like their recommendations). The literal joins
`"unreported"`/`"in-progress"` as **wire contract** — tests assert the
string, not a constant name. `RunViewDerivedInput.state` is already
`str | null` in the OpenAPI contract (#704), so **no schema change and
no type regeneration**.

Two deliberate amendments to the #704 contract, called out because its
docstring states the old invariants:

- **Plain rows may now carry `state`** (only ever `"out-of-scope"`);
  "state stays None on plain rows" becomes "state on a plain row means
  out of scope". The exactly-one-of-`state`/`contribution` rule holds
  everywhere.
- **Precedence**: after §2a's filter, a fully-excluded collapse group
  computes `unreported` (all members missing); the payload's
  out-of-scope stamp **wins** over `unreported`/`in-progress` — the
  reviewer must never be told an inapplicable part is "in progress".

`worst_domain` / `signaling_worst` / `worst_of` are untouched — with
§2a's filter, out-of-scope inputs carry no value and the rules already
yield None; the state only explains WHY. Nobody re-touches the
strict/lenient asymmetry.

### 2d. Pinned Step-1 instructions on the run view

Verified: the ✨ template instruction reaches every QA AI call already —
all three extract paths inject `general_instructions_for_version`
(version-PINNED: a run keeps the instruction it was opened under until
a republish re-pins it). What's missing is any run-screen surface
showing it, so a manager who never replaced the seeded
`[customize: state the review's Step-1 PICOTS…]` placeholder finds out
only by wondering at the AI's applicability judgments.

The run view gains one nullable field, `general_instructions`, read via
the SAME `general_instructions_for_version` the prompts call — single
implementation, so the screen can never show a text the AI didn't get.
Kind-neutral (extraction runs carry the pin too; only the QA screen
renders it for now). This IS a contract change — regenerate
`frontend/types/api/*` and the hand-mirrored `hooks/runs/types.ts`.

### 2e. Export parity

The appraisal export applies `scope_filtered_values` (§2a) before its
`compute_derived_judgments` call and renders "Not applicable" for a
derived entry whose inputs are all out-of-scope, keeping the
screen↔workbook parity invariant — the banner (§3) will say "Not
applicable" and the workbook must not silently show the same blank it
shows for "unfinished".

## 3. Frontend consumers

`schema_` is added to the template selects in `qaTemplateService` and the
shared project-template query (#677) — the client already receives the
whole row minus this column; no read-path expansion (the PostgREST →
API consolidation remains extraction-only per the roadmap).

- **`studyTypeScope.ts` rewritten data-driven**: `resolveStudyType` stays
  (generic value read); `isDomainOutOfScope(prefix…)` is replaced by
  `outOfScopeSections(scopeRules, studyTypeValue): Set<string>`. The
  prefix tests are replaced, not appended to.
- **Progress**: `computeRequiredFieldProgress` is **not changed**.
  Its numerator maps value keys through the projections it is given, so
  filtering the `entityTypes` projection array at the two QA call sites
  (form header, `HITLArticleTable` per row) removes an excluded entity
  type from BOTH numerator and denominator already — a filled
  out-of-scope field neither pushes progress above 100% nor counts as
  work owed. Zero change to the shared function; extraction surfaces
  untouched by construction. Each caller resolves the excluded set from
  the active template's `scope_rules` + the values it already holds
  (`useArticleExtractionValues`); a worklist row whose scope value
  isn't loaded excludes nothing (conservative).
- **Section presentation**: an out-of-scope section renders collapsed by
  default with a muted title; the existing badge stays; fields remain
  editable when expanded (never gate). The section AI button hides
  (backend enforces regardless).
- **Banner + chip**: `OverallJudgmentBanner` renders a muted "Not
  applicable" (new copy key) instead of the em dash when every input is
  `out-of-scope`; `DerivedDefaultChip.rowDisplay` learns the third
  state literal with muted tone. No mixed case exists — rules exclude
  whole parts.
- **Step-1 PICOTS disclosure**: a quiet collapsible row at the top of
  the QA form, beside the `assessment_scope` section (the instrument's
  own order — Step 1 precedes Steps 2–3): "Step 1 — Review question
  (PICOTS)", one muted line collapsed, the run's PINNED
  `general_instructions` read-only when expanded (§2d — never the live
  template column, which can differ until republish). Null renders one
  muted "not configured" line naming where to set it (the template's ✨
  instruction); a still-unedited seeded placeholder renders as-is — the
  `[customize: …]` text is its own call to action, no detection logic.
  Rejected placements: the run header (declutter, #475/#476), a
  per-applicability-row popover (×6 noise), a side sheet (weight).
  Copy via `lib/copy/qa.ts`.
- **`useProjectQATemplate` → TanStack Query** while touched: wrap
  `loadProjectQATemplate` in `useQuery` with a key-factory entry,
  mirroring #677. Behavior-preserving otherwise.

## 4. Seed convergence (the delivery vehicle)

`seed_probast_ai` converges **unconditionally** instead of
insert-only:

- Row absent → insert (today's path).
- Row present → **update** the template row in place (name,
  description, version, `schema_`) and **replace its children**: delete
  the global template's entity types (fields CASCADE), re-insert from
  `_SECTIONS`. Every boot, no version compare — a version GATE would
  reintroduce the forgotten-bump silent no-op, the exact bug class this
  section exists to fix. The writes are idempotent by construction
  (deterministic UUIDs, same data → same rows) and cost ~100 rows per
  deploy. `version` stays as display metadata (2.1.0 still ships). The
  template ROW is never deleted — deleting it would SET NULL every
  clone's `global_template_id` and break clone dedupe/heal.

Safety, verified against the models: no FK references global entity
types from clones, runs, instances or proposals (clones copy; runs pin
clone snapshots). If that invariant ever breaks, the RESTRICT on
`extraction_instances.entity_type_id` aborts the boot loudly and Railway
keeps the previous build live — the correct failure mode.

Convergence makes the CODE authoritative **by construction**: a deploy
rollback rewrites the template back to that build's shape, and a manual
prod UPDATE to the global row is reverted on the next boot. Intended —
the catalogue always matches the running build, and globals are
referenced by nothing that could break.

v2 bumps `2.0.0 → 2.1.0` carrying `scope_rules`, the NI answer, the
disposition flags and the optionality change (§1b) in one replace. The
next deploy's boot seed (#715) installs it in prod by itself — the
first real exercise of convergence, and the reason this section is a
dependency of §1 rather than hygiene. Local stacks converge on the next `make db-seed` — the
docstring's "requires `make db-fresh` or a manual UPDATE" caveat is
retired. The helper stays local to `seed_probast_ai`;
other seeders adopt it when their own migrations (§11 follow-up) touch
them — surgical-on-unrelated-code.

Clones are deliberately untouched: existing projects keep their v2.0.0
clone (no scope gating) until they re-import — same adoption story as
every template change.

## 5. Finalize backstop for divergence-without-rationale

In `RunLifecycleService.advance`, at `target == FINALIZED`, beside the
existing gates (and therefore inside `approve_and_finalize`'s
transaction, after its publishes):

- Call `build_derived_judgments_payload` with the **published states**
  (the canonical set at this point) — reuse, not a second
  implementation (the module's own iron rule), and the §2a scope filter
  comes with it: an out-of-scope domain's default is None, so leftover
  published values in an inapplicable part can never trigger the gate.
- For each RECOMMENDATION entry: if the default is non-None, the
  published target resolves to a judgment (via
  `_judgment(..., no_information_as_unclear=True)`; a blank or
  NA-marker target skips the check), the judgment differs from the
  default, and the published rationale is empty → collect.
- Any collected coordinate raises `DivergenceRationaleError`
  (a new `InvalidStageTransitionError` subclass → the existing 422
  envelope), naming the domains.

Data-driven and kind-neutral: extraction templates carry no
recommendations, so the gate is a no-op there — no `kind ==` branch,
consistent with ADR-0009's extraction-only completeness gate staying
where it is. The client-side gate remains the primary UX; this is the
backstop that makes the trace guarantee real (constitution §IX). The v2
spec's "backend stays permissive" recorded decision is explicitly
superseded by this section.

## 6. Tests

- **Unit — scope resolution** (`derived_judgment_service`): blank /
  combination / development_only / evaluation_only / marker / unknown
  value; both caller value shapes; template without rules → empty set.
- **Unit — payload**: `state="out-of-scope"` stamped on affected inputs;
  the string literal asserted verbatim (wire contract, like #704's);
  blind vs revealed classifier source; **the leak case** — evaluation
  values filled, then classified `development_only` → the eval overall
  yields None + out-of-scope state, never a judgment; precedence —
  out-of-scope wins over `unreported`/`in-progress` on group rows.
- **Unit — AI guard** (`section_extraction_service`): excluded section
  skipped on the single-section path and the extract-all path; a
  template without rules reaches `build_output_models` with its field
  list unchanged (regression guard).
- **Unit — progress**: call-site projection filtering removes numerator
  AND denominator; filled out-of-scope field never yields >100%; the
  shared function itself is untouched (no new tests there).
- **Unit — `studyTypeScope`**: data-driven cases replacing the prefix
  tests.
- **Unit — seed convergence**: seeding twice yields an identical final
  state (idempotent); a manual UPDATE to the global row is reverted by
  the next seed (code authoritative); children replaced under the same
  deterministic UUIDs with field counts re-asserted; a project clone
  row and its entity types are untouched.
- **Seed test extension**: `scope_rules` coordinates resolve against the
  seeded tree (dangling-ref, alongside the `derived_judgments`
  assertion); the optionality matrix is rewritten (required = classifier
  + judgments + applicability; SQs and text optional); the six NA rows
  unchanged; `allows_no_information` false on all 95 fields; SQ selects
  carry the five-answer envelope list.
- **Unit — NI answer**: `_SIGNALING_MAP` maps `ni → Unclear`;
  screen↔workbook parity for the "NI" select answer through BOTH caller
  shapes (raw envelope and resolved label); the seeded instruction
  tails name the five-answer scale and no llm_description mentions
  "mark no information" anymore.
- **Unit — `FieldInput`**: the NI disposition renders only when
  `allows_no_information` — flag-gated exactly like NA/NE; a field with
  the default (true) is byte-identical to today.
- **Unit — pinned instructions**: the run view returns the
  version-pinned text, not the live column (edit the template after
  the run opens → the view still shows the pin); null → null.
- **Unit — PICOTS disclosure**: collapsed one-liner, expands to the
  pinned text; null renders the "not configured" line.
- **Integration — finalize gate**: diverged target + empty rationale →
  422 naming the domain; with rationale → finalizes; target blank or
  NA-marker → passes; extraction-kind run → unaffected.
- **Export**: out-of-scope overall renders "Not applicable" in the
  workbook (parity with the banner).
- **E2E (`qa-flow`)**: classify development_only → eval sections
  collapse with badge, progress reaches 100% on dev-only completion,
  banner shows "Not applicable" on the two eval overalls.

## 7. Delivery — PR train on dev

1. **PR1 — model + seed** (backend): the `allows_no_information`
   migration, `scope_rules` data, NI answer, optionality,
   unconditional convergence, `2.1.0`, seed tests. Inert to every
   runtime path (the flag defaults true everywhere it already exists).
2. **PR2 — backend consumers**: scope helper, AI-path guard, payload
   state, export parity, and the run view's `general_instructions`
   field (§2d) — the train's one contract change (types regen).
3. **PR3 — frontend**: schema in selects, data-driven `studyTypeScope`,
   call-site projection filtering for progress, collapse + copy,
   banner/chip state, flag-gated NI disposition in `FieldInput` + the
   config-editor toggle.
4. **PR4 — finalize backstop** (backend): independent; can land any
   time after PR1.
5. **PR5 — TanStack migration of `useProjectQATemplate`**: orthogonal
   pattern cleanup, its own tiny PR (surgical-on-unrelated-code — it
   ships even if the train pauses, and reverts without touching the
   feature).

Rollout is the normal dev→main promotion; the boot seed carries the
template change to prod with no manual step.

## Simplicity review — cut or deferred, with reasons

- **Server-resolved scope ids in the payload** — cut (§1): would coexist
  with the client evaluator the worklist needs, i.e. two client paths.
- **`excludedEntityTypeIds` parameter on
  `computeRequiredFieldProgress`** — cut (adversarial review): the
  function's numerator already maps value keys through the given
  projections, so filtering the projection array at the QA call sites
  does the whole job with zero shared-function change.
- **"Answered count" on a collapsed out-of-scope section** — considered
  for the filled-then-reclassified case, dropped: the reviewer avatar
  stack already survives on the collapsed row as the activity signal,
  and the values are one click away.
- **Version-gated convergence** — cut (complexity review): gating the
  §4 replace on a `version` bump reintroduces the forgotten-bump
  silent no-op, the exact bug class the section exists to fix.
  Unconditional convergence deletes the compare branch and makes the
  code authoritative by construction; `version` stays display
  metadata.
- **Runtime dangling warning for `scope_rules`** — cut (this review):
  the failure mode is visible (sections reappear), unlike a silently
  nulled overall; the seed test carries the guarantee.
- **Hiding the NI button client-side for QA** — rejected as the
  shortcut it is; the opt-in flag is the same mechanism NA/NE already
  use and deletes a special case instead of adding one.
- **Keeping SQs required with NA as the escape hatch** — rejected:
  requiredness encoded "all 95 owed", which Step 2 makes unknowable
  upfront; optional SQs + required judgments state what is actually
  owed.
- **Stored `not_applicable` markers on out-of-scope fields** — rejected:
  creates data to clean up on reclassification; display-layer semantics
  satisfy the instrument.
- **Hard lock on out-of-scope sections** — rejected: "never gate input"
  (v2 spec), breaks mid-assessment reclassification.
- **§11 instrument migrations** — deferred to their own spec/PRs; recipe
  already written (v2 spec §11); this design only removes their two
  blockers (convergence, and classic PROBAST's universal
  `allows_not_applicable` gets fixed there, not here).
- **Generic convergence helper for all seeders** — deferred with §11;
  implemented locally in `seed_probast_ai` now.
- **User-visible spec-drift indicator** — stays a non-goal (logs only).
- **Confirm-dialog on editing an out-of-scope field** — rejected: the
  collapse + muting is the "strong hint"; a dialog is a soft lock.

## Non-goals

- Any change to `worst_domain` / `worst_of` / `signaling_worst`
  aggregation semantics.
- Blocking autosave or field writes on divergence (finalize-time only).
- Rendering the PICOTS disclosure on the extraction run screen (the
  payload field is kind-neutral; the surface ships QA-only for now).
- Editing the ✨ instruction from the run screen (that stays in
  template configuration, where republish re-pins it).
- Migrating QA reads off PostgREST (read-path consolidation remains
  extraction-only).
- Backfilling existing v2.0.0 project clones with `scope_rules`, the NI
  answer or the optionality change (adoption = re-import, as with every
  template change).
- Backend rejection of a marker the field's flags disallow — the flags
  stay a template-data contract surfaced by the UI, as NA/NE already
  are; a rogue NI marker still degrades gracefully (→ Unclear).
- Alembic migrations beyond the single additive
  `allows_no_information` column (server_default true, no backfill).
