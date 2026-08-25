---
status: draft
last_reviewed: 2026-08-23
owner: '@raphaelfh'
---

# PROBAST+AI derived domain judgments — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the instrument-exact PROBAST+AI v2 flow: derived defaults
(`signaling_worst`) recommending each domain judgment, assessor-owned
judgment/rationale/summary fields excluded from the LLM, a 13-section /
95-field v2 seed under a new UUID, the recommendation-chip +
divergence-rationale UI, and the export/observability follow-through.

**Spec:** `docs/superpowers/specs/2026-08-22-probast-ai-derived-domain-judgments-design.md`
(sections cited as §N). Normative companion:
`docs/reference/templates/probast-ai-instrument.md` (field names, labels,
official text — the plan does not restate the 95-field table; the
instrument doc IS that table and is already committed).

**Architecture:** Five sequential PRs on the dev merge-train. PR0
(autosave fixes) is independent and already executed (PR #684). PR1 is
pure backend rule/payload code (no schema migration — verified
column-by-column by the migration-safety review). PR2 is seed data. PR3
frontend. PR4 export + observability. Each PR is green through
lint/typecheck/tests before arming; one armed auto-merge at a time.

**Tech stack:** FastAPI + SQLAlchemy async (backend), React 19 + Vite +
TanStack Query (frontend), pytest + vitest.

## Panel review outcome (2026-08-23)

Five adversarial lenses (constitution/layering, security/RLS/BOLA,
migration-safety, simplicity/YAGNI, test-coverage) reviewed the first
draft. No objection to architecture, slicing, or sequencing. Five
blockers, all resolved by amendments now folded into the tasks below:

1. Exclusion filter moved to the `_extract_with_llm` choke point — the
   original `_live_field_intersection` placement missed the re-pin
   fallback path (`section_extraction_service.py:356-363`,
   `fields_override=None` → full live field list to the LLM).
2. `contribution` field added to `DerivedInput`/`RunViewDerivedInput` —
   raw-answer-only rows would force the frontend to re-implement the
   mapping table to highlight causing rows (rule-in-frontend).
3. Exclusion drift observability: `qa_derived_spec_dangling_ref` fires
   on the extraction path too; a live rename must never silently
   un-exclude an assessor-owned field without a log line.
4. The v1 `derived_judgments` spec is frozen as a literal inside
   `test_derived_judgment_no_information.py` — v1 clones stay live in
   prod, and the wholesale seed rewrite must not delete their only
   real-spec guard (incl. `test_prod_run_21681ee0_now_computes`).
5. Anti-over-exclusion positive control: a mixed v2 section test
   asserts the EXACT surviving field list (applicability rationale
   present; judgment + judgment rationale absent) — the naive tests
   were all satisfiable by an over-broad (e.g. name-suffix) filter.

## Global constraints

- English only; conventional commits; PRs → `dev`, squash-merged.
- The spec's "Simplicity & dead-code pass" is binding: same-PR
  deletions; the keep-list (collapse support, `judgmentFields.ts`,
  export legacy branches) must NOT be cleaned.
- No new `kind == "quality_assessment"` branch anywhere in the
  extraction path (§3 invariant; guard is case-insensitive over
  docstring-stripped source and bans the negated `!= "extraction"`
  form too — the codebase's canonical spelling is
  `TemplateKind.QUALITY_ASSESSMENT.value`).
- No `{"derived": …}` spec references; overalls read stored judgments.
- Backend stays permissive on divergence-rationale (UI-level gate only).
- After payload changes: `npm run generate:api-types` + commit
  (api-contract CI); update the hand-mirror in
  `frontend/hooks/runs/types.ts`; new component props type off
  `schema.d.ts`, not the mirror.
- All user-facing copy through `frontend/lib/copy/`; React Compiler
  constraints (no try/finally in component bodies).
- Local DB rollout = `make db-fresh` — message peer sessions first
  (shared local Supabase); the message must say v1 PROBAST+AI
  disappears entirely on the fresh DB (v2-only seed).
- `backend/app/seed_probast_ai.py` must stay under the 800-line
  file-size ratchet or become a package; prefer terse table-driven data.
- Docs (spec, instrument mapping, this plan) ride with PR1; this plan
  has its `.markdownlintignore` entry.
- Executors: this shared worktree flips branches; pin `git -C` +
  absolute paths and re-verify the branch before committing.

---

## PR0 — QA autosave run-switch fixes (spec §7b) — EXECUTED (PR #684)

Branch `fix/qa-autosave-run-switch` off origin/dev. Both fixes
implemented, green (34/34 hook tests, 37/37 page tests, 2058/2058 full
vitest, lint, tsc), CI green, queued on the merge-train.

**H1 (hook)** — `frontend/hooks/runs/useAutoSaveProposals.ts`: flush
effect keys on `runId`; **deviation from the spec's mechanism, forced
by evidence**: `performSave` now captures the save context (runId,
values, stage, baselines, link maps) synchronously at invocation — the
spec's "cleanup sees old refs" assumption held only for the cleanup's
synchronous part, and the deferred microtask read the refs after the
ref-sync effect re-pointed them (TDD proved the dep-only fix
insufficient). The dirty diff still computes after any in-flight batch
settles, against the then-current `lastSavedByKeyRef`.

**Q1 (QA page)** — `frontend/pages/QualityAssessmentFullScreen.tsx`:
hydration tracks `hydratedRunId`; run change REPLACES `values` with the
new run's `loadedValues`; same-run refetch keeps the merge. Regression
tests in both suites; the scratch repro file was consumed and deleted.

Security review verified: cross-run writes are non-representable
server-side (coordinate coherence 422s cross-article writes;
`record_decision` stage-gates under a row lock).

---

## PR1 — backend: rules, exclusion, payload (docs ride along)

Branch: `claude/probast-ai-quality-cbf025` (already carries the docs
commits). All paths relative to repo root.

### Task 1.1: `signaling_worst` rule in `derived_judgment_service`

**Files:**
- Modify: `backend/app/services/derived_judgment_service.py`
- Test: `backend/tests/unit/test_derived_judgment_service.py`

**Interfaces produced:**

- `_SIGNALING_RULE = "signaling_worst"`; `compute_derived_judgments`
  dispatches `worst_domain` | `signaling_worst`; unknown rule → None
  (unchanged).
- `Contribution = Literal["Low", "High", "Unclear", "excluded", "missing"]`
  — a typed closed set, not bare sentinels (constitution §V; legible in
  test failures).
- `DerivedInput` gains `contribution: str | None` (the
  Low/High/Unclear the rule consumed; None for excluded/missing/
  unreported). For `signaling_worst` rows, `value` carries the RAW
  stored answer in the reviewer's vocabulary (`"PN"`, a marker label
  via `ABSENT_REASON_LABELS`, or None); group rows carry the group
  `label`, `value=None`, and the group's resolved contribution.
  `worst_domain` rows keep today's judgment `value` and set
  `contribution` to the same judgment — one uniform explain contract.
