---
status: draft
last_reviewed: 2026-07-01
owner: '@raphaelfh'
---

# absent_reason marker — Phase 2 + Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ADR-0016 spec Phases 2 (template config + select unification +
the runtime "No information" control) and 3 (finalized-data Alembic migration +
FE shim removal), so every stored disposition becomes the type-independent
`{value:null, absent_reason:<code>}` marker and no in-band disposition string
survives in any encoding.

**Architecture:** Two chained Alembic migrations — `0038` (schema: two opt-in
flag columns on `extraction_fields`) and `0039` (data: rewrite stored
disposition strings → marker across proposals/decisions/published, scoped by the
frozen per-run version snapshot). A backend pure helper maps recognized
disposition strings to markers and is the single write-time choke-point; the
runtime `FieldInput` gains a "No information" control on all field types so the
seed drop never removes the capability. FE `isAbstention` narrows from the
Phase-0 transitional union to the pure marker shape once the data is migrated.

**Tech Stack:** Python 3.11 / SQLAlchemy 2.0 async / Alembic / Pydantic v2 /
pytest (backend); React 19 + TS strict / vitest (frontend).

## Global Constraints

- English only for code, comments, commits, docs, copy keys.
- SQLAlchemy model change ⇒ Alembic migration; **revision id ≤ 32 chars**.
- App schema = Alembic only; never `mcp__supabase__apply_migration`.
- Migration touching `extraction_*` ⇒ bump migration-head line + `last_reviewed`
  in `docs/reference/extraction-hitl-architecture.md`.
- FE data path: component → hook → service → apiClient; no `fetch()` /
  `supabase.from(` in components; copy through `frontend/lib/copy/`.
- React Compiler `panicThreshold: all_errors`: no `try/finally` / `throw` in
  component/hook bodies; IO through `services/*` returning `ErrorResult`.
- Generated API types are never hand-edited: `npm run generate:api-types` after a
  Pydantic/endpoint change; the `api-contract` CI job must stay green.
- Disposition vocabulary + target codes (the ONE mapping table, used by the
  write-path helper AND the data migration):

  | In-band string | Marker code |
  |---|---|
  | `No information` | `no_information` |
  | `Not applicable` | `not_applicable` |
  | `Not evaluated` | `not_evaluated` |
  | `NI` (PROBAST) | `no_information` |
  | `NA` (PROBAST) | `not_applicable` |

  `Unclear` is a **substantive** value — never mapped. Scoping rule (both
  write-path and migration): convert value `V` on field `F` **iff** `V` is a
  recognized disposition string AND `V ∈ F`'s allowed_values (live field for new
  writes; frozen snapshot for the migration). A coincidental free-text match on a
  field whose domain lacks `V` is left untouched.

---

## Design decisions (resolved; panel to pressure-test)

1. **Scope = full Phase 2 + Phase 3, spec-faithful, PLUS the minimal runtime
   `FieldInput` "No information" control on all field types** (owner decision
   2026-07-01 — avoids the "seed drops the string but nothing can set it"
   regression). Distinct abstention *rendering*, bulk-accept safeguard, export,
   divergence, and the `not_applicable`/`not_evaluated` opt-in *controls* stay in
   Phase 4. The runtime control ships `no_information` on all types + the
   opt-in dispositions where the field enables them (reading the new flags).
2. **One combined PR** carrying both spec-phases (two chained migrations). The
   schema + data migrations deploy atomically; the FE shim removal lands with the
   marker writers so there is never a prod state where markers are written but
   unreadable.
3. **Write-time string→marker mapping lives at the backend choke-point** — a pure
   helper applied in `ExtractionProposalService.record_proposal`,
   `ExtractionReviewService.record_decision`, and the consensus publish — so AI
   `found`-disposition (transitional, existing runs) and a human picking a legacy
   dropdown string both normalize to the marker in one place. The FE runtime
   control writes the marker directly; the BE helper is the safety net + single
   rule. Scoped by the field's **live** `allowed_values`; existing-run snapshots
   still carry the string so the dropdown still renders it, and the helper
   recognizes it because the reserved vocabulary check does not depend on the
   live seed. (See "Open question O1".)
