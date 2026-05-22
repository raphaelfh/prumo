# Extraction & HITL Test Strategy

> Last updated: 2026-05-18. Audience: anyone touching `extraction_*`,
> `extraction_runs`, the workflow tables, or the Configuration /
> Extraction surfaces in the frontend. This document is the index for
> the tests that lock in the invariants — read it before changing any
> contract listed below.

## 1. Why these tests exist

After the 2026-05-17 bug hunt the team uncovered **seven** classes of
silent failure in the extraction stack: split active-template selection
between Configuration and Extraction; a function (`calculate_model_progress`)
that referenced a table dropped two migrations ago; parent
`prediction_models` fields that never rendered; legacy hooks duplicating
the modern service path; and a missing DB-level enforcement that left
the single-active-extraction invariant trusting service-layer discipline
alone. Each of these had the same root cause: an invariant existed in
exactly one layer, so a tiny refactor anywhere else could break it
unnoticed.

The strategy from this point on is **spec-driven, defence-in-depth**.
Every contract that crosses two layers (DB ↔ service ↔ API ↔ frontend)
needs at least one test that pins the contract from a layer the
implementer can't touch by accident. That is the rule the test files
below follow.

## 2. Test pyramid layout

```
                       ┌────────────────────────┐
                       │  Playwright (manual /  │   smoke confidence
                       │  golden flow CHARMS)   │   on the wire
                       └────────────────────────┘
                  ┌────────────────────────────────────┐
                  │  Backend integration (488 / 31 skip)│   the bulk —
                  │  pytest + asyncpg + real Postgres   │   real schema,
                  │  via supabase_db_supabase_local     │   real RLS
                  └────────────────────────────────────┘
            ┌────────────────────────────────────────────────┐
            │  Frontend integration (343)                    │
            │  vitest + jsdom + MSW + supabase mock          │
            │  hooks / components / services in isolation    │
            └────────────────────────────────────────────────┘
                  ┌────────────────────────────────────┐
                  │  Backend unit (subset of 488)      │
                  │  service-only / pure-function      │
                  └────────────────────────────────────┘
```

## 3. The "load-bearing" tests

Each entry: file → invariant it pins → what breaks if it's removed.

### 3.1 Single-active-extraction-template invariant

* **`tests/integration/test_single_active_extraction_invariant.py`**
  Pins the partial unique index `uq_one_active_extraction_template_per_project`.
  - `test_index_exists_in_catalog`, `test_index_is_partial_with_extraction_predicate`,
    `test_index_is_immediate_not_deferrable` — catalog-level facts a
    future migration could silently drift.
  - `test_inserting_second_active_extraction_template_fails`,
    `test_promoting_second_template_to_active_fails` — INSERT and UPDATE
    paths both blocked.
  - `test_two_active_qa_templates_are_allowed`,
    `test_kind_specific_index_allows_qa_alongside_extraction` — QA stays
    outside the scope (PROBAST + QUADAS-2 coexist).
  - `test_deactivate_then_activate_a_different_one_works`,
    `test_project_with_zero_extraction_templates_is_valid` — the natural
    "switch" and "fresh project" flows aren't broken.
  - `test_cross_project_active_extraction_templates_are_independent`
    (skipped when only one project) — the index partitions by project.

  **Why it matters:** BUG #1 (Configuration showed CHARMS, Extraction
  used E2E) only happens when two extraction templates are active. The
  DB-level guard means a future caller that bypasses
  `TemplateCloneService.clone` (e.g. an ad-hoc Supabase insert) still
  can't recreate the bug.

### 3.2 Session backfill — child singletons

* **`tests/integration/test_session_backfill_extensive.py`** +
  the two regression cases in `tests/integration/test_hitl_session.py`
  (`test_session_backfills_singleton_children_added_after_model_creation`,
  `test_session_backfill_is_idempotent`).
  - One instance per (parent_instance, child_entity_type) — the
    invariant the form's `getInstancesForModel` lookup depends on.
  - Backfill only fires for cardinality='one' children; many-cardinality
    children stay user-driven.
  - Metadata stamp `created_via='hitl_session_backfill'` so the auditor
    can tell what the runtime healed vs what the user / AI created.
  - Idempotent under repeated session opens.
  - QA templates have no many-parents → backfill is a no-op (verified
    explicitly).

  **Why it matters:** Without the backfill, adding a new sub-section
  under `prediction_models` after a model was created leaves the form
  with orphan UI — fields render but have no instance to bind to.

### 3.3 `calculate_model_progress` contract

* **`tests/integration/test_calculate_model_progress.py`**
  - Argument names (`p_article_id`, `p_model_id`) — the frontend's call
    site uses them verbatim; drift here surfaces as PGRST202 in the UI.
  - Return columns (`completed_fields`, `total_fields`, `percentage`).
  - Reject decisions don't count.
  - Published states with values count; jsonb-null literals don't.
  - Unknown model_id returns 0/0 (not NULL) so the frontend fallback
    isn't load-bearing.

* **`tests/integration/test_schema_drift.py::test_calculate_model_progress_signature_locked`**
  and `test_calculate_model_progress_is_security_definer` — second
  axis of the contract, derived from `pg_proc` so it catches drift
  even without running the function body.

  **Why it matters:** BUG #2 was that this function silently called a
  table dropped in migration 0002 and had an argument-name mismatch with
  the frontend. Two test angles (behaviour + catalog) lock both.

### 3.4 Schema drift catch-all