- `is_recommendation(entry: dict) -> bool` (`"target" in entry`) —
  the single recommendation/overall discriminator, used by the export
  (Task 4.1) and payload (Task 1.4); spec-shape knowledge stays in the
  rule module.
- `spec_coordinates` additionally yields `target`/`rationale`/`summary`
  coordinates (each an optional `{"section","field"}` dict).

**Steps:**

- [ ] Write failing tests (table-driven where natural):
  - mapping: `y/py→Low`, `pn/n→High`, `unclear→Unclear` (QUADAS-2
    vocabulary), `no_information` marker → Unclear, `not_applicable`/
    `not_evaluated` markers → excluded, unanswered → missing,
    out-of-vocabulary (`"maybe"`) → missing (never Low). Case-folded,
    envelope-unwrapped, and correct for BOTH caller shapes (raw
    envelope and resolved display label — the parity invariant).
  - aggregation precedence: any High → High even with missing
    siblings; else any missing/in-progress group → None; else any
    Unclear → Unclear; else nothing judged (all excluded) → None;
    else Low.
  - group semantics (eval D4 shape): all members unanswered/excluded →
    unreported (ignored); any member High → group High; else any
    member missing → in-progress (entry → None); else worst of member
    contributions. Gate `q1` as a PLAIN input: gate=N → High
    immediately; gate=Y + apparent group unreported + internal group
    judged → derives from internal alone.
  - breakdown: plain row `value == "PN"`, `contribution == "High"`;
    marker row `value ==` its display label, `contribution` per
    mapping; unanswered row `value is None`,
    `contribution is None`; group row label + contribution.
  - `spec_coordinates` walks `target`/`rationale`/`summary`.
  - `is_recommendation` true iff `"target"` present.