4. **`isAbstention` narrows to pure marker-shape** in Phase 3. A pre-Phase-1
   bare-null `not_found` proposal (old runs) then reads as *unresolved*, not an
   abstention — correct per the spec (a bare null IS unresolved); the data
   migration converts disposition **strings**, not bare nulls, so this is the
   intended, documented consequence.

### Open questions for the adversarial panel

- **O1 (choke-point scoping):** Should the write-path helper scope by the run's
  frozen snapshot `allowed_values` (heavy: per-field snapshot lookup at
  `/decisions`) or treat the 5-string vocabulary as globally reserved
  (unconditional convert, risking a user template that uses `NA`/`NI` as a
  substantive value)? Proposed: **reserved-vocabulary, unconditional at write
  time** (no substantive prumo field uses these strings as real values; the
  runtime control is the forward path), with the migration doing the
  snapshot-scoped conversion for historical data.
- **O2 (downgrade fidelity):** `0039.downgrade` marker→string is lossy for
  PROBAST (`NI`/`NA` and full-word both map in). Proposed: downgrade emits the
  **full-word** canonical string (`no_information`→`No information` etc.);
  document the PROBAST-abbreviation loss. Acceptable for a forward-only prod
  migration whose `--sql` is reviewed both directions.
- **O3:** Does narrowing `isAbstention` break the Phase-0 call-site snapshot
  tests (`AISuggestionDisplay:112`, `AISuggestionReviewPopover:91`,
  `countNonAbstentionSuggestions`)? Those tests must be updated to the
  post-migration truth table in the same task.

---

## File structure

**Backend**
- `backend/app/models/extraction.py` — +2 `Mapped[bool]` columns on `ExtractionField`.
- `backend/alembic/versions/0038_field_disposition_flags.py` — schema migration.
- `backend/alembic/versions/0039_absent_reason_backfill.py` — data migration.
- `backend/app/services/extraction_snapshot.py` — +2 keys in `SNAPSHOT_SQL`.
- `backend/app/services/value_semantics.py` — new `disposition_to_marker` helper.
- `backend/app/services/extraction_proposal_service.py` — apply helper in `record_proposal`.
- `backend/app/services/extraction_review_service.py` — apply helper in `record_decision`.
- `backend/app/services/extraction_consensus_service.py` — apply helper at publish.
- `backend/app/seed.py` — drop disposition strings; set opt-in flags via `_f`.

**Frontend**
- `frontend/types/extraction.ts` — +2 flags on the `ExtractionField` type/schema.
- `frontend/components/extraction/FieldInput.tsx` — runtime "No information" control.
- `frontend/components/extraction/dialogs/AddFieldDialog.tsx` + `EditFieldDialog.tsx` — opt-in flag toggles.
- `frontend/lib/ai-extraction/suggestionUtils.ts` — narrow `isAbstention`.
- `frontend/lib/copy/` — new copy keys for the control + toggles.

**Docs / generated**
- `docs/reference/extraction-hitl-architecture.md` — migration-head + `last_reviewed`.
- `frontend/types/api/{openapi.json,schema.d.ts}` — regenerated.

---

## PHASE 2 — Template config + select unification + runtime control

### Task 1: `allows_not_applicable` / `allows_not_evaluated` columns + migration 0038

**Files:**
- Modify: `backend/app/models/extraction.py` (class `ExtractionField`, ~line 333)
- Create: `backend/alembic/versions/0038_field_disposition_flags.py`
- Test: `backend/tests/integration/test_migration_roundtrip.py`

**Interfaces:**
- Produces: `ExtractionField.allows_not_applicable: bool`,
  `ExtractionField.allows_not_evaluated: bool` (default `False`, `NOT NULL`).

- [ ] **Step 1:** Add roundtrip test `test_migration_0038_round_trip` (col present
  at head; absent after `downgrade 0037_block_type_figure`; restored on `upgrade head`).
- [ ] **Step 2:** Run it — expect FAIL (columns absent at head).
- [ ] **Step 3:** Add the two columns to `ExtractionField`:
  ```python
  allows_not_applicable: Mapped[bool] = mapped_column(
      Boolean, nullable=False, server_default=text("false")
  )
  allows_not_evaluated: Mapped[bool] = mapped_column(
      Boolean, nullable=False, server_default=text("false")
  )
  ```