* **`tests/integration/test_schema_drift.py`** — 13 catalog assertions:
  template_kind / extraction_run_stage / extraction_reviewer_decision
  enum values; composite FKs that prevent cross-run leaks (migrations
  0005 and 0012); confirmation that `extracted_values` and `ai_suggestions`
  stay dropped; `is_project_reviewer` helper present (migration 0018).

  **Why it matters:** Each assertion costs ~5 lines and prevents a class
  of "looks fine in dev, fails in prod" bug. If a migration drops one of
  these tomorrow, the drift test fails fast and the author knows the
  contract they need to update on the consuming side.

### 3.5 Template clone — coverage of every branch

* **`tests/integration/test_template_clone_extraction.py`** now covers
  the full state machine of the clone service:
  - Empty project: create new (counts match global).
  - Existing clone, active: idempotent return.
  - Existing clone, inactive: re-activate + deactivate siblings.
  - Existing clone, empty structure: heal by re-reading global.
  - Cross-kind: 404, not silent.
  - Unknown global id: 404.
  - QA siblings are never touched on extraction clones.
  - Composite (id, kind) FK still rejects cross-kind run pointers.
  - Hierarchy preserved through the entity_type id remap.
  - Cloned entity_types carry `project_template_id` only (no leak back
    to the global catalogue).

### 3.6 Frontend — picker symmetry and BUG #7 regression

* **`frontend/test/hooks/useExtractionData.test.tsx`** — pins:
  - DESC ordering on `created_at` (matches `ExtractionInterface`'s
    Configuration picker — closes BUG #1 split).
  - Filters by `project_id` + `kind='extraction'` + `is_active=true`.
  - Graceful nulls when projectId / articleId are undefined.
  - `mergeInstancesById` reference stability (refresh without label
    change reuses the same array, change yields a new one).

* **`frontend/test/ExtractionFormView.test.tsx`** — pins BUG #7:
  - The parent prediction_models accordion only renders when there's an
    active model AND the parent has fields.
  - It binds to the active model instance (not to any other model row).
  - It receives the parent's own fields (`model_name`,
    `modelling_method`, plus any custom).
  - Children pass `parentInstanceId` correctly so values land under the
    right model.
  - The fully-loaded CHARMS shape renders study-level → parent →
    children in that order.

* **`frontend/test/extractionValueService.test.ts`** — pins
  `findActiveRun` and `findLatestFinalizedRun`:
  - `kind='extraction'` filter is non-optional (no QA-run leak).
  - DESC ordering on `created_at`.
  - Stage filter respects the non-terminal list.
  - APIError thrown on supabase failure (not silent).

* **`frontend/test/hooks/useModelManagement.test.tsx`** — edges around
  `createModel`:
  - Missing `modelParentEntityTypeId` → return null, no service call.
  - Trims model name.
  - Persists `modelling_method` only when active run exists and the
    template carries the field.
  - Swallows ReviewerDecision write errors so they don't abort model
    creation (degrades to "set via the form").
  - `removeModel` rethrows so the dialog can show failures.

## 4. House conventions for new tests

When you add a new test, follow the rules these files agreed on:

1. **One observable per test.** The test name describes the spec and the
   assert spells out the contract. A failure points at the broken
   contract, not at a downstream symptom.
2. **Real DB for integration.** Backend tests run against the live
   Postgres in `supabase_db_supabase_local`. RLS, triggers, partial
   indexes, FK semantics — the test only sees the production rules
   if it uses them.
3. **Skip, don't fake, when the fixture isn't present.** Tests that
   need a seeded global template / project / article call `pytest.skip`
   if the fixture is missing. Beats silently mocking a different
   contract.
4. **`vi.resetAllMocks()` in `beforeEach` for mocked hooks.** Vitest's
   `clearAllMocks` keeps `mockReturnValueOnce` queues alive across
   tests — that bled chains between tests during this hunt.
5. **Document the why above the spec.** Especially when the test pins
   a contract that's not obvious from the code itself (jsonb null vs
   SQL null, composite FK across run boundaries, etc.).
6. **`spec → iterations`.** When you'd write a "for each scenario" test,
   break it out so each case has its own name in the report and a
   targeted failure when it regresses.

## 5. Running the suite

| Command | What it runs |
|---|---|
| `make test-backend` | full pytest suite (488 passed / 31 skipped) |
| `npm test -- --run` | full vitest suite (343 passed) |
| `make lint-backend` | ruff check + format |
| `npm run lint` | eslint |
| `npx tsc -p tsconfig.json --noEmit` | TypeScript strict mode |
| `cd backend && .venv/bin/alembic upgrade head` | migrations applied |

Run all four before opening a PR for anything in `backend/app/services/`,
`backend/alembic/versions/`, `frontend/hooks/extraction/`, or
`frontend/components/extraction/`.

## 6. Coverage gaps (deliberate)

These remain manual / Playwright-only by choice:

* **Full multi-reviewer consensus pipeline.** Covered by Playwright +
  manual review during release; the integration cost of seeding 3
  reviewers + their decisions outweighs the regression risk.
* **AI extraction end-to-end.** Hits real OpenAI; we have unit tests
  for the service surface and a Playwright happy-path. Heavy
  integration tests live behind an opt-in env flag.
* **Visual regression of the extraction form.** Tracked in the
  Playwright axe / snapshot suite, not here.

When you find yourself reaching for one of these, ask first whether the
test could live as a service-level integration test instead. That's
almost always cheaper to keep green.