- [ ] Run: `cd backend && uv run pytest tests/unit/test_derived_judgment_service.py -q` — new tests FAIL.
- [ ] Implement:

```python
Contribution = Literal["Low", "High", "Unclear", "excluded", "missing"]
_SIGNALING_MAP: dict[str, Contribution] = {
    "y": "Low", "py": "Low", "pn": "High", "n": "High",
    "unclear": _UNCLEAR,
}

def _signaling_contribution(raw: Any) -> Contribution:
    reason = _absent_reason(raw)
    if reason == AbsentReason.NO_INFORMATION.value:
        return _UNCLEAR
    if reason is not None:
        return "excluded"
    value = unwrap_value_envelope(raw)
    if value is None or (isinstance(value, str) and not value.strip()):
        return "missing"
    return _SIGNALING_MAP.get(str(value).strip().casefold(), "missing")
```

  Group resolution + aggregation as pure helpers; two-way rule
  dispatch; raw-answer display helper for breakdown `value`.
- [ ] Run the file + `tests/unit/test_derived_judgment_no_information.py`
  + `tests/unit/test_run_view_derived_judgments.py` — PASS, no
  regressions.
- [ ] Commit `feat(qa): signaling_worst derivation rule + spec-coordinate widening`.

### Task 1.2: `worst_domain` High-propagation (§1)

**Files:**
- Modify: `backend/app/services/derived_judgment_service.py:160-171`
- Test: `backend/tests/unit/test_derived_judgment_service.py`,
  `backend/tests/unit/test_derived_overall_screen_workbook_parity.py`

- [ ] Failing tests: `worst_domain(["High", None]) == "High"` (today
  None); `worst_domain(["Low", None]) is None` (completeness gate holds
  below High); parity case: one High domain + one unrated domain agrees
  screen/workbook at "High".
- [ ] Implement — High checked before the completeness gate:

```python
judgments = [_judgment(v, no_information_as_unclear=True) for v in values]
if any(j == "High" for j in judgments):
    return "High"
if not judgments or any(j is None for j in judgments):
    return None
```

- [ ] The existing strictness tests already use non-High inputs and
  stay green — do NOT edit green tests (panel-verified: every current
  `worst_domain` assertion survives). Deliberate behavior change for
  v1 runs' displayed/exported overalls — computed-on-read, nothing
  stored, reversible; say so in the commit body.
- [ ] Run both files — PASS. Commit
  `feat(qa): worst_domain propagates High through unrated domains`.

### Task 1.3: LLM exclusion at the `_extract_with_llm` choke point (§3)

**Files:**
- Modify: `backend/app/services/derived_judgment_service.py` (pure
  helper), `backend/app/services/section_extraction_service.py`
- Test: `backend/tests/unit/test_derived_judgment_service.py`,
  `backend/tests/unit/test_section_extraction_service.py`

**Interfaces produced:**

- `excluded_field_coordinates(spec) -> set[tuple[str, str]]` — union of
  every entry's `target`/`rationale`/`summary` `(section, field)`
  names. Empty/None spec → empty set.
- `_extract_with_llm` gains the exclusion set (threaded from the
  call-sites' template context, computed once via
  `derived_spec(template.schema_)`). Inside it, hoist
  `effective = fields_override if fields_override is not None else entity_type.fields`,
  subtract excluded fields, and always pass the explicit list to
  `build_output_models` — one seam that covers the pinned path, the
  memory path, AND the re-pin fallback (`:356-363`) that never calls
  `_live_field_intersection`. Empty result → existing
  `extraction_skipped_no_fields` path (no LLM call).