- [ ] **Step 4:** Write `0038` (`revision = "0038_field_disposition_flags"` — 28
  chars; `down_revision = "0037_block_type_figure"`). `upgrade`: `op.add_column`
  both with `server_default=sa.text("false")`, `nullable=False`. `downgrade`:
  `op.drop_column` both.
- [ ] **Step 5:** `cd backend && uv run alembic upgrade head` then the roundtrip
  test — expect PASS.
- [ ] **Step 6:** Commit.

### Task 2: Propagate the flags into the version snapshot

**Files:**
- Modify: `backend/app/services/extraction_snapshot.py` (`SNAPSHOT_SQL`)
- Test: `backend/tests/integration/test_template_versions_lifecycle.py`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `version.schema_.entity_types[].fields[].allows_not_applicable` +
  `.allows_not_evaluated`.

- [ ] **Step 1:** Add a test asserting a freshly-built snapshot's field objects
  carry both flag keys.
- [ ] **Step 2:** Run — FAIL (keys absent).
- [ ] **Step 3:** Add `'allows_not_applicable', f.allows_not_applicable,` and
  `'allows_not_evaluated', f.allows_not_evaluated,` to the field
  `jsonb_build_object` in `SNAPSHOT_SQL`. (Migration 0026's embedded copy is
  historical — do NOT touch it; the WARNING comment in the file only concerns the
  key-set backfill, which does not need these new columns retroactively.)
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit.

### Task 3: Seed — drop disposition strings, set opt-in flags

**Files:**
- Modify: `backend/app/seed.py` (constants ~148-162; `_f` helper ~357; the
  `allowed=[...]` inline lists carrying `"No information"`)
- Test: `backend/tests/integration/` (a seed-shape assertion) or a unit test over
  the constant lists.

**Interfaces:**
- Consumes: Task 1 columns; `_f(..., allows_not_applicable=..., allows_not_evaluated=...)`.

- [ ] **Step 1:** Test: after seeding, NO seeded field's `allowed_values`
  contains any of `{"No information","Not applicable","Not evaluated","NI","NA"}`;
  fields formerly on `_YES_NO_NOTAPP_NI` have `allows_not_applicable=True`; fields
  on `_YES_NO_NOTEVAL_NI` have `allows_not_evaluated=True`; PROBAST signaling
  fields (formerly `NI`/`NA`) have `allows_not_applicable=True`; `"Unclear"`
  survives on `_YES_NO_UNCLEAR` / `_QUADAS2_*`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Rewrite the constant lists (`_YES_NO_UNCLEAR = ["Yes","No","Unclear"]`,
  `_YES_NO_NI = ["Yes","No"]`, `_YES_NO_NOTEVAL_NI = ["Yes","No"]`,
  `_YES_NO_NOTAPP_NI = ["Yes","No"]`, `_PROBAST_SIGNALING = ["Y","PY","PN","N"]`);
  drop `"No information"` from the inline `allowed=[...]` lists; add
  `allows_not_applicable`/`allows_not_evaluated` params to `_f` and set them on the
  fields that used the `*_NOTAPP_*` / `*_NOTEVAL_*` / PROBAST-signaling sets.
  (Rename the now-misnamed constants only if it stays surgical; else keep names +
  a comment. `_YES_NO_NI == _YES_NO_NOTEVAL_NI == _YES_NO_NOTAPP_NI == ["Yes","No"]`
  now — collapse to a single `_YES_NO` constant and set flags at the field, which
  is cleaner/no-legacy.)
- [ ] **Step 4:** Run — PASS. Re-seed locally (`make db-fresh`) and eyeball a
  PROBAST field.
- [ ] **Step 5:** Commit.

### Task 4: Backend `disposition_to_marker` helper + write choke-points

**Files:**
- Modify: `backend/app/services/value_semantics.py` (new helper)
- Modify: `backend/app/services/extraction_proposal_service.py` (`record_proposal`)
- Modify: `backend/app/services/extraction_review_service.py` (`record_decision`)
- Modify: `backend/app/services/extraction_consensus_service.py` (publish path)
- Test: `backend/tests/unit/test_value_semantics.py` +
  `backend/tests/integration/test_extraction_proposal_service.py` (or the review/consensus suites)

