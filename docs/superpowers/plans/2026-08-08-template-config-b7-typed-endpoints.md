---
status: draft
last_reviewed: 2026-08-08
owner: '@raphaelfh'
---

# Template config B-7 — typed write endpoints + RLS tightening

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development task-by-task. Built from a
> full structural map (Explore agent, 2026-08-08; anchors reference the
> tree at `5e8ceb7a` = dev + B-6). **This slice discharges the recorded
> prod-promotion gate for the B-4 Publish button** (the gate's "or" is
> satisfied twice: typed endpoints AND the RLS tightening).

**Goal:** Every config-editor write moves off direct PostgREST onto
manager-gated, BOLA-checked, server-validated typed endpoints; the
member-writable RLS hole closes (INSERT/UPDATE → `is_project_manager`
with WITH CHECK); the `(entity_type_id, name)` unique index lands with
a defensive data-heal.

## Load-bearing map facts

- **Write inventory is EXACTLY two frontend files** (verified grep):
  `extractionFieldService.ts` (insertField :141, updateField :159,
  deleteField :185, reorderFields :223 — N independent UPDATEs,
  non-atomic, moveField :259 — the cross-template hole) and
  `templateService.ts` (updateEntityTypeLabel :128, createSection :347
  — hard-codes role/study_section + read-then-write sort_order race,
  deleteSection :205 — raw RESTRICT error, no friendly remap).
  `createCustomTemplate` (:237) is a THIRD table — deferred, out of
  scope. Reads stay live-row (the editor must show drafts).
- **Fitness gate blind spot**: `check_frontend_data_path.py:43` is
  line-anchored; every write above is multi-line `await supabase\n
  .from(` — NONE is counted today, baselines contain zero entries for
  these files. Fixing the regex is a SCOPE GRENADE (baseline explodes
  with ~50 honest entries across unrelated services) — split to its own
  follow-up task/PR; B-7 just deletes the calls.
- **Draft-marker stamping is FREE for endpoints** (0048 AFTER-row
  triggers fire on any writer). **Consciously DEFER B-4 decision 9's
  "port/retire the trigger"**: the trigger's COALESCE-no-predicate
  row-lock is what serializes edits behind `republish`'s FOR UPDATE
  (B-4 decision 1) and it is the seed/E2E/clone chokepoint — retiring
  it would force endpoints to reproduce the lock ordering. Record the
  deferral + rationale in the code and this plan.