- Matching semantics (pinned): the field axis compares the exclusion
  names against the field objects at hand (post-rename-bridge LIVE
  names); the section axis compares `entity_type.name`. Drift
  observability: after filtering, any exclusion coordinate whose
  section matches this entity type but whose field matched nothing
  logs `qa_derived_spec_dangling_ref` (extraction path) — a live
  field rename can fail open but never silently. (Section renames are
  caught continuously by the §9 payload-path warning on every run
  view; residual documented, not re-solved here.)

**Steps:**

- [ ] Failing unit tests:
  - helper: 20 coordinates from a v2-shaped spec; empty for spec-less.
  - **exact-surviving-list control (panel blocker 5):** a mixed
    v2-shaped section (describes + SQs + applicability +
    `applicability_concerns_rationale` + `quality_concern` +
    `quality_concern_rationale`) asserts `build_output_models`
    receives EXACTLY the first four groups — applicability rationale
    included, judgment + judgment rationale excluded.
  - all-excluded section (overall_judgement shape) skips the LLM call.
  - **fallback path (panel blocker 1):** entity type absent from the
    pinned tree (re-pin race) still never passes an excluded field.
  - modularity guard: spec-less extraction template reaches
    `build_output_models` byte-identical.
  - **drift (panel blocker 3):** an exclusion coordinate naming this
    section but a nonexistent field → warning fired
    (structlog capture), field list otherwise intact.
- [ ] Add the grep-guard as a plain (initially green) assertion —
  case-insensitive `quality_assessment` over docstring-stripped source
  of `section_extraction_service.py`, plus a ban on
  `kind != "extraction"` / `kind not in` forms; not listed as
  fail-first (it cannot fail first).
- [ ] Implement; run
  `uv run pytest tests/unit/test_section_extraction_service.py tests/unit/test_llm_schema.py -q`.
- [ ] Commit `feat(qa): exclude assessor-owned fields from every LLM call`.

### Task 1.4: payload — ids + contribution (§4)

**Files:**
- Modify: `backend/app/schemas/extraction_run.py`,
  `backend/app/services/derived_judgment_payload.py`
- Modify: `frontend/types/api/*` (generated), `frontend/hooks/runs/types.ts`
- Test: `backend/tests/unit/test_run_view_derived_judgments.py`

**Interfaces produced:**

```python
class RunViewDerivedInput(BaseModel):
    label: str
    value: str | None = None
    contribution: str | None = None

class RunViewDerivedJudgment(BaseModel):
    id: str
    label: str
    value: str | None = None
    inputs: list[RunViewDerivedInput] = Field(default_factory=list)
    target_entity_type_id: UUID | None = None
    target_field_id: UUID | None = None
    rationale_field_id: UUID | None = None
    summary_field_id: UUID | None = None
```

- [ ] Failing tests: recommendation entry resolves the three ids from
  the frozen tree (widen the `known` loop at
  `derived_judgment_payload.py:84-93` to a name→ids map); overall
  entry resolves only `summary_field_id`; dangling target coordinate →
  ids None + `qa_derived_spec_dangling_ref` (now fires via the
  Task 1.1 `spec_coordinates` widening); v1-shaped spec → all four ids
  None; 12 entries for v2 / 4 for v1; `contribution` passes through to
  `RunViewDerivedInput`.
- [ ] Implement; `npm run generate:api-types`; extend the
  `frontend/hooks/runs/types.ts` mirror minimally (ids + contribution
  as optional fields). Known limitation, acknowledged not solved:
  accordion matching crosses live (template hook) vs frozen (payload)
  field ids — ids are stable through snapshots today; a live
  delete+recreate makes a card vanish with only the backend log.
- [ ] Run payload tests + `npx tsc -p tsconfig.app.json`; commit
  `feat(qa): derived-judgment payload carries target/rationale/summary ids`.

### Task 1.5: PR1 gate + ship

- [ ] `cd backend && uv run pytest tests/unit -q` (baseline was
  2447 passed) and `make lint-backend`; markdownlint the docs (the
  instrument doc passes today; keep it that way).
- [ ] Commit docs + plan (already on the branch) + `.markdownlintignore`
  entry.
