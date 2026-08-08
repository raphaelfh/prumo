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

## Panel decisions (2026-08-08, 3 lenses — apply verbatim)

**Security (1 BLOCKING folded):**
1. 🔴 **0049 MUST add `template_id IS NULL` to the entity-types INSERT
   WITH CHECK and UPDATE USING+WITH CHECK** — the global-lineage
   injection hole: any self-made manager can insert a section with
   `template_id = <global id>` that every tenant's future clone
   imports (incl. attacker llm_description = cross-tenant prompt
   injection). Fields are already safe (their chain joins
   project_template_id). Add a hybrid-row audit
   (`template_id IS NOT NULL AND project_template_id IS NOT NULL`) to
   the 0050 prod probe.
2. Manager-JWT PostgREST writes SURVIVE B-7 (GRANT ALL to
   authenticated stays) and bypass endpoint validation — backstopped by
   the 0050 index + ck constraints, NOT for cross-template moves/
   lineage (closed by 0049's predicates). Name the residual in the PR
   + record the follow-up: a post-settle migration
   `REVOKE INSERT, UPDATE ON the two tables FROM authenticated`.
3. Rationale fix: USING-without-WITH-CHECK already gates NEW rows —
   cross-template moves pass because membership predicates can't
   express "same template as OLD" (not because of a missing check).
   FOR INSERT takes only WITH CHECK. Pin the exact policy SQL.
4. Move/reorder service: rowcount/match-count assertions → typed 404;
   ONE joined query verifying ALL reorder ids belong to sections of
   THIS template (**multi-section batches are LEGAL** — a cross-section
   move emits one batch spanning two sections); reject duplicate ids;
   move included in the 23503 remap scope. No advisory locks; optional
   hardening = template-row FOR UPDATE FIRST (clone precedent, no
   ABBA). The 0048 trigger already serializes edits vs Publish.
5. Task 3 carries the explicit BOLA line: entity_type_id → template_id
   → project_id re-verified in the service.

**Migration:**
6. Heal: **NO DISABLE TRIGGER** — the stamp on healed templates is
   semantically CORRECT (their live config now differs from the
   snapshot; the 0048 warning targets every-row backfills, not
   duplicate-only heals). Never blanket-clear markers (would re-arm the
   clone silent drift-heal). Deterministic: `row_number() OVER
   (PARTITION BY entity_type_id, name ORDER BY created_at, id)`, rename
   rn>1; collision-proof: first FREE suffix per name (a pre-existing
   foo_2 must not abort the single-transaction deploy); IDEMPOTENT
   (HAVING count(*)>1 selector; re-upgrade after downgrade is a no-op —
   asserted in the roundtrip test).
7. Index: named **`uq_extraction_fields_entity_type_name`**, created as
   `sa.Index(..., unique=True)` in __table_args__ with the EXACT same
   name as the migration's CREATE UNIQUE INDEX (UniqueConstraint would
   emit spurious autogenerate diffs forever); tuple ends with
   `{"schema": "public"}`. 0050 downgrade = DROP INDEX only (heal is
   permanent data repair — stated); healed names may exceed the new
   50-char cap (harmless, docstring note); heal covers GLOBAL lineage
   too — seed + clone verification repeats under task 7; seed
   interplay noted in the docstring.
8. 0049 downgrade restores the four ASYMMETRIC originals VERBATIM from
   baseline (entity-types INSERT has a project_template_id IS NOT NULL
   guard; UPDATEs were USING-only); roundtrip asserts
   `with_check IS NULL` on downgraded UPDATE policies via pg_policies
   (substring matching — is_project_manager/member — never string
   equality). Revision ids: **0049_config_write_rls_manager** (29),
   **0050_field_name_unique_heal** (27).
9. Behavioral RLS probe test (0041's test_reviewer_ready_rls pattern +
   the CI auth-stub GUC memory): member INSERT/UPDATE refused, manager
   allowed, WITH CHECK enforced, global-lineage INSERT refused — both
   tables.

**Correctness:**
10. Field create/move/reorder ACCEPT client-supplied sort_order
    (validated ≥0) — it is a per-section RENDERING convention; a
    server-computed value would break the ghost-chain optimistic-row
    reconciliation (dequeue-time computation, pinned tests). Only
    createSection computes server-side (kills its read-then-write
    race).
11. The rewritten frontend services TRANSLATE ApiError → PgError
    (23503/'FIELD_IN_USE' → the friendly copy) — useDeleteTemplateField
    branches on `instanceof PgError && code==='23503'` and its test
    mocks the SERVICE, so no suite catches losing the remap. New
    service tests mock apiClient (not supabase) and assert the
    translation.