- **RLS current state** (baseline_v1.sql): DELETE already manager
  (:2464, :2504); INSERT/UPDATE member (:2470-2480, :2511-2523) with
  UPDATE **USING-only, no WITH CHECK** (why cross-template moves pass);
  SELECT `USING (true)` — globally open, stays as-is (separate blast
  radius; flag in the PR, don't bundle). WITH CHECK still cannot
  express "same template as BEFORE" — the ENDPOINT is the enforcement;
  the tightening closes the member-writable hole only.
- **UI is already manager-only** (sectionViews.ts:14 managerOnly +
  SectionViewSwitcher filter + the permission probe) — tightening
  breaks NO member flow; managers satisfy both old and new policies, so
  ordering is about deleting the PostgREST path BEFORE narrowing it:
  **backend endpoints → frontend migration → RLS tighten → unique index
  last**.
- **Service-role paths unaffected**: clone service + seed run over
  DATABASE_URL (RLS-bypassing); E2E fixtures use the service key.
  No other frontend writer exists (verified).
- **Unique index**: confirmed absent everywhere; duplicates are
  CREATABLE today (stale queue takenNames; update-behind-insert key
  renames skip validateKeyCommit). Prod duplicate state is UNKNOWN —
  the migration heals defensively (`_2/_3` suffix) BEFORE the index,
  with `ALTER TABLE … DISABLE TRIGGER trg_extraction_fields_mark_draft`
  around the heal DML (0048's own warning: a backfill stamps EVERY
  template) or a marker clear afterward. Plain unique index (no
  CONCURRENTLY — Alembic runs transactional; tables are tiny). Add
  `__table_args__` to ExtractionField so autogenerate doesn't DROP it
  (the #93 lesson).
- **Pydantic must mirror ExtractionFieldSchema**
  (types/extraction.ts:326-405): name `/^[a-z][a-z0-9_]*$/` 2..50,
  label 1..100, description ≤500, field_type enum, unit ≤50,
  allowed_units 1..20 unique, llm_description ≤1000, allowed_values
  1..100 unique, allow_other + other_label ≤100 (NOTE: the Zod default
  'Outro (especificar)' is pt-BR in an English-only codebase — fix the
  copy bug on both sides in this slice), other_placeholder ≤200,
  dispositions bools, sort_order ≥0.
- **Section rules the endpoint finally enforces**: role required (no
  server_default — deliberate), ck_role_parent (study_section/
  model_container ⇒ no parent; model_section ⇒ parent required),
  one-model_container-per-template 23505 → typed error,
  delete-with-instances RESTRICT 23503 → friendly copy (mirror
  deleteField's PgError remap). createSection accepts role +
  parent_entity_type_id AS PARAMETERS (kills the hard-code — the spec
  §1.2 item), computes sort_order server-side (kills the race).
- **Endpoint pattern**: project_templates.py family
  (require_project_manager, ApiResponse envelope, typed errors, db
  flush-in-service commit-in-endpoint, nested-id BOLA re-verified in
  the service). Direct-coroutine unit tests per endpoint (the ASGI
  diff-cover blind spot; pattern test_template_instruction_endpoint.py).
  New modules: app/schemas/template_structure.py +
  app/services/template_structure_service.py (project_templates.py has
  room at 294 lines; hitl_session.py should not grow).
- **Frontend migration**: only service INTERNALS change (apiClient +
  generated types via templateStructureService.ts's exemplar); every
  hook/queue/dispatcher/undo signature stays; reorder becomes ONE
  atomic call — delete the obsolete resolves-with-error loop + the
  partial-failure refetch rationale (stale comments = drift).
  api-types regen + commit (CI api-contract).
- **Migrations**: 0049 RLS (DROP POLICY IF EXISTS + CREATE, both
  directions — 0041 precedent), 0050 heal+index, SEPARATE so 0050 can
  be held if the prod probe finds surprises. Roundtrip: explicit-parent
  downgrades, head-pin bump (test_migration_roundtrip.py:645-655), new
  per-migration tests (0048 precedent :598-630), arch-doc head line +
  table-delta rows + last_reviewed.
- **Prod probe (HUMAN step, record in the PR)**: run the duplicate
  audit SELECT against prod read-only before promoting; the heal is
  defensive either way. After B-7, the ONLY recorded non-code item
  before dev→main of the whole train is the **Phase-A prod seed run**
  (`python -m app.seed` against prod); accepted residuals: deploy-window
  chip transient, E2E gap, SELECT USING(true).

## Tasks

1. **Schemas** — app/schemas/template_structure.py mirroring the Zod
   rules (+ fix the pt-BR other_label default on BOTH sides); unit
   tests per constraint.
2. **Field service** — template_structure_service.py: create/update/
   delete/move/reorder, project-scoped BOLA lookups, same-template move
   refusal (typed), per-section name uniqueness (create/update/move),
   atomic transactional renumber (ids must share one section/template),
   23503/23505 remaps; integration tests incl. cross-template refusal.
   Must not disturb republish's lock order (B-4 decisions 1-3).
3. **Section service** (∥ with 2) — create with role +
   parent_entity_type_id (validated against ck rules + one-container
   23505), rename (length/non-empty), delete (RESTRICT remap);
   integration tests. First path that can create model_section —
   verify against the deferred trigger.
4. **Endpoints** — wire into project_templates.py; direct-coroutine
   unit tests per endpoint + error mapping; generate + commit api
   types.
5. **Frontend migration** — the two services onto apiClient; hooks
   untouched; obsolete comments deleted; full B-5/B-6 suites green.
6. **Migration 0049 (RLS)** — 4 policies → is_project_manager + WITH
   CHECK on UPDATEs; roundtrip + head-pin + arch-doc; verify clone/
   seed/E2E paths in the suite.
7. **Migration 0050 (heal + unique index, LAST)** — duplicate audit
   query documented, defensive suffix heal with trigger disabled,
   CREATE UNIQUE INDEX, ExtractionField __table_args__; roundtrip +
   head-pin bump again; prod-probe instruction in the PR body.

### Verify (slice gate)

Per task: suites + tsc + lint (+ pytest for backend). Slice:
`make quality-scan` + `make test-backend`; browser pass on the seeded
CHARMS: full CRUD + move/reorder + Enter-chain + rename + delete via
the NEW endpoints (network tab shows /api/v1, zero PostgREST writes),
chip/publish cycle still works, error paths (duplicate key refusal,
cross-template move refusal via direct API call).

## Non-goals

createCustomTemplate migration (third table); SELECT USING(true)
tightening; the fitness-regex multi-line fix + honest baseline (own
follow-up PR); trigger port/retire (consciously deferred, rationale
above); E2E harness (B-9 candidate).