- [ ] Push, `gh pr create --base dev`, wait checks, arm auto-merge when
  the train is clear.

---

## PR2 — seed v2 (§5)

Branch off dev after PR1 merges (the seeded spec uses
`signaling_worst`, which must exist first).

### Task 2.1: seed helpers grow explicit knobs

**Files:**
- Modify: `backend/app/seed.py` (`_field`, `_signaling`)
- Test: `backend/tests/unit/test_seed_dispositions.py`

- [ ] `_field` gains `is_required: bool = True` and accepts
  `llm: str | None` (None → `llm_description=None`); update its
  now-false docstring claim ("is_required is always True") —
  clean-in-code-you-touch. `_signaling` gains
  `allows_not_applicable: bool | None = None` (None keeps the
  identity-based default so classic seeds stay byte-identical; an
  explicit bool overrides). Failing tests first: knobs respected;
  existing classic-seed tests stay green untouched.
- [ ] Commit `refactor(seed): explicit NA/required/llm knobs on the shared field helpers`.

### Task 2.2: rewrite `seed_probast_ai.py` for v2

**Files:**
- Rewrite: `backend/app/seed_probast_ai.py` (wholesale)
- Modify: `backend/app/seed.py` — `backfill_llm_template_instructions`
  imports `_PROBAST_AI_TEMPLATE_ID` from the seed module
  (`seed.py:3177`): the wholesale constant change repoints it to the
  v2 UUID **in the same commit** (residual: a v1 row with a NULL
  instruction on an old DB is never backfilled again — acceptable for
  a superseded template).
- Test: `backend/tests/unit/test_seed_probast_ai.py` (rewrite),
  `backend/tests/unit/test_seed_dispositions.py` (42-all-NA becomes
  6-of-42), `backend/tests/integration/test_qa_seed.py` (4/10/58 pins
  → 12/13/95),
  `backend/tests/unit/test_derived_judgment_no_information.py` —
  **freeze the current v1 `_PAI_DERIVED_JUDGMENTS` as a module-local
  literal there** (annotated as the shape v1 clone `schema_` rows
  still carry in prod), keep `test_prod_run_21681ee0_now_computes` and
  the v1 scenarios against it, ADD v2-shaped scenarios as new tests
  (panel blocker 4).

Content per §5's table + the instrument doc's item map: template id
`00ba0000-0000-0000-0000-000000000002`, entity types
`00ba000N-0000-0000-0000-000000000002`, `version="2.0.0"`, 13 sections
/ 95 fields, NA on exactly the 6 conditional rows,
`_ANSWER_INSTRUCTION` with/without-NA variants, describes/rationales/
summaries optional text, judgments+rationales+summaries `llm=None`,
applicability `llm_description` rewritten per §5, `derived_judgments` =
8 `signaling_worst` recommendations (`target`/`rationale`; eval-D4's
inputs carry the gate as plain input + three `worst_of` collapse
groups) + 4 `worst_domain` overalls (`summary`) over STORED judgment
coordinates (eval RoB overall reads eval d1–d3 `risk_of_bias` +
`eval_d4_judgment.risk_of_bias` — no collapse in overalls).

- [ ] Failing seed tests first (counts 13/95, NA on exactly 6 rows, 20
  excluded fields carry no `llm_description`, optionality, `study_type`
  required select, spec resolves — inputs/target/rationale/summary each
  name a seeded field — new UUIDs, idempotency, v2-only seeding).
- [ ] Implement; keep under 800 lines (table-driven; split data module
  if needed).
- [ ] `uv run pytest tests/unit/test_seed_probast_ai.py tests/unit/test_seed_dispositions.py tests/unit/test_derived_judgment_no_information.py -q`.
- [ ] ListAgents + message peers (db-fresh wipes their data AND v1
  PROBAST+AI ceases to exist on the fresh DB); `make db-fresh`; verify
  by count; `uv run pytest tests/integration/test_qa_seed.py tests/integration/test_seed_llm_instructions.py -q`
  (a stale mixed v1+v2 DB makes `scalar_one()` on the name raise —
  db-fresh is the documented reason).