12. Service arities GROW project/template ids (the endpoints are
    path-scoped) — hook/dispatcher CONTRACTS stay but ~5 hook test
    files' exact-arg assertions update (useDeleteTemplateField:71,
    useMoveTemplateField:75, useReorderTemplateFields:76,
    useInsertTemplateField:181/241/372) + the editor/dialogs pass ids
    they already hold (RemoveSectionDialog/_projectId etc.);
    SessionDeps gains templateId.
13. Zod↔Pydantic drift guard: one cheap vitest reading the committed
    openapi.json and asserting pattern/min/max/enum for the
    create-field schema against the Zod rules.
14. The impact probes (validateFieldImpact, analyzeSectionRemovalImpact)
    STAY PostgREST reads — amend their "parked at B-7" comments to
    point at the fitness/consolidation follow-up; listed in Non-goals.
15. Split the new backend modules so tasks 2∥3 truly parallelize:
    **template_field_service.py + template_section_service.py** (and
    section request schemas assigned to task 3); shared helpers in the
    schemas module or a tiny _common.
16. Delete the dead pt-BR `.default('Outro (especificar)')` (Default
    wrapped in Optional never fires; runtime fallback is already the
    English copy key) — mirror other_label as plain optional ≤100.
17. New refusal copy keys (duplicate name, section-delete RESTRICT)
    owned in task 5; RemoveSectionDialog gains the friendly remap.
18. `fail()`'s refetch in useMoveFieldTo SURVIVES (a cross-section move
    stays two HTTP calls) — REWRITE its justification comment, don't
    delete the behavior.
19. Browser pass: assert the served checkout via lsof (the port-8080
    trap) before trusting results.

## Tasks

1. **Schemas** — app/schemas/template_structure.py mirroring the Zod
   rules (+ fix the pt-BR other_label default on BOTH sides); unit
   tests per constraint.
2. **Field service** — template_field_service.py (panel 15):
   create/update/delete/move/reorder, project-scoped BOLA lookups,
   same-template move refusal (typed), per-section name uniqueness
   (create/update/move), atomic transactional renumber — ids verified
   via ONE joined query to sections of THIS template (multi-section
   batches LEGAL, duplicate ids rejected, match-count == len(ids) →
   else typed 404; panel 4), client sort_order accepted (panel 10),
   23503/23505 remaps incl. move; integration tests incl.
   cross-template refusal. No advisory locks (panel 4). Must not
   disturb republish's lock order (B-4 decisions 1-3).
3. **Section service** (∥ with 2) — template_section_service.py +
   its request schemas (panel 15): create with role +
   parent_entity_type_id (ck rules + one-container 23505), server-side
   sort_order, rename (length/non-empty), delete (RESTRICT remap);
   explicit BOLA chain entity_type→template→project re-verified in the
   service (panel 5); integration tests. First path that can create
   model_section — verify against the deferred trigger.
4. **Endpoints** — wire into project_templates.py; direct-coroutine
   unit tests per endpoint + error mapping; generate + commit api
   types.
5. **Frontend migration** — the two services onto apiClient with
   GROWN arities (ids threaded from call sites that already hold them;
   panel 12); ApiError→PgError translation + apiClient-mocking tests
   (panel 11); dead pt-BR default deleted (panel 16); new refusal copy
   keys + RemoveSectionDialog friendly remap (panel 17); impact-probe
   comments re-pointed (panel 14); useMoveFieldTo fail() comment
   rewritten not deleted (panel 18); Zod↔Pydantic drift-guard vitest
   (panel 13); full B-5/B-6 suites green.
6. **Migration 0049_config_write_rls_manager** — 4 policies →
   is_project_manager + WITH CHECK on UPDATEs **+ the BLOCKING
   `template_id IS NULL` predicate on entity-types INSERT/UPDATE
   (panel 1)**; exact SQL pinned, verbatim asymmetric downgrade,
   pg_policies substring assertions incl. with_check IS NULL after
   downgrade (panel 8); behavioral RLS probe test (panel 9); roundtrip
   + head-pin + arch-doc; verify clone/seed/E2E paths.
7. **Migration 0050_field_name_unique_heal (LAST)** — duplicate
   audit query documented (BOTH lineages + the hybrid-row audit, panel
   1/7), deterministic collision-proof idempotent suffix heal WITH THE
   TRIGGER ENABLED (stamps on healed templates are correct — panel 6),
   CREATE UNIQUE INDEX uq_extraction_fields_entity_type_name +
   matching named sa.Index(unique=True) __table_args__ ending with the
   schema dict (panel 7); downgrade = DROP INDEX only (stated); seed +
   clone verification re-run here; roundtrip + head-pin bump; prod
   probe instruction in the PR body.

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