**Interfaces:**
- Produces:
  ```python
  _DISPOSITION_CODES: dict[str, AbsentReason] = {
      "No information": AbsentReason.NO_INFORMATION,
      "Not applicable": AbsentReason.NOT_APPLICABLE,
      "Not evaluated": AbsentReason.NOT_EVALUATED,
      "NI": AbsentReason.NO_INFORMATION,
      "NA": AbsentReason.NOT_APPLICABLE,
  }
  def disposition_to_marker(envelope: Any) -> Any:
      """If the envelope's peeled value is a recognized in-band disposition
      string, return {'value': None, 'absent_reason': <code>}; else return the
      envelope unchanged. Pure; no DB. Already-marker input is returned as-is."""
  ```
- [ ] **Step 1:** Unit table: `{"value":"No information"}` → marker;
  `{"value":"NI"}` → `no_information`; `{"value":"NA"}` → `not_applicable`;
  `{"value":"Unclear"}` unchanged; `{"value":"Retrospective"}` unchanged;
  already-`{value:null,absent_reason:...}` unchanged; bare `"No information"`
  (unenveloped) → marker.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `disposition_to_marker`.
- [ ] **Step 4:** Apply it at the three write choke-points to the incoming
  `proposed_value` / `value` before persistence (human + AI). Add an integration
  test: POST a `/decisions` with `value={"value":"No information"}` persists a
  marker (`ExtractionReviewerDecision.value == {"value":None,"absent_reason":"no_information"}`);
  a `/decisions` with `value={"value":"Cohort"}` is untouched.
- [ ] **Step 5:** Run unit + integration — PASS.
- [ ] **Step 6:** Commit.

### Task 5: Runtime `FieldInput` "No information" control (all field types)

**Files:**
- Modify: `frontend/components/extraction/FieldInput.tsx`
- Modify: `frontend/lib/copy/` (keys: `noInformationLabel`, `noInformationHint`,
  `notApplicableLabel`, `notEvaluatedLabel`, `clearDisposition`)
- Modify: `frontend/types/extraction.ts` (+`allows_not_applicable`, `allows_not_evaluated`)
- Test: `frontend/components/extraction/FieldInput.test.tsx`

**Interfaces:**
- Consumes: `field.allows_not_applicable`, `field.allows_not_evaluated`;
  `valueAbsentReason` (already in `suggestionUtils`/`valueSemantics`).
- Produces: activating the control calls `onChange({value:null, absent_reason:<code>})`;
  clearing calls `onChange('')`.
- [ ] **Step 1:** Component test: for each of text/number/date/select, rendering
  the control and activating "No information" fires
  `onChange({value:null, absent_reason:'no_information'})`; when
  `allows_not_applicable` the "Not applicable" option appears and writes
  `not_applicable`; when the flag is false it does not render; a marker value
  renders the control in the active/selected state; clearing fires `onChange('')`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Add a small, unobtrusive control (a subtle toggle/menu beside/
  below `renderInput()`), visible on all field types. Read the current marker via
  `valueAbsentReason(value)`. Wire copy through `t('extraction', …)`. Keep it out
  of the React-Compiler danger zone (no try/finally; pure handlers).
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Verify autosave: activating the control produces the full
  envelope so `extractValueForSave` (already carries `absentReason`, Phase 1)
  round-trips it; add/extend an autosave-dirty case if needed
  (`frontend/lib/extraction/autosaveDirty.test.ts`: baseline == current on mount
  for a marker; editing an adjacent field never restripes the marker coord).
- [ ] **Step 6:** Commit.

### Task 6: Template-builder opt-in flag toggles

**Files:**
- Modify: `frontend/components/extraction/dialogs/AddFieldDialog.tsx`
- Modify: `frontend/components/extraction/dialogs/EditFieldDialog.tsx`
- Modify: `frontend/lib/copy/` (toggle labels/hints)
- Test: the dialog test(s) if present, else a focused render test.

**Interfaces:**
- Consumes: Task 5 types.
- Produces: the create/edit payload carries `allows_not_applicable` /
  `allows_not_evaluated`.
- [ ] **Step 1:** Test: toggling "Allow 'Not applicable'" includes
  `allows_not_applicable: true` in the submitted payload; default false.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Add two `Switch` rows (mirroring the existing `allowOther`
  pattern at `AddFieldDialog.tsx:353-367`). `no_information` needs no builder
  control (it is universal). Wire copy.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit.

### Task 7: API types + AI-schema consequence check

