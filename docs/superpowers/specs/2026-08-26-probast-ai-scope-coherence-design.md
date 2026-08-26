---
status: draft
last_reviewed: 2026-08-26
owner: '@raphaelfh'
---

# PROBAST+AI scope coherence — study-type gating, seed convergence, finalize backstop

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

Two adjacent debts are folded in because this work depends on them:

5. **The boot-time seed converges by insertion only** (#715): every
   seeder early-returns on an existing row, so a corrected
   `derived_judgments` spec — or the `scope_rules` this design adds —
   never reaches an existing database. `version` is decorative.
6. **The divergence-rationale gate is client-side only.** A direct POST
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
  The payload builder's dangling warning covers `scope_rules` names too
  — an unresolvable name excludes nothing, conservatively, but is
  logged.
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

### 2d. Export parity

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
- **`useProjectQATemplate` → TanStack Query** while touched: wrap
  `loadProjectQATemplate` in `useQuery` with a key-factory entry,
  mirroring #677. Behavior-preserving otherwise.

## 4. Seed convergence (the delivery vehicle)

`seed_probast_ai` becomes version-gated instead of insert-only:

- Row absent → insert (today's path).
- Row present, `version` equals the code's → skip (today's path).
- Row present, `version` differs → **update** the template row in place
  (name, description, version, `schema_`) and **replace its children**:
  delete the global template's entity types (fields CASCADE), re-insert
  from `_SECTIONS`. The template ROW is never deleted — deleting it
  would SET NULL every clone's `global_template_id` and break clone
  dedupe/heal.

Safety, verified against the models: no FK references global entity
types from clones, runs, instances or proposals (clones copy; runs pin
clone snapshots). If that invariant ever breaks, the RESTRICT on
`extraction_instances.entity_type_id` aborts the boot loudly and Railway
keeps the previous build live — the correct failure mode.

Convergence makes the CODE authoritative in **both directions**: a
deploy rollback re-runs the older seed, whose different `version`
rewrites the template back to that code's shape. Intended — the
catalogue always matches the running build, and globals are referenced
by nothing that could break.

v2 bumps `2.0.0 → 2.1.0` carrying `scope_rules`. The next deploy's boot
seed (#715) installs it in prod by itself — the first real exercise of
convergence, and the reason this section is a dependency of §1 rather
than hygiene. Local stacks converge on the next `make db-seed` — the
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
- **Unit — seed convergence**: seed twice same version → no-op; bump
  version → row updated, children replaced under the same deterministic
  UUIDs, field counts re-asserted; a project clone row and its entity
  types are untouched.
- **Seed test extension**: `scope_rules` coordinates resolve against the
  seeded tree (dangling-ref, alongside the `derived_judgments`
  assertion).
- **Integration — finalize gate**: diverged target + empty rationale →
  422 naming the domain; with rationale → finalizes; target blank or
  NA-marker → passes; extraction-kind run → unaffected.
- **Export**: out-of-scope overall renders "Not applicable" in the
  workbook (parity with the banner).
- **E2E (`qa-flow`)**: classify development_only → eval sections
  collapse with badge, progress reaches 100% on dev-only completion,
  banner shows "Not applicable" on the two eval overalls.

## 7. Delivery — PR train on dev

1. **PR1 — rules + seed convergence** (backend): `scope_rules` data,
   version-gated convergence, `2.1.0`, seed tests. Inert to every
   runtime path.
2. **PR2 — backend consumers**: scope helper, AI-path guard, payload
   state, export parity. No contract change.
3. **PR3 — frontend**: schema in selects, data-driven `studyTypeScope`,
   call-site projection filtering for progress, collapse + copy,
   banner/chip state.
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
- Migrating QA reads off PostgREST (read-path consolidation remains
  extraction-only).
- Backfilling existing v2.0.0 project clones with `scope_rules`
  (adoption = re-import, as with every template change).
- Alembic migrations — none; entirely seed/data + rule code.