- [ ] Commit `feat(qa): PROBAST+AI 2.0.0 seed — instrument-exact 13×95 under a new UUID`.

---

## PR3 — frontend (§6)

Branch off dev after PR2 (manual verification needs the v2 seed; unit
tests are fixture-driven).

### Task 3.1: recommendation card in `QASectionAccordion`

**Files:**
- Modify: `frontend/components/assessment/QASectionAccordion.tsx`,
  `frontend/pages/QualityAssessmentFullScreen.tsx` (pass
  `derived_judgments` down), `frontend/lib/copy/qa.ts`,
  `frontend/components/assessment/OverallJudgmentBanner.tsx` (export
  `toneFor` — ONE color mapping for the judgment vocabulary, no second
  table)
- Create: `frontend/components/assessment/DerivedDefaultChip.tsx`
  (props typed off `schema.d.ts`'s `RunViewDerivedJudgment`)
- Test: `frontend/components/assessment/QASectionAccordion.test.tsx`,
  new `DerivedDefaultChip` test

Matching: a judgment field whose `field.id` equals an entry's
`target_field_id` gets the card: derived-default chip (entry.value or
incomplete copy), breakdown rows from `entry.inputs` (raw `value`
displayed; rows highlighted when `contribution === entry.value` —
zero rule knowledge client-side; colors via `toneFor(contribution)`),
**Apply** dispatching `onValueChange(fieldId, entry.value)`, and the
Task 3.2 gate. The paired rationale field renders INSIDE the judgment
card (below the judgment input); the accordion's SQ-count badge counts
only true signaling questions (exclude describes/rationales matched
via the entry ids from the summary partition). Judgment fields with no
matching entry render exactly as today (v1 clones, classic templates,
applicability — keep-list).

- [ ] Failing tests: chip + breakdown + highlight-by-contribution;
  Apply dispatches; no card when no entry matches (positive control);
  badge count excludes non-SQ fields on a v2-shaped fixture.
- [ ] Implement; delete the synthetic `instanceId` fallback
  (`instanceIdProp ?? entityType.id`) and make the prop required
  (binding deletion — the sole caller always passes the real id).
- [ ] Commit per component.

### Task 3.2: divergence-rationale gate

**Files:** `QASectionAccordion.tsx` / `DerivedDefaultChip.tsx`, copy,
tests.

Contract: when the judgment select's new value diverges from a
non-null derived default AND the paired rationale (via
`rationale_field_id`) is empty in `values`, the card HOLDS the
judgment locally (divergence styling + rationale requirement copy) and
does not dispatch `onValueChange` for it. Dispatch happens on an
explicit confirm affordance in the card once the rationale has text —
NOT via an effect watching rationale keystrokes (predictability).
Apply and default-matching picks dispatch immediately. Hydrated
pre-existing divergence shows the divergence state but never blocks.
**Held-value volatility is pinned, not accidental:** the held value
never enters `values`, so run-switch/unmount/mark-ready drop it — by
design, with the requirement copy visible while held; tests pin that
no phantom POST fires and the held value is gone after a simulated
navigation.

- [ ] Failing tests: divergent pick → no dispatch + hint; rationale +
  confirm → dispatched; matching pick dispatches immediately; null
  default never gates; hydrated divergence never blocks; held value
  dropped on unmount with zero POSTs.
- [ ] Implement + commit.

### Task 3.3: scope & summaries sections; banner filter

**Files:** `QualityAssessmentFullScreen.tsx`,
`OverallJudgmentBanner.tsx`, copy, tests.

- [ ] Banner renders entries with `target_field_id == null` ONLY
  (loose `== null` — older payloads/fixtures omit the key entirely;
  explicit undefined-vs-null test since `types.ts` is hand-mirrored).
  `overall_judgement` section renders each summary field beside its
  computed overall (matched via `summary_field_id`);
  `assessment_scope` renders first (sort_order); `study_type` badges
  which parts apply (display hint only). Failing tests first; commit.

### Task 3.4: AI-affordance hiding (shrunk per panel)

**Files:** `QASectionAccordion.tsx`; backend pin in
`backend/tests/unit/test_section_extraction_service.py` (if not
already covered by Task 1.3's tests).

Per-field badge/history withholding is vacuous — PR1's server-side
exclusion means no suggestion can exist for an excluded field on v2,
and v1 clones (empty exclusion set) keep today's behavior. The live
parts only:

- [ ] Hide `SectionAIExtractButton` when every field of the section is
  excluded (union of entry ids covering the section's fields —
  `overall_judgement`'s case); failing accordion test first.
- [ ] Verify Task 1.3 already pins "no proposal is ever created for an
  excluded coordinate" (it does — the exact-list control); if the
  header pending-count can still surface excluded-field suggestions
  from PRE-v2 data, filter at the page level (no
  `suggestionUtils.ts` change).
- [ ] Commit.

### Task 3.5: PR3 gate

- [ ] `npm run lint`, `npx tsc -p tsconfig.app.json`, `npm run test:run`.
- [ ] Manual design-review loop on the QA screen against the local v2
  seed: chips, gate, summaries, hidden AI affordances, **evidence
  locate on an SQ row** (§6), and the §12 manual autosave check —
  answer an SQ, hit J/K within the debounce window, value lands on the
  OLD run, no error toast on the new one.
- [ ] Ship.

---

## PR4 — export + observability (§8, §9)

Branch off dev after PR1 (independent of PR2/PR3; last on the train).

### Task 4.1: derived columns = overalls only

**Files:** `backend/app/services/extraction_export_service.py`,
test `backend/tests/unit/test_appraisal_derived_overalls.py`.

- [ ] Failing test: a v2-shaped spec (8 recommendations + 4 overalls)
  yields exactly the 4 overall labels/values as derived columns.
- [ ] Implement with the rule module's discriminator — 
  `spec = [d for d in derived_spec(template_schema) if not is_recommendation(d)]`
  at the single read site (`:661`) — no raw key probe in the export.
  Commit.

### Task 4.2: export-path dangling warning

- [ ] Failing test: an unresolvable spec coordinate logs
  `qa_derived_spec_dangling_ref` on the export path (structlog
  capture); resolvable spec silent. Implement via the known
  `(section.name, field.name)` set already walked in
  `_build_appraisal_model`. Commit.

### Task 4.3: parity + verdict-column pins

- [ ] Extend `test_derived_overall_screen_workbook_parity.py`: overall
  entries under v2-shaped stored values agree screen/workbook; plus a
  rule-level both-caller-shapes case for `signaling_worst` (raw
  envelope vs resolved label agree).
- [ ] Pin `_is_verdict` on the v2 shapes: the three D4 type sections,
  `assessment_scope`, and `overall_judgement` contribute no verdict
  column; `eval_d4_judgment` contributes exactly one.
- [ ] Full backend unit sweep; ship.

---

## Ordering & merge-train

PR0 (#684) → PR1 → PR2 → PR3 → PR4, one armed auto-merge at a time;
unstick BEHIND PRs via `gh api -X PUT .../update-branch`. Prod
promotion is out of scope for this run (ceiling = dev).

## Self-review notes

- Spec coverage: §1→1.1/1.2, §2→1.1+2.2, §3→1.3, §4→1.4, §5→2.x,
  §6→3.x, §7 no-op, §7b→PR0, §8→4.1/4.3, §9→1.3(extraction)+1.4
  (payload, via spec_coordinates)+4.2(export), §10 local-only, §11
  docs-only, §12 distributed per task (incl. the manual autosave check
  in 3.5).
- The §2 spec-shape change moves the D4 collapse OUT of the eval
  overall and INTO the eval-D4 recommendation — collapse support stays
  load-bearing for v1 clones + the recommendation groups (keep-list).
- v1 clones keep computing: their 4-entry spec resolves against v1's
  own frozen tree; guarded by the frozen v1 literal in
  `test_derived_judgment_no_information.py` (Task 2.2).
- Known-inert, kept because spec-mandated: `target_entity_type_id`
  (matching is by field id) and the resolved-label caller shape for
  `signaling_worst` (post-4.1 the export never computes
  recommendations) — both cheap, both future-proof for §11 adopters.