**Files:**
- Regenerate: `frontend/types/api/{openapi.json,schema.d.ts}`
- Test: `backend/tests/unit/` (llm schema) — assert a re-seeded field's output
  model `Literal` excludes disposition strings.

- [ ] **Step 1:** Add a unit test: build the output model for a seeded PROBAST
  signaling field; its `value` `Literal` contains `Y/PY/PN/N` and NOT `NI/NA`.
- [ ] **Step 2:** Run — should PASS already once Task 3 lands (consequence of the
  seed drop). If a transitional `found`-disposition can still arrive from an
  existing-run snapshot, that is normalized by Task 4's helper at recording.
- [ ] **Step 3:** `npm run generate:api-types`; commit the diff (the two new
  `ExtractionField` columns surface wherever the field is serialized).
- [ ] **Step 4:** `npm run lint && npx tsc --noEmit` for the FE slice — PASS.
- [ ] **Step 5:** Commit.

---

## PHASE 3 — Data migration + FE shim removal

### Task 8: Data migration 0039 — disposition strings → marker (all runs incl. finalized)

**Files:**
- Create: `backend/alembic/versions/0039_absent_reason_backfill.py`
- Test: `backend/tests/integration/test_migration_0039_backfill.py` +
  `test_migration_roundtrip.py` (roundtrip + head-pin bump to `0039`)

**Interfaces:**
- Consumes: nothing from app code (migrations are self-contained — inline the
  mapping table + scoping SQL/Python).
- Rewrites: `extraction_proposal_records.proposed_value`,
  `extraction_reviewer_decisions.value`, `extraction_published_states.value`.

- [ ] **Step 1:** Integration test `test_migration_0039_backfill`:
  seed a run whose **frozen snapshot** has a field with `"No information"` in
  `allowed_values`; insert a proposal `{"value":"No information"}`, a reviewer
  decision `{"value":"NI"}` on a PROBAST-snapshot field, a published
  `{"value":"Not applicable"}`; also insert a proposal `{"value":"Cohort"}` and a
  free-text `{"value":"NA"}` on a field whose snapshot domain lacks `NA`.
  Downgrade to `0038` then upgrade head; assert dispositions became markers
  (`{value:null, absent_reason:…}`), `"Cohort"` and the coincidental `"NA"` are
  untouched, and an `accept_proposal` decision with null `value` was NOT
  double-handled (its correctness comes from the migrated proposal).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `0039` (`revision = "0039_absent_reason_backfill"` — 26
  chars; `down_revision = "0038_field_disposition_flags"`). `upgrade`: for each of
  the three tables, join each row to its run's frozen
  `extraction_template_versions.schema_`, resolve the row's field domain from the
  snapshot (`entity_types[].fields[]` by `field.id`), and where the row's peeled
  `value` is a disposition string present in that domain, set the JSONB to
  `{"value": null, "absent_reason": <code>}`. Prefer set-based SQL with a
  `jsonb`-path lookup; fall back to a batched Python loop over
  `connection.execute` if the SQL gets unreadable (migrations run once — clarity
  > cleverness, but no unbounded full-table Python materialization). `downgrade`:
  marker → full-word canonical string (O2), scoped the same way.
- [ ] **Step 4:** `alembic upgrade head`; run the backfill + roundtrip tests — PASS.
- [ ] **Step 5:** Offline safety: `uv run alembic upgrade 0038:0039 --sql` and
  `downgrade 0039:0038 --sql`; read both, confirm no `DROP`/data-loss surprise and
  the scoping predicate is present. Bump `test_alembic_head_is_expected_revision`
  to `0039_absent_reason_backfill`.
- [ ] **Step 6:** Commit.

### Task 9: Narrow `isAbstention` + remove the FE legacy tolerance

**Files:**
- Modify: `frontend/lib/ai-extraction/suggestionUtils.ts` (`isAbstention`)
- Test: `frontend/test/suggestionUtils.test.ts` + the call-site tests
  (`AISuggestionDisplay`, `AISuggestionReviewPopover`)

**Interfaces:**
- Produces: `isAbstention(value)` = `valueAbsentReason(value) !== null` only.
- [ ] **Step 1:** Update `suggestionUtils.test.ts`: `isAbstention(null)` /
  `undefined` / `''` → **false** now; `{value:null, absent_reason:'no_information'}`
  → true; `'No information'` (bare string) → false; garbage code → false.
- [ ] **Step 2:** Run — FAIL (still union).
- [ ] **Step 3:** Narrow `isAbstention` to the pure marker shape; update the
  docstring (drop the transitional-union note). Audit `AISuggestionDisplay:112`,
  `AISuggestionReviewPopover:91`, `countNonAbstentionSuggestions` and fix their
  tests to the post-migration truth table (a bare-null old proposal is unresolved,
  not an abstention).
- [ ] **Step 4:** Run the FE suite — PASS.
- [ ] **Step 5:** Commit.

### Task 10: Docs + head-pin + arch reference

**Files:**
- Modify: `docs/reference/extraction-hitl-architecture.md` (migration-head line +
  `last_reviewed: 2026-07-01`)
- (Constitution §IX + ADR-0016 finalization are Phase 5 — out of scope.)

- [ ] **Step 1:** Update the migration-head line to `0039_absent_reason_backfill`
  and `last_reviewed`.
- [ ] **Step 2:** `make quality-scan` (full gate) — read output; fix any red.
- [ ] **Step 3:** Commit.

---

## Test strategy (evidence before "done")

- **Unit:** `disposition_to_marker` table; llm-schema Literal excludes NI/NA.
- **Integration (needs local Supabase):** write choke-point normalizes a picked
  disposition; snapshot carries flags; 0038 + 0039 roundtrip; 0039 backfill
  (finalized run via snapshot scope, coincidental-match untouched, accept_proposal
  inheritance, `--sql` both directions).
- **FE (vitest):** FieldInput control per type; builder toggles; `isAbstention`
  narrowed truth table + call sites; autosave marker no-regression.
- **Gate:** `make quality-scan` + `make test-backend` + `npm run test:run` +
  `npm run generate:api-types` clean.

## Adversarial panel reconciliation (BINDING — supersedes conflicts above)

Five lenses reviewed this plan. Verdicts: security GREEN, simplicity GREEN,
layering/migration/test-coverage BLOCKING. Binding revisions:

**R-O1 (mapping ownership + scoping).** ONE pure helper
`disposition_to_marker(envelope, allowed_values)` in `value_semantics.py`
(docstring: "the single write-time disposition normalizer"). Apply at
`record_proposal` + `record_decision` **input only**. **CUT the consensus site**
(it republishes an already-normalized `selected.value` / `proposal.proposed_value`
— redundant). **Domain-scoped** by the field's **live** `allowed_values` (one PK
`select` in the service — cheap, not a snapshot reload): convert iff the peeled
value is a reserved disposition string AND ∈ that field's `allowed_values`. This
protects a coincidental free-text `"NA"` (a text field has null `allowed_values`
→ not converted) while treating a disposition-as-select-option as the disposition
(spec-correct). Also catches an AI `found`-disposition on an existing run
(re-run AI; live field still carries the string pre-re-seed) — the path
simplicity underweighted.

**R-B1/B2/B3 (typed contract — `from_attributes` does NOT auto-surface columns).**
Add explicit tasks:
- `backend/app/schemas/extraction_run.py:177` `RunViewField` — add
  `allows_not_applicable: bool = False`, `allows_not_evaluated: bool = False`
  (else Task 5's FieldInput never receives them). **Task 1b.**
- `backend/app/schemas/extraction.py:308` `ExtractionFieldSchema` — add the two
  with camelCase aliases (`allowsNotApplicable`/`allowsNotEvaluated`) for the
  template-read surface. **Task 1b.**
- `frontend/types/extraction.ts:114,368,407,418` — extend the `ExtractionField`
  type + Zod `ExtractionFieldSchema`/insert/update so the **Supabase-direct**
  builder write (`extractionFieldService.ts`, pre-existing legacy — surgical, do
  NOT convert to API) carries the flags. **Task 6.**

**R-MIG (migration 0039).**
- **upgrade = set-based SQL** — one `UPDATE … FROM extraction_runs r JOIN
  extraction_template_versions v ON r.version_id=v.id, LATERAL
  jsonb_array_elements(v.schema_->'entity_types') et, LATERAL
  jsonb_array_elements(et->'fields') f` per (disposition string × table); predicate
  `(f->>'id')::uuid = <fk>.field_id AND <col>->>'value' = '<str>' AND
  f->'allowed_values' ? '<str>' AND (<col>->'absent_reason') IS NULL`
  (idempotent; scalar-only via `->>'value'` so multiselect lists are skipped). So
  `--sql` renders it (BLOCKER 2). 5 strings × 3 tables.
- **downgrade = domain-correct** (NOT unconditional full-word — that writes
  domain-invalid data into a PROBAST snapshot, BLOCKER 1). For each code, emit the
  disposition string actually present in that field's snapshot domain
  (`"NI"` for PROBAST, `"No information"` for `_YES_NO_*`). Each field's domain has
  exactly one string per code (seed table), so the inverse is unambiguous +
  set-based + testable.
- **head-pin per task** (BLOCKER 3): Task 1 bumps
  `test_alembic_head_is_expected_revision` → `0038_field_disposition_flags`; Task 8
  re-bumps → `0039_absent_reason_backfill`. Arch-doc head line → `0039` (Task 10).
- Tables: `extraction_proposal_records.proposed_value`,
  `extraction_reviewer_decisions.value`, `extraction_published_states.value`; all
  have `run_id` (→ runs.version_id → versions.schema_). `accept_proposal`
  decisions carry `value=NULL` and inherit from the migrated proposal (no
  double-handle — confirmed).

**R-TEST (coverage — these are ADDITIONS, tests below already shipped in P0/P1 —
do NOT re-add, but VERIFY they still pass after the migration mutates data):**
- Already shipped: `backend/tests/integration/test_absent_reason_gate.py`
  (required→no_information finalizes / bare-null blocks / unaccepted marker),
  `test_suggestion_read.py` dedup recency, `autosaveDirty.test.ts` R7 marker.
- **GAP1 (Task 4, integration):** two reviewers `record_decision` same coord —
  both `no_information` → `_agreed_unpublished_values` yields a publish candidate;
  one `no_information` + one `not_applicable` → coord stays `unresolved`. Proves
  the marker persists verbatim into `ExtractionReviewerDecision.value` (the
  agreement-key precondition, `run_lifecycle_service.py:321`).
- **GAP2 (Task 8):** roundtrip THROUGH 0039 both directions with data at each end
  (seed marker rows at head → `downgrade 0039→0038` asserts domain-correct strings
  → `upgrade` re-asserts markers); seed a coincidental free-text `"NA"` (assert
  untouched — false branch of the predicate) and an `accept_proposal` decision.
  If diff-cover still misses a branch, use the mocked-import unit test with
  `--rcfile=/dev/null`.
- **GAP3 (Task 4):** extend the `disposition_to_marker` unit table —
  `{"value":"No information","unit":null}` (peel + drop unit),
  `{"value":"Not evaluated"}`, `{"value":"Not applicable"}`,
  `{"value":["No information"]}` (multiselect array → **left untouched**;
  dispositions are scalar-select only per the seed — documented, tested).
- **GAP4 (Task 9 — bigger than "narrow the predicate"):** the call sites
  (`AISuggestionDisplay.tsx:112`, `AISuggestionReviewPopover.tsx:91`) pass the
  **unwrapped scalar** `suggestion.value`, so narrowing `isAbstention` to pure
  marker makes every abstention read `false` (dead strip + re-inflated count).
  Task 9 must FIRST carry `absent_reason` onto the `AISuggestion` model
  (`aiSuggestionService` builds it from the full `proposed_value`) and make the
  call sites read the code (per spec "carry `absent_reason` end-to-end"), THEN
  narrow, THEN fix the call-site behavioural tests.

**Follow-up chips (out of scope here):** add `ensure_project_reviewer` to
`create_decision`/`create_proposal` (both membership-only today — pre-existing);
Phase-4 owns consensus manual-override normalization + FE divergence rendering +
distinct abstention rendering + bulk-accept safeguard + export.

## Risks & mitigations

- **Migration mutates finalized history** → snapshot-scoped, reserved-vocabulary
  mapping; `--sql` reviewed both directions; roundtrip test.
- **Seed drop removes the only way to set no-info** → mitigated by Task 5 runtime
  control (owner decision).
- **`isAbstention` narrowing changes counts/strips** → call-site tests updated in
  the same task (Task 9).
- **Choke-point false-positive** on a user template using `NA`/`NI` substantively
  → O1; reserved vocabulary is the accepted trade (no seeded field does this).
