---
status: draft
last_reviewed: 2026-10-30
owner: '@raphaelfh'
---

# Screening workspace S1 — title/abstract workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-record queue with a list + docked panel of every title/abstract record and its status (triage by keyboard, conflicts ruled in the panel, a Settings sub-view, solo re-decide), backed by one blind-safe `GET /screening/records` read that replaces `/screening/queue` and `/screening/conflicts`.

**Architecture:** Backend adds one read (`ScreeningReviewService.records`, statuses derived through `assignment_states` + `caller_status` + the seat rule) and a solo re-decide branch in `decide`; the queue/conflicts endpoints and everything only they reach are deleted last, once no frontend code calls them. Frontend renders `?tab=screening&screeningTab=title_abstract|settings` on S0's `ListDetailSplitShell`: a list built from `components/shared/list/*` (status views, search/filter/sort, progress strip, bulk Enroll/Export) and a panel that picks its body from the row status and `GET /screening/assignments/{id}`; selection lives in `?article=`.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Pydantic v2, pytest on real Postgres; React 19 (React Compiler) + TanStack Query + react-router, Vitest + MSW + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-screening-workspace-design.md` — slice S1 only: §4 (S1 sub-views, redirect, first run, `?assignment=` removal, toolbar), §4.1 (controlled `maximized`, Esc chain integration), §4.2–§4.6, §5, §6.2 (TA part), §6.3 (TA only), §6.4 rows tagged S1, §9 task rows S1a–S1d, "Deleted or moved code (S1)", S1 gates, E2E and `seed_screening` (S1 contents), S1 acceptance rows. S0 shell API: `docs/superpowers/plans/2026-10-30-screening-workspace-s0.md`.

**Scope:** 12 tasks, one PR to `dev`, title `feat(screening): title/abstract workspace — list, panel, settings`. No migration: S1 changes no model (reads, a service branch and a local seed script only; confirmed against `backend/app/models/screening.py`); `alembic check` is not an S1 gate.

## Task graph

| Task | Spec row | Depends on | Runs in parallel with |
| --- | --- | --- | --- |
| 1 Records read + config reasons (backend) | S1a | S0 merged | 5 |
| 2 Solo re-decide + local seed (backend) | S1a | 1 | 3, 4, 6–10 |
| 3 Data layer: key, service, hooks, invalidation (frontend) | S1b | 1, 5 | 2, 4 |
| 4 Records vocabulary, pure functions (frontend) | S1b | 1 | 2, 3, 5 |
| 5 Keyboard + shell primitives (frontend) | S1d | S0 merged | 1, 2, 4 |
| 6 Record list (frontend) | S1b | 3, 4 | 2 |
| 7 Record panel (frontend) | S1c | 3, 5, 6 | 2 |
| 8 Title/abstract workspace (frontend) | S1b | 5, 6, 7 | 2 |
| 9 Tab, switcher, Settings, deletions (frontend) | S1b, S1d | 8 | 2 |
| 10 Keyboard integration, E2E, 5,000-row check (frontend) | S1d | 9 | 11 |
| 11 Retire queue/conflicts (backend + gate) | S1a | 2, 9 | 10 |
| 12 Slice verification + design review | all | 1–11 | — |

Parallel groups, in order: **G1** {1, 5} → **G2** {2, 3, 4} (3 waits for 5 too) → **G3** {6} → **G4** {7} → **G5** {8} → **G6** {9} → **G7** {10, 11} → **G8** {12}. Task 2 runs from G2 to the end of G6 beside the frontend chain. Tasks 6–9 are sequential because each edits `frontend/lib/copy/screening.ts`. Two tasks that run at the same time never share a file (each task lists its files); `frontend/types/api/*` is written only by Tasks 1, 2 and 11, which are sequential; `scripts/fitness/check_layered_arch.py` and `backend/tests/integration/test_screening_concurrency.py` only by Task 2; `scripts/fitness/check_retired_symbols.py` only by Task 11.

## Global Constraints

- **Worktree.** `WT=/Users/raphaelfedericcihaddad/PycharmProjects/prumo/.claude/worktrees/screening-workspace-s1` (branch `screening-workspace-s1`). Every command uses absolute paths or `git -C "$WT"`; never touch the main checkout, never `git switch`/`checkout`, never bare `git stash`. After each task, `git -C "$WT" status --short` shows only that task's files.
- **Precondition (S0).** `test -f "$WT/frontend/components/layout/ListDetailSplitShell.tsx"` and `git -C "$WT" merge-base --is-ancestor d77102d5 HEAD` (S0's commits `1c564ea0`, `d77102d5`). If either fails, stop: the branch must be updated from `dev` (or `screening-workspace`) first.
- **English only** — code, comments, commits, copy keys and copy.
- **No model change ⇒ no migration in S1.** If a task finds it needs a model change, stop and report (spec says none).
- **Ownership (BOLA).** Every client id is bound by its one guard; the scope predicate sits in the WHERE clause (`.claude/rules/backend.md` § Ownership guards). The records read takes `project_id` from `require_project_scope` and filters `Article.project_id == project_id`; assignment-to-article joins use `ARTICLE_STILL_IN_PROJECT` (`screening_repository.py:35-38`). No raw `public.project_members` SQL in `backend/app` (the gate's membership-sql detector), so the seed writes members through the ORM. Gate: `check_scope_guards.py`.
- **Envelope.** Endpoints return `ApiResponse.success(model, trace_id=getattr(request.state, "trace_id", None))` with a typed model; errors are `HTTPException` / `ScreeningStateError` (409). Gate: `check_api_response_envelope.py`.
- **Generated types.** After any edit to a public schema class or a route's `responses` (docstrings and descriptions included) run `npm run generate:api-types` from `$WT` and commit `frontend/types/api/openapi.json` + `schema.d.ts`. Never hand-edit them. Only Tasks 1, 2 and 11 regenerate.
- **Frontend data path.** component → hook → `services/screeningService.ts` → `apiClient`; services return `ErrorResult<T>`; keys only from `lib/query-keys/screening.ts` (`check_react_query_keys.py`); no `fetch`, no `supabase.from` (`check_frontend_data_path.py`). Copy through `t('screening', key)`; a `{{x}}` placeholder is filled with `.replace('{{x}}', …)` (house style).
- **React Compiler** (`panicThreshold: 'all_errors'`): no ref read/write during render (only in effects/handlers), no `try/finally` and no `throw` inside `try` in a component or hook body; reset state on a prop change with the "previous value in state, adjust during render" pattern; `useWatch`, never `form.watch()`.
- **Keyboard.** New bindings go through `useKeyboardShortcuts` (input + dialog guards). The only capture-phase listener is the S0 shell's Escape. Never add bare keys to `useListKeyboardShortcuts`. The decision keys keep `DecisionButtons`' own window listener (existing).
- **Post-edit hook** runs `ruff check --fix` / `eslint --fix` after every Edit/Write and strips unused imports: add an import in the same edit as its first use.
- **No dead code** (CI-gated): a file is deleted in the task that removes its last consumer; `npm run deadcode` and `npm run deadcode:production` at zero (from Task 9 on; earlier tasks may leave a not-yet-wired new file, noted in the task); copy keys live (`check_copy_keys.py`); vulture (`cd backend && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`) green — the baseline holds none of the deleted symbols, so nothing to tighten; `check_retired_symbols.py` gains the S1 word symbols in Task 11.
- **File size.** `check_file_size.py` exits 0 (800-line soft ceiling for new files; `ArticlesList.tsx` 1,312/1,335 baseline — at most +23 lines; `ArticleForm.tsx` 808/1,213).
- **Commands (verified against `package.json`, `Makefile`, `scripts/fitness/run_all.sh`).**
  - Frontend, from `$WT` (never `cd frontend`): `npm run test:run -- <paths>`, `npm run typecheck`, `npm run lint`, `npx eslint <files>`, `npm run deadcode`, `npm run deadcode:production`, `npm run generate:api-types`. No `npx` on PATH → `~/.local/bin/mise exec node@24 -- <cmd>`. No `node_modules` in `$WT` → `npm ci` (never symlink the main checkout's).
  - Backend: `make test-backend` (= `cd backend && uv run pytest`); one file `cd "$WT/backend" && uv run pytest tests/integration/test_x.py -x -q`; `make lint-backend` (ruff check, ruff format --check, mypy ratchet).
  - Fitness scripts need Python ≥ 3.10 (system `python3` is 3.9 and crashes): `cd "$WT/backend" && uv run --frozen python ../scripts/fitness/<check>.py`.
- **Backend integration DB.** pytest needs a Postgres at `settings.async_database_url` with the auth stub, Alembic head and the seed. Repo method (as CI): one container `docker run -d --name prumo-arch-pg -p 55432:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres postgres:17` (reuse it if running), **one database per worktree** `CREATE DATABASE postgres_test_s1`, `$WT/backend/.env` with fake values only (`DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres_test_s1`, `SUPABASE_URL=http://localhost:54321`, `SUPABASE_SERVICE_ROLE_KEY=stub-service-role`, `SUPABASE_ENV=local`, `OPENAI_API_KEY=sk-test-not-real`), then from `$WT/backend`: `uv sync --frozen --extra dev`, `psql postgresql://postgres:postgres@localhost:55432/postgres_test_s1 -f tests/integration/supabase_stub.sql`, `uv run alembic upgrade head`, `uv run python -m app.seed`. Never run `make db-fresh`/`reset-db` (they wipe the shared Supabase stack). `docker` may need the unsandboxed retry.
- **Handler coverage.** Lines driven through httpx ASGITransport register no coverage: every new or changed endpoint branch also gets a direct-call unit test of `fn.__wrapped__` with patched collaborators (`tests/unit/test_screening_review_unit.py` precedent).
- **Commits:** conventional, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A reviewer reads the records list while a conflict sits on a record they decided.** Their row must say "Waiting for others", carry no outcome, and the payload must hold no peer value or name — Task 1 `test_records_role_matrix` and `test_record_row_has_exactly_the_wire_fields`.
2. **`?article=<id>` points at a record that leaves the phase after a refetch** (deleted, moved, or a 404 from decide): param cleared with replace + toast "This article is not in this phase", list stays usable — Task 8 `clears a selection that drops out after a refetch` and Task 7 `maps a 404 from decide to the not-in-phase callback`.
3. **Two decision keys pressed before the first decide settles**: one POST only, keys ignored until settled — Task 7 `posts once for two fast key presses`.
4. **Manager deep-links `?screeningTab=settings` while the config read is pending**: no bounce to title_abstract, no first-run landing until it resolves — Task 9 `never redirects while the config read is pending`.
5. **Opening the panel maximized from a URL-driven selection** ("Start screening" with the panel closed): the panel must open maximized, not flash docked (S0's in-render reset cleared it) — Task 5 `opens maximized when the caller sets both in one update`.
6. **A reviewer decides a record from the To screen view and the records refetch.** The row must stay listed with its new chip until the view, search or a filter changes (or a reload) — Task 8 `keeps a decided row in the To screen view until the view or a filter changes`.
7. **A solo re-decide racing a ruling.** The ruling check reads the post-lock snapshot: the re-decide parked on the lock gets `SCREENING_DECISION_FINAL` — Task 2 `test_solo_re_decide_racing_a_ruling_is_refused`.
8. **Escape while a tooltip is open, and maximize while focus is in the list**: the tooltip closes first (no chain step), and focus lands in the panel, not `<body>` — Task 5 `yields Escape to an open tooltip`, `moves focus into the panel when maximizing from the list`.

## Open questions (the spec contradicts the tree; the plan's default is in brackets)

1. **Default status view by role (§4.2).** The spec's "arbitrator who is not a reviewer" cannot exist: `is_project_reviewer` = manager | reviewer | consensus and `is_project_arbitrator` = manager | consensus (`baseline_v1.sql:417`, `0025_reviewer_scoped_select_rls.py:47`), so every arbitrator is a reviewer and a manager is both. Ruled (2026-10-31) and spec §4.2 + its acceptance row amended to match: manager → All; consensus → Conflict when > 0, else To screen; reviewer → To screen; viewer → All — Task 4.
2. **Deletions ordering vs "S1a deletes queue/conflicts".** Deleting the backend schemas regenerates `schema.d.ts` without `ScreeningQueueRead`/`ScreeningConflictsRead`, which breaks `tsc` while frontend consumers exist, and `check_retired_symbols` needs the frontend symbols gone too. [The backend retirement is its own last backend task (11), after the frontend deletions (9); same PR.]
3. **5,000-row budget measured where (§4.6).** "200 ms on the CI runner" — jsdom (Vitest, which the acceptance row names) is far slower than a browser and would likely force windowing. [Task 10 measures in Vitest; over budget → stop, measure in real Chromium, controller rules.]
4. **`seed_screening` membership.** The spec says it uses "existing local profiles"; design review logs in as the E2E default user, who must be the seed project's manager. [`--manager-email` flag, default oldest profile — Task 2.]
5. **Tooltip and Escape (S0 review).** Adding `role="tooltip"` to `OPEN_OVERLAY_SELECTOR` would block every shortcut while any tooltip shows. [Only the shell's Escape yields to a tooltip — Task 5.]

---

### Task 1: Records read, config exclusion reasons, inclusion criteria (backend, S1a-1)

**Depends on:** S0 merged. **Parallel with:** Task 5.

**Files:**
- Modify: `backend/app/schemas/screening.py` (new types + models; `ScreeningConfigRead.exclusion_reasons`; module docstring "…config, enrollment, records, decisions…")
- Modify: `backend/app/services/screening_outcome.py` (add `record_status`)
- Modify: `backend/app/services/project_ai_context.py` (add `protocol_inclusion_criteria`, `load_inclusion_criteria` beside `:197-216`)
- Modify: `backend/app/repositories/screening_repository.py` (add `RecordSource`, `record_rows`)
- Modify: `backend/app/services/screening_review_service.py` (add `records`)
- Modify: `backend/app/services/screening_config_service.py` (`read` fills `exclusion_reasons`)
- Modify: `backend/app/api/v1/endpoints/screening.py` (add `get_screening_records`)
- Test: `backend/tests/unit/test_protocol_exclusion_reasons.py`, `backend/tests/unit/test_screening_outcome.py`, `backend/tests/unit/test_screening_review_unit.py` (add `"record_rows"` to the `test_screening_reads_require_a_project_scope` parametrize), `backend/tests/unit/test_screening_config_unit.py` (any `ScreeningConfigRead(...)` literal gains `exclusion_reasons`)
- Create: `backend/tests/unit/test_screening_records_unit.py`, `backend/tests/integration/test_screening_records.py`
- Modify: `backend/tests/integration/test_screening_config.py`
- Regenerate: `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`
- Modify: `frontend/components/screening/__tests__/ScreeningTab.test.tsx` (the `config()` fixture gains `exclusion_reasons: []`, one line; the regenerated type requires it)

**Interfaces — Produces (wire contract every frontend task consumes):**

```python
ScreeningPhase = Literal["title_abstract"]  # S3 widens
ScreeningRecordStatus = Literal[
    "not_enrolled", "to_screen", "waiting", "in_review", "conflict", "included", "excluded", "maybe"
]

class ScreeningRecordRow(BaseModel):
    """One project article in a screening phase as the caller may see it. No abstract: the panel reads the assignment."""
    article_id: UUID
    assignment_id: UUID | None          # None = not enrolled
    queue_rank: int                     # 0-based position in the server order
    title: str
    first_author: str | None            # authors[0]
    publication_year: int | None
    journal_title: str | None
    pmid: str | None
    doi: str | None
    ingestion_source: str | None
    has_pdf: bool                       # EXISTS article_files WHERE file_role = 'MAIN'
    status: ScreeningRecordStatus
    my_decision: ScreeningDecisionValue | None
    my_exclusion_reason: str | None
    outcome: ScreeningDecisionValue | None           # only when the record has an outcome
    outcome_exclusion_reason: str | None
    outcome_kind: ScreeningOutcomeKind | None

class ScreeningRecordsRead(BaseModel):
    """Every article of the project in one phase, in queue order, with the protocol criteria."""
    phase: ScreeningPhase
    reviewer_count: int
    inclusion_criteria: list[str]
    exclusion_reasons: list[str]
    rows: list[ScreeningRecordRow]

# ScreeningConfigRead gains:  exclusion_reasons: list[str]
```

- `GET /api/v1/projects/{project_id}/screening/records?phase=title_abstract` → `ApiResponse[ScreeningRecordsRead]`; `phase` required (`Query`), anything else 422; `@limiter.limit("120/minute")`; `Depends(require_project_scope)`; `responses={409: {"description": "Screening is not set up for this project"}}`.
- `record_status(state: AssignmentState, *, seated: bool, is_arbitrator: bool, can_review: bool) -> ScreeningRecordStatus` in `screening_outcome.py`: `caller_status` → `decided` maps the outcome decision `include/exclude/maybe` → `included/excluded/maybe`; `awaiting_me` → `to_screen`; `conflict` → `conflict`; `awaiting_others` → `waiting` if `seated` else `in_review` (§4.3).
- `protocol_inclusion_criteria(picots: Any, eligibility: Any) -> list[str]` — the mirror of `protocol_exclusion_reasons`: each PICOTS slot's inclusions in slot order (reader index `[1]`), then `eligibility["inclusion"]`, first occurrence kept. `load_inclusion_criteria(db, project_id) -> list[str]` mirrors `load_exclusion_reasons`.
- `ScreeningRepository.record_rows(self, *, project_id: UUID) -> list[RecordSource]`; `RecordSource` is a frozen dataclass in the repository module with `article_id, assignment_id, title, authors, publication_year, journal_title, pmid, doi, ingestion_source, has_pdf`. One SELECT: `Article` columns (never `abstract`) **outer**-joined to `ScreeningAssignment` on `and_(ARTICLE_STILL_IN_PROJECT, ScreeningAssignment.phase == SCREENING_PHASE)`, `WHERE Article.project_id == project_id`, `has_pdf` an `exists()` on `ArticleFile` (`article_id == Article.id`, `file_role == "MAIN"`). Order: enrolled first in `_QUEUE_ORDER`, then not-enrolled by `(Article.created_at, Article.id)` — i.e. `order_by(ScreeningAssignment.id.is_(None), *_QUEUE_ORDER, Article.created_at, Article.id)`.
- `ScreeningReviewService.records(self, project_id: UUID, viewer_id: UUID, phase: ScreeningPhase) -> ScreeningRecordsRead`: `reviewer_count is None` → `raise _not_configured()`; one `assignment_states(...)` for the project; `screening_roles(...)`; for each source row: no assignment or no snapshot → `not_enrolled`; else `record_status(snapshot.state, seated=snapshot.seats(viewer_id), ...)`; `my_*` from the viewer's own decision in `snapshot.decisions`; `outcome*` only when `snapshot.state.outcome` is set; `queue_rank` = enumerate index.

- [ ] **Step 1: Write the failing unit tests**

`test_protocol_exclusion_reasons.py`: `test_inclusion_criteria_in_slot_order_then_eligibility` — picots `{"population": {"inclusion": ["Adults"]}, "outcomes": {"inclusion": ["Mortality", "Adults"]}}`, eligibility `{"inclusion": ["RCT", "Mortality"]}` → `["Adults", "Mortality", "RCT"]` (the slot key is `outcomes`, plural — `_SLOT_KEYS`, `project_ai_context.py:54-61`; a slot not in `_SLOT_KEYS` is never read; copy the `{"<slot>": {"inclusion": [...]}}` shape the exclusion test at `:13-16` uses); `test_inclusion_criteria_empty_and_junk` → `protocol_inclusion_criteria(None, "x") == []`.

`test_screening_outcome.py`: `test_record_status` parametrized with `ids=`: decided include/exclude/maybe → included/excluded/maybe; pending unseated reviewer → `to_screen`; pending seated → `waiting`; pending viewer (`can_review=False`) → `in_review`; conflict unseated arbitrator → `conflict`; conflict seated arbitrator → `waiting`; conflict unseated non-arbitrator → `in_review`.

`test_screening_records_unit.py`:
- `test_record_row_has_exactly_the_wire_fields` — `set(ScreeningRecordRow.model_fields) == {...the 17 names above...}` and `"abstract" not in` it.
- `test_config_read_carries_exclusion_reasons` — `ScreeningConfigRead.model_fields["exclusion_reasons"].annotation == list[str]`.
- `test_records_handler_returns_the_read` — patch `ScreeningReviewService.records`; `await endpoint.get_screening_records.__wrapped__(request, PROJECT, "title_abstract", db, CALLER)` → `result.ok`, `result.data` is the patched read, `records` awaited with `(PROJECT, CALLER, "title_abstract")`.
- `test_records_route_is_limited_to_120_per_minute` — via slowapi's registry `limiter._route_limits["app.api.v1.endpoints.screening.get_screening_records"]`: `[str(l.limit) for l in ...] == ["120 per 1 minute"]`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd "$WT/backend" && uv run pytest tests/unit/test_protocol_exclusion_reasons.py tests/unit/test_screening_outcome.py tests/unit/test_screening_records_unit.py tests/unit/test_screening_review_unit.py -q`
Expected: FAIL — `ImportError: cannot import name 'protocol_inclusion_criteria'` / `'record_status'` / `'ScreeningRecordRow'`; the scope parametrize fails on `record_rows`.

- [ ] **Step 3: Implement the schemas, `record_status`, `protocol_inclusion_criteria`, `load_inclusion_criteria`** per Interfaces.

- [ ] **Step 4: Write the failing integration tests** in `tests/integration/test_screening_records.py` (reuse the `_request`/`_get` + `client_as` helpers and `screening_fixtures` builders the way `test_screening_review.py:47-92` does; `path = f"/api/v1/projects/{p}/screening/records?phase=title_abstract"`)

- `test_records_role_matrix` — rc 2; members A, B, C (`reviewer`), K and K2 (`consensus`), V (`viewer`), MANAGER (SEED). Articles: X (A include, B exclude "Not ML" → conflict), X2 (K2 include, A exclude → conflict, K2 seated), Y (A include → pending), W (A include, B include → consensus include), Z (not enrolled). Assert `status` per caller:

  | caller | X | X2 | Y | W | Z |
  | --- | --- | --- | --- | --- | --- |
  | A | waiting | waiting | waiting | included | not_enrolled |
  | C | in_review | in_review | to_screen | included | not_enrolled |
  | K | conflict | conflict | to_screen | included | not_enrolled |
  | K2 | conflict | waiting | to_screen | included | not_enrolled |
  | MANAGER | conflict | conflict | to_screen | included | not_enrolled |
  | V | in_review | in_review | in_review | included | not_enrolled |

  plus: A's X row has `my_decision == "include"`, `outcome is None`, `outcome_kind is None`; C's X row `my_decision is None`; W rows `outcome == "include"`, `outcome_kind == "consensus"` for everyone; every row's keys equal the 17 wire names (no reviewer id or name anywhere in the payload).
- `test_records_counts_and_anti_join` — rc 2, reviewers A, B, C; caller A over r1, r2 (nothing), r3 (A include), r4 (B include, C exclude), r5 (B, C include), r6 (B, C exclude "Not ML"), r7 (B, C maybe), r8, r9 not enrolled → `Counter(row["status"])` == `{to_screen: 2, waiting: 1, in_review: 1, included: 1, excluded: 1, maybe: 1, not_enrolled: 2}` (Task 4's Vitest fixture pins the same counts); r8/r9 rows have `assignment_id is None` and come after every enrolled row; `[r["queue_rank"] for r in rows] == list(range(9))`.
- `test_records_follow_queue_order` — enrolled at JAN_1 (3) and JAN_2 (2): enrolled ids in rows == JAN_1 ids sorted by `md5(str(id))` then JAN_2 likewise (reuse `_md5_order` from `test_screening_review.py:363`).
- `test_records_unconfigured_is_409` — rc None → 409, `error.code == "SCREENING_NOT_CONFIGURED"`.
- `test_records_phase_is_required_and_closed` — no `phase` → 422; `phase=full_text` → 422.
- `test_records_non_member_is_403` — a user with no membership → 403.
- `test_has_pdf_only_with_a_main_file` — articles with no file, a `SUPPLEMENT` file, a `MAIN` file → `has_pdf` False, False, True (insert `ArticleFile` rows with `project_id`, `article_id`, `file_type="pdf"`, `storage_key`, `file_role`).
- `test_moved_article_drops_out` — enrolled article moved (`move_article`) → absent from the old project's rows; in the new project it is a `not_enrolled` row with `assignment_id is None`.
- `test_records_carry_the_protocol_criteria` — eligibility `{"inclusion": ["Adults"], "exclusion": ["Wrong population", "Not ML"]}` → `inclusion_criteria == ["Adults"]`, `exclusion_reasons == ["Wrong population", "Not ML"]`, `reviewer_count == 2`, `phase == "title_abstract"`.

In `test_screening_config.py`: `test_config_carries_the_protocol_exclusion_reasons` — the same eligibility → `config["exclusion_reasons"] == ["Wrong population", "Not ML"]`; a project with none → `[]`.

Run: `cd "$WT/backend" && uv run pytest tests/integration/test_screening_records.py tests/integration/test_screening_config.py -q`
Expected: FAIL — 404 on the records path; `KeyError: 'exclusion_reasons'`.

- [ ] **Step 5: Implement `record_rows`, `records`, the route and the config field** per Interfaces. The route docstring says it replaces the queue read. If `check_scope_guards.py` flags the `ArticleFile` exists-subquery as a duplicate predicate, reuse the existing implementation it names instead of baselining.

- [ ] **Step 6: Run to verify everything passes**

Run: `cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_screening_records.py tests/integration/test_screening_config.py tests/integration/test_screening_review.py tests/integration/test_screening_arbitration.py -q`
Expected: PASS, `0 failed`.

- [ ] **Step 7: Regenerate types and keep the frontend compiling**

Run: `cd "$WT" && npm run generate:api-types && npm run typecheck`
Expected: typecheck fails only on `ScreeningTab.test.tsx`'s `config()` fixture (missing `exclusion_reasons`); add `exclusion_reasons: []`, rerun → exit 0. `grep -c ScreeningRecordsRead frontend/types/api/schema.d.ts` ≥ 1.

- [ ] **Step 8: Gates**

Run: `make -C "$WT" lint-backend` and, from `$WT/backend`, `uv run --frozen python ../scripts/fitness/check_scope_guards.py`, `… check_api_response_envelope.py`, `… check_layered_arch.py`, `uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`; `npm run test:run -- frontend/components/screening`
Expected: all exit 0.

- [ ] **Step 9: Commit**

```bash
git -C "$WT" add backend/app backend/tests frontend/types/api frontend/components/screening/__tests__/ScreeningTab.test.tsx
git -C "$WT" commit -m "feat(screening): add the blind-safe title/abstract records read" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Solo re-decide, decide 409 wording, local screening seed (backend, S1a-2)

**Depends on:** Task 1. **Parallel with:** Tasks 3, 4, 6–10 (touches no frontend file except the regenerated types, which no frontend task writes).

**Files:**
- Modify: `backend/app/services/screening_review_service.py` (`decide`, `:228-264`)
- Modify: `backend/app/services/screening_outcome.py` (`derive_state` docstring `:74-77`)
- Modify: `backend/app/api/v1/endpoints/screening.py` (decide route 409 description `:155-160`)
- Modify: `backend/app/repositories/screening_repository.py` (queue-order comment `:53-54`, sibling commit)
- Create: `backend/app/seed_screening.py`; Modify: `Makefile` (target `db-seed-screening`)
- Modify: `scripts/fitness/check_layered_arch.py` (add `"seed_screening"` to `ENTRYPOINTS`, `:48-57` — an unclassified top-level `app.<x>` makes the scan exit 2, `:130-135`)
- Test: `backend/tests/integration/test_screening_review.py` (add solo cases; keep `test_a_reviewers_decision_is_final`, rc 2, unchanged), `backend/tests/integration/test_screening_concurrency.py` (`_screening` gains `reviewer_count: int = 2`; add the solo race case), Create: `backend/tests/unit/test_seed_screening.py`, `backend/tests/integration/test_seed_screening.py`
- Regenerate: `frontend/types/api/openapi.json`, `schema.d.ts`

**Interfaces:**
- Consumes: Task 1's records route (the seed test reads it).
- Produces: `decide` behaviour (§6.3, TA only): a seated reviewer may decide again **only when** `reviewer_count == 1` and `snapshot.ruling is None`; that path appends a row and skips the `SCREENING_REVIEWER_CAP` check; anything else seated → `SCREENING_DECISION_FINAL` (unchanged). The checks stay after `lock_assignment` (they read the post-lock snapshot). No new error code (the FT `SCREENING_PHASE_ADVANCED` check is S3).
- Produces: `backend/app/seed_screening.py` with `assert_local_database(url: str) -> None` (raises `SystemExit` with a message unless the URL host is `localhost` or `127.0.0.1`), `async def build(db: AsyncSession, *, manager_id: UUID, reviewer_ids: tuple[UUID, UUID]) -> UUID` (flush only, returns the project id; **its first statement** is the guard on the engine the session actually writes to — `bind = db.get_bind(); assert_local_database(str(getattr(bind, "engine", bind).url))`, so a future importer of `build` cannot bypass it; `app/` ships in the prod image, `backend/Dockerfile:100-114`), `async def resolve_profiles(db: AsyncSession, manager_email: str | None) -> tuple[UUID, tuple[UUID, UUID]]` (manager by `profiles.email`, else the oldest profile; the two oldest other profiles; unknown email or fewer than three profiles → `SystemExit`) and `main()` (`python -m app.seed_screening [--manager-email EMAIL]`: guard on `settings.DATABASE_URL` **before** opening any session, then `resolve_profiles`, `build`, commit, print).

- [ ] **Step 1: Write the failing solo tests** in `test_screening_review.py` (reuse `_project`, `_decide`, `_rows_of`)

- `test_solo_re_decide_appends_and_changes_the_outcome` — rc 1, reviewer R decides include, then exclude "Not ML" → 200; `_rows_of` has 2 rows (oldest first include, exclude); response `outcome == {"kind": "solo", "decision": "exclude", "exclusion_reason": "Not ML", "reasons_differ": False}`; the records read row for R is `excluded`.
- `test_solo_re_decide_skips_the_reviewer_cap` — rc 1, R's second post is 200, not `SCREENING_REVIEWER_CAP`.
- `test_solo_re_decide_refused_after_arbitration` — rc 1, R include, `add_ruling(..., MANAGER, "exclude")`, R posts maybe → 409 `SCREENING_DECISION_FINAL`, rows unchanged.
- `test_another_reviewer_on_a_solo_record_hits_the_cap` — rc 1, R decided, reviewer S posts → 409 `SCREENING_REVIEWER_CAP`.

In `test_screening_concurrency.py` (real commits, `session_factory`): give `_screening` a `reviewer_count: int = 2` keyword passed to `set_reviewer_count` (existing callers unchanged), then add `test_solo_re_decide_racing_a_ruling_is_refused` beside `test_one_reviewer_posting_twice_at_once_writes_one_decision` — rc 1, reviewer R's include committed through `_decide`. Session `s1`: `ScreeningRepository(s1).lock_assignment(assignment)`, `add_arbitration(assignment, "exclude", None, None, None, MANAGER)`, set `locked`, then poll from a third session (≤ 1 s, 20 ms steps) until `SELECT count(*) FROM pg_locks WHERE NOT granted` > 0 — the re-decide is parked on the lock — and commit. Task `redecide`: await `locked`, then in `s2` `ScreeningReviewService(s2).decide(assignment, R, ScreeningDecisionCreate(decision="maybe"))` — it blocks on the lock until `s1` commits. Run both with `asyncio.gather(..., return_exceptions=True)`. Assert the poll saw a waiter, the re-decide raised `ScreeningStateError` with `code == "SCREENING_DECISION_FINAL"`, and `_decision_rows(...) == 1`. This pins that the `ruling is None` check reads the **post-lock** snapshot (spec §6.3); a check read before `lock_assignment` lets the maybe through.

Run: `cd "$WT/backend" && uv run pytest tests/integration/test_screening_review.py tests/integration/test_screening_concurrency.py -k solo -q`
Expected: FAIL — 409 `SCREENING_DECISION_FINAL` where 200 is expected (the race case passes already today: no re-decide path exists; it must stay green after Step 2).

- [ ] **Step 2: Implement the solo branch in `decide`**; reword the `derive_state` docstring to "A reviewer's latest decision is their current one: final in dual review, re-decidable by a solo reviewer until a ruling (§6.3); the latest ruling is the last word."; reword the decide 409 description to "Screening not set up, the caller already decided (final in dual review; a solo reviewer may decide again until the record is arbitrated), the record has all its reviewers, or the exclusion reason is not in the protocol".

Run: `cd "$WT/backend" && uv run pytest tests/integration/test_screening_review.py tests/integration/test_screening_concurrency.py tests/unit -q`
Expected: PASS.

- [ ] **Step 3: Write the failing seed tests**

`tests/unit/test_seed_screening.py`: `test_refuses_a_remote_database` parametrized (`ids=`) over `postgresql://u:p@db.supabase.co:5432/postgres`, `postgresql://u:p@10.0.0.4/x` → `pytest.raises(SystemExit)`; `test_accepts_a_local_database` over `…@localhost:54322/postgres`, `…@127.0.0.1:55432/x` → returns `None`; `test_build_refuses_a_session_bound_to_a_remote_engine` — a `MagicMock` session whose `get_bind()` returns an object with `.url` = a remote URL → `await build(...)` raises `SystemExit` and `db.execute`/`db.add`/`db.flush` were never called; `test_main_guards_before_opening_a_session` — patch `settings.DATABASE_URL` to a remote URL and the module's session factory with a `Mock` → `main()` raises `SystemExit`, factory not called; `test_main_needs_three_profiles` — patch `resolve_profiles` to raise the "needs three local profiles" `SystemExit` and the session factory with an async-context stub → `main()` raises it and `build` (patched) is never awaited.

`tests/integration/test_seed_screening.py`: `test_seed_builds_a_conflict_the_manager_can_rule` — `manager = SEED.primary_profile`, two reviewers from `add_member(db_session, <throwaway project>, "reviewer")`; `project = await build(db_session, manager_id=manager, reviewer_ids=(r1, r2))`; the records read as `manager` has ≥ 1 `conflict`, ≥ 1 `to_screen`, ≥ 1 `included`, exactly 2 `not_enrolled`; as `r1` the conflict row is `waiting`; calling `build` twice leaves one project with that id (rebuild, not duplicate). `test_resolve_profiles_by_email_and_by_age` — with `manager_email` = the SEED primary profile's email (read it with `select(Profile.email).where(Profile.id == SEED.primary_profile)`) → that id as manager and two other distinct ids; with `None` → three distinct ids, the manager's `created_at` ≤ every other profile's; an unknown email → `SystemExit`.

Run: `cd "$WT/backend" && uv run pytest tests/unit/test_seed_screening.py tests/integration/test_seed_screening.py -q`
Expected: FAIL — `ModuleNotFoundError: app.seed_screening`.

- [ ] **Step 4: Implement `backend/app/seed_screening.py`**

Module docstring: local only, never called from `seed.py` (which runs on every prod boot, `backend/Dockerfile:100-114`, `railway.toml:60`); creates no auth users; grows per slice (S2 duplicate pair, S3 full-text record with a PDF). `build`: project id `uuid5(NAMESPACE_URL, "prumo:seed-screening")`; delete an existing one through `project_delete_service.delete_project_row` (ignore `NotFoundError`); insert ORM `Project` (name `"Screening workspace (local seed)"`, `created_by_id=manager_id`, `eligibility_criteria={"inclusion": ["Adults with sepsis"], "exclusion": ["Wrong population", "Not a primary study", "Wrong outcome"]}`) and ORM `ProjectMember` rows (manager `manager`, reviewers `reviewer`); 12 articles with distinct titles, authors, journals, years; enroll the first 10 through `ScreeningRepository.enroll(article_ids=…)`; `reviewer_count = 2` through `ProjectRepository.update_settings_key` (the `set_reviewer_count` merge lambda shape); decisions through `ScreeningRepository.add_decision`: #1 r1 include / r2 exclude "Wrong population" (conflict), #2 both include, #3 both exclude "Not a primary study", #4 r1 include only; the rest pending; #11, #12 not enrolled. `build` starts with the bind guard (Interfaces). `resolve_profiles`: the manager by `--manager-email` on `profiles.email` (unknown → `SystemExit`), else the oldest profile; the two oldest other profiles; fewer than three profiles → `SystemExit("seed_screening needs three local profiles; sign up two more users first")`. `main()`: `assert_local_database(str(settings.DATABASE_URL))` before anything else; open a session the way `app/seed.py` does, `resolve_profiles`, `build`, commit, print `/projects/<id>?tab=screening`. Add `"seed_screening"` to `ENTRYPOINTS` in `scripts/fitness/check_layered_arch.py` (it is an entrypoint like `seed`).

Makefile, beside `db-seed`:

```make
db-seed-screening: ## Local only: a screening project with a conflict (refuses a non-local DATABASE_URL)
	@cd $(BACKEND_DIR) && env -u DATABASE_URL -u SUPABASE_DATABASE_URL uv run python -m app.seed_screening
```

Run: `cd "$WT/backend" && uv run pytest tests/unit/test_seed_screening.py tests/integration/test_seed_screening.py -q`
Expected: PASS.

- [ ] **Step 5: Regenerate types, gates**

Run: `cd "$WT" && npm run generate:api-types && git -C "$WT" diff --stat frontend/types/api` (expected: description-only change on the decide route), `make -C "$WT" lint-backend`, and from `$WT/backend` `uv run --frozen python ../scripts/fitness/check_scope_guards.py`, `uv run --frozen python ../scripts/fitness/check_layered_arch.py` (exit 0 with `seed_screening` classified; before the `ENTRYPOINTS` edit it exits 2 "top-level package 'app.seed_screening' is unclassified") and the vulture command.
Expected: all exit 0.

- [ ] **Step 6: Commit (feature)**

```bash
git -C "$WT" add backend/app/services backend/app/api backend/app/seed_screening.py Makefile backend/tests frontend/types/api scripts/fitness/check_layered_arch.py
git -C "$WT" commit -m "feat(screening): let a solo reviewer decide again and add a local screening seed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Sibling commit — the stale queue-order comment** (`screening_repository.py:53-54`): replace with "Queue order: oldest enrollment first, then md5(assignment id) — a stable shuffle within an enrollment that is the same for every reviewer." Nothing else changes.

```bash
git -C "$WT" add backend/app/repositories/screening_repository.py
git -C "$WT" commit -m "refactor(screening): correct the queue-order comment" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Data layer — records key, service, hooks, invalidation call sites (frontend, S1b-1)

**Depends on:** Task 1 (types), Task 5 (it last touched `AssignmentView.tsx`, `ScreeningQueue.tsx`, `ConflictsPanel.tsx`). **Parallel with:** Tasks 2, 4.

**Files:**
- Modify: `frontend/lib/query-keys/screening.ts`; Create: `frontend/lib/query-keys/screening.test.ts`
- Modify: `frontend/services/screeningService.ts`
- Create: `frontend/hooks/screening/useScreeningRecords.ts`, `frontend/hooks/screening/useScreeningMutations.ts`, `frontend/hooks/screening/__tests__/useScreeningRecords.test.tsx`
- Modify: `frontend/hooks/screening/useScreeningQueue.ts` (remove `useDecide`), `frontend/hooks/screening/useScreeningConflicts.ts` (remove `useArbitrate`), `frontend/components/screening/AssignmentView.tsx`, `ScreeningQueue.tsx`, `ConflictsPanel.tsx` (import paths only), `frontend/hooks/screening/__tests__/useScreeningQueue.test.tsx` (import path), `frontend/hooks/screening/__tests__/screeningQueries.remount.test.tsx` (add the records case)
- Modify: `frontend/pages/ProjectView.tsx`, `frontend/components/articles/ArticlesList.tsx`, `frontend/components/articles/ArticleForm.tsx`
- Test (modify, add one case each): `frontend/test/ArticlesList.deleteGate.test.tsx`, `frontend/test/components/ArticleForm.characterization.test.tsx` (or the ArticleForm suite that already submits create/update), a ProjectView test under `frontend/test/pages/` that renders the RIS/Zotero dialogs (`ProjectView.screeningTabs.test.tsx` mocks; add the case where the import dialog's `onImportComplete` is reachable)

**Interfaces — Produces:**

```ts
// lib/query-keys/screening.ts  (queue/conflicts stay until Task 9)
records: (projectId: string, phase?: ScreeningPhase) =>
  phase ? [...screeningKeys.project(projectId), 'records', phase] as const
        : [...screeningKeys.project(projectId), 'records'] as const,
export function invalidateScreening(queryClient: QueryClient, projectId: string): Promise<void>;
//   = queryClient.invalidateQueries({queryKey: screeningKeys.project(projectId)})

// services/screeningService.ts
export type ScreeningRecordsRead = components['schemas']['ScreeningRecordsRead'];
export type ScreeningRecordRow = components['schemas']['ScreeningRecordRow'];
export type ScreeningPhase = ScreeningRecordsRead['phase'];
/** 409 SCREENING_NOT_CONFIGURED (the UI gates on the config read and never sends it then); 403 non-member. */
export function fetchScreeningRecords(projectId: string, phase: ScreeningPhase): Promise<ErrorResult<ScreeningRecordsRead>>;
//   GET /api/v1/projects/${projectId}/screening/records?phase=${phase}

// hooks/screening/useScreeningRecords.ts
export function useScreeningRecords(projectId: string, phase: ScreeningPhase, enabled: boolean): UseQueryResult<ScreeningRecordsRead>;
//   key records(projectId, phase); enabled && Boolean(projectId); refetchOnMount 'always' (same comment as useScreeningConfig)

// hooks/screening/useScreeningMutations.ts — moved verbatim (behaviour unchanged here; Task 9 drops the queue optimism)
export function useDecide(projectId: string);   // from useScreeningQueue.ts:35-68
export function useArbitrate(projectId: string); // from useScreeningConflicts.ts:33-51
```

- [ ] **Step 1: Write the failing tests**
  - `screening.test.ts`: `records(p)` equals `['screening','project','p','records']` (length 4, no trailing `undefined`); `records(p,'title_abstract')` appends the phase; `partialMatchKey(records(p,'title_abstract'), records(p))` is true (import `partialMatchKey` from `@tanstack/query-core`); `invalidateScreening(client, 'p')` marks a cached `records('p','title_abstract')` query invalidated (`client.getQueryState(key)?.isInvalidated`).
  - `useScreeningRecords.test.tsx` (MSW, fresh `QueryClient` per test): requests `GET */screening/records` with `phase=title_abstract` and returns `data.rows`; `enabled=false` sends nothing; a 409 envelope surfaces as `isError` with `error.code === 'SCREENING_NOT_CONFIGURED'`.
  - `screeningQueries.remount.test.tsx`: add `useScreeningRecords` to the "refetches on remount" cases (mock `fetchScreeningRecords` in its `vi.mock` factory).
  - Invalidation (spy `vi.spyOn(queryClient, 'invalidateQueries')`, assert called with `{queryKey: ['screening','project',projectId]}`): `ArticlesList` single delete and bulk delete success; `ArticleForm` create success and update success; `ProjectView` RIS and Zotero `onImportComplete`.

Run: `npm run test:run -- frontend/lib/query-keys frontend/hooks/screening frontend/test/ArticlesList.deleteGate.test.tsx frontend/test/components/ArticleForm.characterization.test.tsx frontend/test/pages`
Expected: FAIL — `records is not a function`, unresolved `useScreeningRecords`, spies not called.

- [ ] **Step 2: Implement** the key, `invalidateScreening`, the service call, `useScreeningRecords`, and move `useDecide`/`useArbitrate` into `useScreeningMutations.ts` (delete them from the old files in the same edit; update the four importers). Call sites: `ProjectView` passes `onImportComplete={() => { void loadArticles(); void invalidateScreening(queryClient, projectId || ''); }}` to both dialogs; `ArticlesList` calls `void invalidateScreening(queryClient, projectId)` after each successful `deleteArticles` (`:485`, `:514`; keep within +23 lines); `ArticleForm` after a successful `insertArticle` (`:527`) and `updateArticle` (`:543`). Each gets `useQueryClient()`.

- [ ] **Step 3: Run to verify it passes**

Run: the Step 1 command, then `npm run test:run -- frontend/components/screening frontend/components/articles frontend/test && npm run typecheck`
Expected: PASS, exit 0. (`useScreeningRecords` has no production consumer until Task 8: `deadcode:production` reports it; expected here, gated from Task 9.)

- [ ] **Step 4: Gates and commit**

Run: from `$WT/backend`, `uv run --frozen python ../scripts/fitness/check_react_query_keys.py`, `… check_frontend_data_path.py`, `… check_file_size.py`; `npx eslint <touched files>`
Expected: exit 0.

```bash
git -C "$WT" add frontend/lib/query-keys frontend/services/screeningService.ts frontend/hooks/screening frontend/components/screening frontend/pages/ProjectView.tsx frontend/components/articles frontend/test
git -C "$WT" commit -m "feat(screening): add the records query and invalidate screening on article writes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Records vocabulary — pure functions (frontend, S1b-2)

**Depends on:** Task 1 (types). **Parallel with:** Tasks 2, 3, 5.

**Files:** Create `frontend/lib/screening/records.ts`, `frontend/lib/screening/records.test.ts`. Nothing else (no copy: labels are attached by the components).

**Interfaces — Produces** (types read from `@/types/api/schema` directly so this task does not wait for Task 3):

```ts
type Row = components['schemas']['ScreeningRecordRow'];
export type RecordStatus = Row['status'];
export type StatusView = 'all' | RecordStatus;
export const STATUS_VIEWS: readonly StatusView[] =
  ['all', 'to_screen', 'waiting', 'in_review', 'conflict', 'included', 'excluded', 'maybe', 'not_enrolled'];
export const HIDDEN_AT_ZERO: ReadonlySet<StatusView> = new Set(['conflict', 'not_enrolled']);
export function statusCounts(rows: Row[]): Record<StatusView, number>;
export function visibleStatusViews(counts: Record<StatusView, number>): StatusView[];
type Roles = {can_manage: boolean; can_review: boolean; can_arbitrate: boolean};
export function isReadOnly(roles: Roles): boolean;   // viewer: no role flag set — no decision buttons, no toolbar writes (§4.6)
export function defaultStatusView(roles: Roles, counts: Record<StatusView, number>): StatusView;
export type RecordFilterId = 'title' | 'authors' | 'journal' | 'year' | 'my_decision' | 'exclusion_reason' | 'source';
export function filterRecords(rows: Row[], q: {search: string; filters: FilterValues; status: StatusView; keep?: ReadonlySet<string>}): Row[];
//   keep = article ids decided this session in the current view (Task 8): they pass the status predicate, never search/filters
export type RecordSortField = 'queue' | 'title' | 'year' | 'status';
export function sortRecords(rows: Row[], field: RecordSortField, direction: 'asc' | 'desc'): Row[];
export function progress(rows: Row[]): {decided: number; enrolled: number; myLeft: number};
export function nextToScreen(rows: Row[], currentArticleId: string | null): Row | null;
export const RECORD_CSV_COLUMNS: readonly (keyof Row)[];  // the 17 §5 row fields, wire order
export function recordsToCsv(rows: Row[]): string;
```

Rules the tests pin:
- `isReadOnly`: true only when `can_manage`, `can_review` and `can_arbitrate` are all false.
- `defaultStatusView` (spec §4.2 as amended: every arbitrator is a reviewer in this tree, so the arbitrator rule reads "consensus"): `can_manage` → `'all'`; else `can_arbitrate` (consensus) → `'conflict'` when `counts.conflict > 0`, else `'to_screen'`; else `can_review` → `'to_screen'`; else (viewer) `'all'`.
- `filterRecords`: `search` matches title, first_author, journal_title, pmid, doi (case-insensitive substring); `title`/`authors` (first_author)/`journal` text contains; `year` `{min,max}` inclusive (null year excluded when a bound is set); `my_decision` values `include|exclude|maybe|none` (`none` = `my_decision === null`); `exclusion_reason` matches `my_exclusion_reason` or `outcome_exclusion_reason`; `source` matches `ingestion_source ?? 'unknown'`; `status === 'all'` keeps every status; a row whose `article_id` is in `keep` passes the status predicate whatever its status (a decided row stays in the To screen view), but search and filters still apply to it.
- `sortRecords`: `queue` = `queue_rank`; `status` order `to_screen, conflict, in_review, waiting, maybe, included, excluded, not_enrolled`; ties by `queue_rank`; does not mutate its input.
- `progress`: `enrolled` = rows with an `assignment_id`; `decided` = rows whose status is included/excluded/maybe; `myLeft` = `to_screen` count.
- `nextToScreen`: the first `to_screen` row after the current one in `queue_rank` order, else the first `to_screen` overall, else `null`; the current row itself is never returned.
- `recordsToCsv`: header line = `RECORD_CSV_COLUMNS` joined by `,`; RFC 4180 quoting (a field with `,`, `"` or a newline is quoted, `"` doubled); `null` → empty; lines joined by `\r\n`; no `abstract` column.

- [ ] **Step 1: Write the failing tests** in `records.test.ts`, one `describe` per function, with `COUNTS_FIXTURE` = 9 rows whose statuses are to_screen ×2, waiting, in_review, included, excluded, maybe, not_enrolled ×2 (the same counts as Task 1's `test_records_counts_and_anti_join`) → `statusCounts` gives those plus `all: 9`, `conflict: 0`; `visibleStatusViews` omits `conflict` (0) but keeps a zero `maybe`; one `it` per rule bullet above — including `defaultStatusView` for manager → all, consensus with a conflict → conflict, consensus without → to_screen, reviewer → to_screen, viewer → all; `isReadOnly` true only for the all-false roles; `filterRecords` with `status: 'to_screen'` and `keep` holding an `included` row's id keeps that row, and drops it when a search excludes it — plus `recordsToCsv` of a title `Sepsis, "early" care` → `"Sepsis, ""early"" care"`.

Run: `npm run test:run -- frontend/lib/screening/records.test.ts`
Expected: FAIL — `Failed to resolve import "./records"`.

- [ ] **Step 2: Implement `records.ts`** per Interfaces (≤ 220 lines).

- [ ] **Step 3: Run to verify it passes**, then `npm run typecheck && npx eslint frontend/lib/screening/records.ts frontend/lib/screening/records.test.ts`
Expected: PASS, exit 0. (Production consumers arrive in Tasks 6–8.)

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/lib/screening/records.ts frontend/lib/screening/records.test.ts
git -C "$WT" commit -m "feat(screening): add the records status vocabulary and list functions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Keyboard and shell primitives (frontend, S1d-1)

**Depends on:** S0 merged. **Parallel with:** Tasks 1, 2, 4.

**Files:**
- Modify: `frontend/lib/screening/keymap.ts`, `frontend/lib/screening/keymap.test.ts`
- Modify: `frontend/components/screening/DecisionButtons.tsx`; Create: `frontend/components/screening/__tests__/DecisionButtons.test.tsx`
- Modify (pass `phase="title_abstract"` only): `frontend/components/screening/AssignmentView.tsx`, `ScreeningQueue.tsx`, `ConflictsPanel.tsx`
- Modify: `frontend/hooks/useListKeyboardShortcuts.ts`; Create: `frontend/hooks/useListKeyboardShortcuts.test.ts`
- Modify: `frontend/components/layout/ListDetailSplitShell.tsx`, `frontend/components/layout/ListDetailSplitShell.test.tsx`

**Interfaces — Produces:**

```ts
// keymap.ts — signature change (spec §4.5); no new action kind
export function screeningKeyAction(event: KeyEventLike, armed: boolean, phase: 'title_abstract'): ScreeningKeyAction;
//   TA: 1 include, 2 exclude, 3 maybe, E arms the reason list; armed: 1–9 picks a reason. S3 widens `phase`.

// DecisionButtons.tsx
interface DecisionButtonsProps {
  reasons: string[];
  disabled: boolean;
  onDecide: (body: ScreeningDecisionCreate) => void;
  phase: 'title_abstract';
  /** The caller's recorded decision on a solo record: drawn with the recorded-choice ring; pressing it again does nothing, another value re-decides. */
  recorded?: ScreeningDecisionCreate['decision'] | null;
}

// ListDetailSplitShell.tsx — new optional controlled pair
  /** Controlled maximize. When `maximized` is passed the shell keeps no maximize state of its own and never resets it during render: the caller clears it (e.g. when it closes the panel). */
  maximized?: boolean;
  onMaximizedChange?: (maximized: boolean) => void;
```

Current line refs after S0 (`frontend/hooks/useKeyboardShortcuts.ts`): `isTypingTarget` `:40`, `OPEN_OVERLAY_SELECTOR` `:47-48`, the chord match (`b.code ? e.code : e.key`) `:99`; `useListKeyboardShortcuts.ts` Escape branch `:53`. This task does not modify `useKeyboardShortcuts.ts`.

Two shell fixes from the S0 final review (2026-10-30):
- **Escape yields to an open Radix Tooltip.** `role="tooltip"` is not in `OPEN_OVERLAY_SELECTOR`, and must not be added there (a hovered tooltip would then disable every shortcut app-wide). The shell's capture listener alone also returns untouched while `document.querySelector('[role="tooltip"]')` is present, so Radix dismisses the tooltip on that press; the next press runs the chain.
- **Maximize moves focus into the panel.** When the shell goes from docked to maximized and `document.activeElement` is inside the list panel (about to be `hidden`; focus would drop to `<body>`), focus moves to the panel element (`#${idPrefix}-panel`, given `tabIndex={-1}`) in an effect keyed on `isMaximized`. Focus elsewhere is left alone. Restore does not move focus.

Shell rules (coordinator input from the S0 build, 2026-10-30): in controlled mode `isMaximized = maximizable && panelOpen && maximized`; ⇧⌘\ on a closed panel calls `onMaximizedChange(true)` then `onPanelOpenChange(true)` (S0's local flag was wiped by its in-render reset when `panelOpen` arrived a render later — the controlled path has no reset, which is the fix); ⇧⌘\ on an open panel calls `onMaximizedChange(!isMaximized)`; Esc's maximize step calls `onMaximizedChange(false)`. Uncontrolled mode keeps S0's behaviour exactly. The list and the handle stay hidden with the `hidden` attribute (S0).

Recorded ring (frontend-ux §5): the recorded button gets `aria-pressed="true"`, `ring-1 ring-success bg-success/10 text-success` and a `Check` icon (`h-4 w-4`, `strokeWidth={1.5}`); others `aria-pressed="false"` when `recorded` is set.

- [ ] **Step 1: Write the failing tests**
  - `keymap.test.ts`: rewrite every call to `screeningKeyAction(event, armed, 'title_abstract')`; keep every existing case; add `it('returns null for 1-9 picks while not armed is a decision, not a reason')` — `('4', false)` → `null`.
  - `DecisionButtons.test.tsx`: `draws the recorded decision with the success ring` (`recorded="include"` → Include has `aria-pressed="true"` and class `ring-success`; Exclude `aria-pressed="false"`); `re-decides with another value` (click Exclude → `onDecide({decision:'exclude'})`); `ignores the recorded value` (click Include and key `1` → `onDecide` not called); `keys decide while enabled` (`3` → maybe); `keys are inert in a text field` (keydown `1` on an `<input>` → not called).
  - `useListKeyboardShortcuts.test.ts`: `ignores an Escape another handler already handled` — popover open, an Escape event with `preventDefault()` already called → `setFilterPopoverOpen` not called; same with `selectedCount: 2` + `deselectAll` → not called; `closes the filter popover on a fresh Escape` → called with `false`.
  - `ListDetailSplitShell.test.tsx` (add a controlled `Harness` holding `maximized` state, resetting it in its own close handler): `opens maximized when the caller sets both in one update` (closed panel; the harness's button sets `maximized=true` and `open=true` together, as "Start screening" and a URL-driven selection do → after render `data-maximized="true"` and the list `not.toBeVisible()`); `opens maximized from ⇧⌘\ on a closed panel in controlled mode` (spy `onMaximizedChange(true)`, `onPanelOpenChange(true)`; then maximized); `restores on Escape through onMaximizedChange(false)`; `hides the resize handle while maximized` (`document.querySelector('[data-slot="resizable-handle"]')` — or the handle's role `separator` — `not.toBeVisible()`; visible again after restore); `keeps S0 behaviour when uncontrolled` (existing tests stay green unchanged); `yields Escape to an open tooltip` (render a sibling `<div role="tooltip"/>`, open panel, Esc → `onPanelOpenChange` not called, event not `defaultPrevented`; remove it, Esc → closes); `moves focus into the panel when maximizing from the list` (focus the list's `<input aria-label="search"/>` — a `mod` chord fires in a text field — press ⇧⌘\ → `document.activeElement` is `#t-shell-panel` or inside it, not `document.body`); `leaves focus alone when maximizing from the panel` (focus the panel's `field` input, maximize → still focused).

Run: `npm run test:run -- frontend/lib/screening/keymap.test.ts frontend/components/screening/__tests__/DecisionButtons.test.tsx frontend/hooks/useListKeyboardShortcuts.test.ts frontend/components/layout/ListDetailSplitShell.test.tsx`
Expected: FAIL — keymap arity cases, ring assertions, `defaultPrevented` cases, controlled-maximize, tooltip and focus cases.

- [ ] **Step 2: Implement** the keymap signature; `DecisionButtons` `phase` (passed to `screeningKeyAction`) and `recorded`; in `useListKeyboardShortcuts`' Escape branch an early `if (e.defaultPrevented) return;` with a comment naming the shell's capture-phase chain; the shell's controlled pair. Consumers pass `phase="title_abstract"`.

- [ ] **Step 3: Run to verify it passes**, then `npm run test:run -- frontend/components/screening frontend/components/layout frontend/components/articles frontend/test/components && npm run typecheck && npx eslint <touched files>`
Expected: PASS (Articles' S0 tests unchanged), exit 0.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/lib/screening/keymap.ts frontend/lib/screening/keymap.test.ts frontend/components/screening frontend/hooks/useListKeyboardShortcuts.ts frontend/hooks/useListKeyboardShortcuts.test.ts frontend/components/layout/ListDetailSplitShell.tsx frontend/components/layout/ListDetailSplitShell.test.tsx
git -C "$WT" commit -m "feat(screening): phase-aware keymap, recorded decision ring and controlled maximize" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Record list (frontend, S1b-3)

**Depends on:** Tasks 3, 4. **Parallel with:** Task 2.

**Files:**
- Create: `frontend/components/screening/RecordStatusChip.tsx`, `ScreeningStatusViews.tsx`, `ScreeningRecordList.tsx`, `ScreeningRecordTable.tsx`
- Create: `frontend/components/screening/__tests__/ScreeningRecordList.test.tsx`
- Modify: `frontend/lib/copy/screening.ts` (add the list and status keys)

**Interfaces:**
- Consumes: Task 4's functions and types; Task 3's `ScreeningRecordRow`, `ScreeningConfigRead`, `useEnrollArticles` (`hooks/screening/useScreeningConfig.ts`); shared list pieces (`ListToolbarSearch`, `FilterButtonWithPopover` + `ListFilterPanel`, `ActiveFilterChips` + `buildActiveFiltersList`, `ListDisplaySortPopover`, `ListCount`, `ResponsiveList`, `ListRowCard`, `useListKeyboardShortcuts`), `useIsNarrow`.
- Produces:

```ts
export function RecordStatusChip({status, arbitrated}: {status: RecordStatus; arbitrated?: boolean}): JSX.Element;
export const RECORD_STATUS_LABEL: Record<RecordStatus, ScreeningCopyKey>; // statusToScreen, statusWaiting, statusInReview, statusConflict, statusIncluded, statusExcluded, statusMaybe, statusNotEnrolled

export interface ScreeningRecordListProps {
  projectId: string;
  read: ScreeningRecordsRead;
  config: ScreeningConfigRead;
  status: StatusView;                       // from ?status=
  onStatusChange: (status: StatusView) => void;
  activeArticleId: string | null;           // selection tint `bg-muted/60 font-medium`
  cursorArticleId: string | null;           // focus ring only (Task 10 moves it)
  onOpenRow: (row: ScreeningRecordRow) => void;
  checkedIds: ReadonlySet<string>;          // article ids
  onCheckedChange: (ids: ReadonlySet<string>) => void;
  onToggleRow: (row: ScreeningRecordRow, event: {shiftKey: boolean}) => void; // Task 10 adds the range
  toolbarActions: ReactNode;                // Task 8 passes Import / Enroll N new / Start screening
  onVisibleRowsChange?: (rows: ScreeningRecordRow[]) => void; // filtered + sorted order, for j/k (Task 10)
  keepArticleIds: ReadonlySet<string>;      // decided this session in the current view (Task 8): passed to filterRecords as `keep`
  onFiltersChange: () => void;              // fired when search or a filter changes: the workspace drops keepArticleIds
}
```

Behaviour (spec §4.2, §4.6 list level):
- Status views: segmented control (same classes as `SectionViewSwitcher`'s tablist, `role="tablist"`, each `role="tab"` "Label N"); a view at 0 stays visible with `text-muted-foreground/60` and lists "No records in this view"; `HIDDEN_AT_ZERO` views are absent at 0.
- Toolbar: `ListToolbarSearch` (`⌘F` via `useListKeyboardShortcuts` — pass `searchInputRef`, filter popover state, `selectAll`/`selectFiltered`, **no `deselectAll`**), filter button + panel with fields Title, Authors, Journal (text), Year (numericRange), My decision (categorical include/exclude/maybe/none; only when `config.can_review`), Exclusion reason (categorical from `read.exclusion_reasons`), Source (categorical from the rows' `ingestion_source` values), `ListDisplaySortPopover` (Queue order default, Title, Year, Status; display toggle for the Reason column, off by default), then `toolbarActions`. `ActiveFilterChips` below.
- Progress strip (`h-7`, one line): "{{x}} of {{n}} decided · you: {{m}} left" — the "you" part only when `config.can_review`; no full-text segment.
- Columns: checkbox · Title · Year (`hidden md:table-cell`) · Journal (`hidden lg:table-cell`) · Mine (only when `config.can_review`) · Status (`RecordStatusChip`, `arbitrated` when `outcome_kind === 'arbitrated'`) · Reason (toggle). Narrow (`useIsNarrow()`) → `ListRowCard` per row (checkbox as `leading`, status chip as `meta`). Row click / card click → `onOpenRow`.
- Bulk bar replaces `ListCount` while `checkedIds.size > 0`: "{{n}} selected", "Enroll selected" (manager; posts `useEnrollArticles` with the checked rows whose status is `not_enrolled`; disabled when none; toasts `enrolledToast`, clears the check set), "Export selected" (downloads `recordsToCsv` of the checked rows as `screening-records.csv` via a `Blob` + object URL).
- Empty filter result: "No records match" + "Clear filters" (clears search and filters).
- Viewer (`isReadOnly(config)`, Task 4): read-only — checkboxes stay for Export selected, but no Enroll selected, no Mine column, no My decision filter; the workspace passes no write `toolbarActions` (Task 8).
- Decided rows stay: rows are filtered with `filterRecords(rows, {search, filters, status, keep: keepArticleIds})`; status counts stay the real `statusCounts(read.rows)`. Any search or filter edit (incl. Clear filters) calls `onFiltersChange` in the same handler (no effect).

Copy keys added (exact text): `statusAll` "All", `statusToScreen` "To screen", `statusWaiting` "Waiting for others", `statusInReview` "In review", `statusIncluded` "Included", `statusExcluded` "Excluded", `statusMaybe` "Maybe", `statusNotEnrolled` "Not enrolled" (`statusConflict` exists), `statusArbitrated` "Arbitrated", `listSearchPlaceholder` "Search records…", `listFilterLabel` "Filter", `filterTitle` "Title", `filterAuthors` "Authors", `filterJournal` "Journal", `filterYear` "Year", `filterMyDecision` "My decision", `filterExclusionReason` "Exclusion reason", `filterSource` "Source", `myDecisionNone` "Not decided", `sortQueue` "Queue order", `sortTitle` "Title", `sortYear` "Year", `sortStatus` "Status", `sortLabel` "Sort and display", `sortOrderLabel` "Order", `displayProperties` "Columns", `columnTitle` "Title", `columnYear` "Year", `columnJournal` "Journal", `columnMine` "Mine", `columnStatus` "Status", `columnReason` "Reason", `listRecordsLabel` "records", `progressDecided` "{{x}} of {{n}} decided", `progressYouLeft` "you: {{m}} left", `emptyView` "No records in this view", `noRecordsMatch` "No records match", `clearFilters` "Clear filters", `selectedCount` "{{n}} selected", `enrollSelected` "Enroll selected", `exportSelected` "Export selected", `selectRecord` "Select {{title}}", `removeFilterAria` "Remove filter {{label}}".

- [ ] **Step 1: Write the failing tests** in `ScreeningRecordList.test.tsx` (render with a fixture `read` of 9 rows = Task 4's `COUNTS_FIXTURE` shape, MSW for enroll, `vi.mock('@/lib/copy', …)` not used — assert real English):
  - `shows each status view with its count and hides Conflict and Not enrolled at 0` (and a zero "Maybe" tab is present with muted class).
  - `lists "No records in this view" for a view with 0`.
  - `searches title, author, journal, PMID and DOI`; one `it` per filter field (`filters by year range`, `filters by my decision incl. not decided`, `filters by exclusion reason on mine or the outcome`, `filters by source`, `filters by title`, `filters by authors`, `filters by journal`).
  - `sorts by queue order by default, then title, year and status`.
  - `hides the Mine column and the My decision filter for non-reviewers`.
  - `a viewer gets no write controls` (config all role flags false, two rows checked: "Export selected" present, "Enroll selected" absent, no Mine column header, no "My decision" filter field, no checkbox column write besides Export).
  - `keeps a kept article in the To screen view and calls onFiltersChange on a search edit` (status `to_screen`, `keepArticleIds` = an `included` row's id → that row is listed with the "Included" chip; the To screen tab count is unchanged; typing in search calls `onFiltersChange` once).
  - `shows "X of N decided · you: M left" and no full-text segment` (fixture → "3 of 7 decided · you: 2 left").
  - `tints the active row and opens a row on click` (`onOpenRow` called with that row).
  - `Enroll selected posts only the checked not-enrolled ids (manager only)` (MSW captures body `{article_ids:[…2 ids]}`; absent for a reviewer).
  - `Export selected downloads CSV with the row fields and no abstract` (stub `URL.createObjectURL`; read the `Blob` text: header == `RECORD_CSV_COLUMNS.join(',')`, 2 data lines).
  - `shows "No records match" and clears filters`.
  - `renders cards below sm` (`window.matchMedia` narrow → `ListRowCard` buttons named by title).

Run: `npm run test:run -- frontend/components/screening/__tests__/ScreeningRecordList.test.tsx`
Expected: FAIL — unresolved imports.

- [ ] **Step 2: Implement** the four components (each ≤ 300 lines; `ScreeningRecordList` owns search/filter/sort UI state, `ScreeningRecordTable` the rows) and the copy keys.

- [ ] **Step 3: Run to verify it passes**, then `npm run typecheck && npx eslint frontend/components/screening` and from `$WT/backend` `uv run --frozen python ../scripts/fitness/check_button_scale.py` and `… check_file_size.py`
Expected: PASS, exit 0. (No production consumer until Task 8.)

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/components/screening frontend/lib/copy/screening.ts
git -C "$WT" commit -m "feat(screening): add the title/abstract record list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Record panel (frontend, S1c)

**Depends on:** Tasks 3, 5, 6. **Parallel with:** Task 2.

**Files:**
- Create: `frontend/components/screening/ScreeningRecordPanel.tsx`, `ConflictRulingForm.tsx`
- Modify: `frontend/components/screening/AssignmentView.tsx` (becomes the assignment-backed panel body), `ScreeningParts.tsx` (`ScreeningArticle` = `ScreeningAssignmentRead['article']`)
- Modify: `frontend/lib/copy/screening.ts`
- Create: `frontend/components/screening/__tests__/ScreeningRecordPanel.test.tsx`, `ConflictRulingForm.test.tsx`; Modify: `AssignmentView.test.tsx` (`:69-93` back-button cases removed; statuses asserted with §4.3 labels)

**Interfaces:**
- Consumes: `useScreeningAssignment`, `useDecide`/`useArbitrate` (Task 3), `useEnrollArticles`, `DecisionButtons` (`phase`, `recorded`, Task 5), `RecordStatusChip` + `RECORD_STATUS_LABEL` (Task 6), `isReadOnly` (Task 4). The status shown is always the server's `row.status` (Task 1 `record_status`); the client never re-derives it.
- Produces:

```ts
export interface ScreeningRecordPanelProps {
  projectId: string;
  row: ScreeningRecordRow | null;            // null → placeholder "Select a record"
  config: ScreeningConfigRead;               // can_review / can_manage / reviewer_count
  /** After a successful decision (auto-advance + announcement live in Task 10). */
  onDecided: (row: ScreeningRecordRow) => void;
  /** 403/404 on the assignment read, or 404 from decide/arbitrate: the caller clears ?article= and toasts. */
  onNotInPhase: () => void;
}
export interface ConflictRulingFormProps {
  read: ScreeningAssignmentRead;             // peer_decisions in server order → "Reviewer A/B/C"
  busy: boolean;
  onRule: (body: ScreeningArbitrationCreate) => void;
}
// AssignmentView({assignmentId, row, config, onDecided, onNotInPhase}) — no onBack, no back button.
```

Panel states (spec §4.4, §4.6 panel list) — `ScreeningRecordPanel` switches on `row.status === 'not_enrolled'` (`NotEnrolledBody`: title, first author · journal · year, PMID/DOI; "Enroll" for `can_manage` posting `{article_ids:[row.article_id]}`; others metadata only), else renders `AssignmentView`, which reads the assignment and picks:
- loading → `LoadingState` (skeleton body); error 403/404 → `onNotInPhase()`; other error → `ErrorState` with retry inside the panel.
- `status === 'awaiting_me'` and `can_review` → `RecordBody` + `DecisionButtons` pinned bottom (`key` = assignment id).
- `status === 'conflict'` → `RecordBody` + `ConflictRulingForm` (adopt "Use Reviewer A's decision" / override with "Decide differently" + note; rows labelled "Reviewer A/B/C", never names; the ruling form only).
- solo re-decide: `config.reviewer_count === 1` and `read.my_decision` and `read.outcome?.kind === 'solo'` → `RecordBody` + `DecisionButtons recorded={read.my_decision.decision}`; success toasts "Changed to {{decision}}" (`decisionLabel`).
- otherwise → the read-only details (today's `AssignmentDetails`: your decision, outcome, peers **with names** as the server returns them), status chip from `row.status`.
- Decide/arbitrate in flight: buttons `disabled`, a `useRef` in-flight flag (today's pattern) ignores further keys/clicks until settled; error → `toast.error(screeningErrorMessage(e))` (the hooks' `onSettled` already refetches project + assignment); `ApiError` 404 → `onNotInPhase()` instead.

Copy keys: add `panelPlaceholderTitle` "Select a record", `panelPlaceholderBody` "Pick a row to screen it here.", `panelToggle` "Toggle record panel", `notInPhase` "This article is not in this phase", `changedTo` "Changed to {{decision}}", `reviewerLetter` "Reviewer {{letter}}", `enrollOne` "Enroll", `enrollManagerOnly` "A manager enrolls articles"; delete the keys whose last consumer this task removes (`backToQueue`, `statusAwaitingMe`, `statusAwaitingOthers`, `statusDecided` — confirm with `check_copy_keys.py`, which reports any still referenced by `ScreeningQueue`/`ConflictsPanel`; those wait for Task 9).

- [ ] **Step 1: Write the failing tests**
  - `ScreeningRecordPanel.test.tsx` (MSW `GET */screening/assignments/:id`, `POST …/decisions`, `POST …/arbitration`, `POST …/enroll`): `shows a skeleton while the assignment loads`; `shows an error with retry inside the panel`; `calls onNotInPhase on a 404 assignment read` (and on 403); `decides on a To screen record and calls onDecided`; `posts once for two fast key presses` (fire `1` twice before the response resolves → one POST); `maps a 404 from decide to the not-in-phase callback`; `toasts the mapped 409, keeps the panel and refetches` (spy `vi.spyOn(queryClient, 'invalidateQueries')`: after the 409 settles it was called with `{queryKey: ['screening','project',projectId]}` and `{queryKey: ['screening','assignment',assignmentId]}` — the hooks' `onSettled`, which Task 9's rewrite must keep); `solo: shows the recorded ring and re-decides with "Changed to Exclude"`; `waiting / in review / decided are read-only and show reviewer names`; `not enrolled: a manager enrolls that id` (body `{article_ids:['art9']}`) and `not enrolled: a reviewer sees metadata only`; `a viewer never sees decision buttons`; `shows the placeholder with no row`.
  - `ConflictRulingForm.test.tsx` (port the cases of `ConflictsPanel.test.tsx` onto the retyped form): `labels reviewers A and B, never by name` (`queryByText('Reviewer B Name')` null); `adopts a reviewer's decision with every decision id ruled on`; `overrides with a reason and a trimmed note`; `disables while busy`.

Run: `npm run test:run -- frontend/components/screening/__tests__/ScreeningRecordPanel.test.tsx frontend/components/screening/__tests__/ConflictRulingForm.test.tsx frontend/components/screening/__tests__/AssignmentView.test.tsx`
Expected: FAIL — unresolved imports; `AssignmentView` still renders the back button.

- [ ] **Step 2: Implement** the panel, the form (extracted from `ConflictCard`, `ConflictsPanel.tsx:45-131`, retyped on `ScreeningAssignmentRead`; `ConflictsPanel.tsx` itself stays until Task 9 removes its last consumer), the `AssignmentView` rework (delete the back button `:113-118`, `onBack`, `STATUS_LABEL`), `ScreeningParts` retype, copy keys.

- [ ] **Step 3: Run to verify it passes**, then `npm run test:run -- frontend/components/screening && npm run typecheck && npx eslint frontend/components/screening` and `… check_copy_keys.py`, `… check_button_scale.py`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/components/screening frontend/lib/copy/screening.ts
git -C "$WT" commit -m "feat(screening): add the record panel with in-panel conflict ruling" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Title/abstract workspace (frontend, S1b-4)

**Depends on:** Tasks 5, 6, 7. **Parallel with:** Task 2.

**Files:**
- Create: `frontend/components/screening/TitleAbstractWorkspace.tsx`, `frontend/components/screening/ScreeningToolbarActions.tsx`
- Modify: `frontend/components/screening/ScreeningHeader.tsx` (delete `EnrollAllButton` and `PubMedImportButton`, import them from the new file; the header itself goes in Task 9), `frontend/components/screening/ScreeningTab.tsx` (import path of `EnrollAllButton` only)
- Modify: `frontend/lib/copy/screening.ts`
- Create: `frontend/components/screening/__tests__/TitleAbstractWorkspace.test.tsx`

**Interfaces:**
- Consumes: `ListDetailSplitShell` (`maximizable`, `escapeCloses`, controlled `maximized`/`onMaximizedChange`, `hasSelection`/`onClearSelection`, `checkedCount`/`onClearChecked`), `useScreeningRecords`, `ScreeningRecordList`, `ScreeningRecordPanel`, Task 4 functions.
- Produces:

```ts
export function TitleAbstractWorkspace({projectId, config}: {projectId: string; config: ScreeningConfigRead}): JSX.Element;
// ScreeningToolbarActions.tsx
export function EnrollAllButton(props: EnrollAllButtonProps): JSX.Element;   // moved verbatim
export function PubMedImportButton(props: {projectId: string; canManage: boolean; className?: string}): JSX.Element; // moved, now exported
export function StartScreeningButton({disabled, onStart}: {disabled?: boolean; onStart: () => void}): JSX.Element;
```

Workspace rules:
- State: `?article=` (selection; written with `replace`), `?status=` (absent → `defaultStatusView`), `panelOpen` (local; true when a selection exists on mount), `maximized` (controlled for the shell; reset in its own close handler), `checkedIds` (local), `cursorArticleId` (local, = selection when the panel is open), `keepArticleIds` (local `Set`, session-sticky: never persisted, so a reload clears it).
- Decided rows stay in the current view (spec §2 goal 1, §4.4): the panel's `onDecided(row)` adds `row.article_id` to `keepArticleIds`; the workspace's `onStatusChange` handler and the list's `onFiltersChange` empty it. So after the refetch the decided row keeps its place with its new chip until the user changes view, search or filter, or reloads.
- Shell: `idPrefix="screening-shell"`, `toggleLabel={t('screening','panelToggle')}`, `maximizable`, `escapeCloses`, `hasSelection={Boolean(articleId)}`, `onClearSelection` deletes `?article=` (replace), `checkedCount={checkedIds.size}`, `onClearChecked` empties it.
- Records read only when `config.reviewer_count !== null` (`enabled`). List-level states: pending → skeleton rows (`Skeleton` ×6, `HITLArticleTable` pattern, `aria-busy`); error → `ErrorState` with retry; 0 rows → `EmptyListState` "No articles yet" / "Import articles to start screening." with the toolbar still rendered; `config.enrolled === 0` and rows > 0 → the Not enrolled rows plus a call-to-action strip above the list: manager `EnrollAllButton` "Enroll all articles" (existing `enrollAll` key), member "A manager enrolls articles".
- Toolbar actions (the toolbar always renders, every state): `PubMedImportButton` (every member except a viewer — `!isReadOnly(config)`; a viewer sees no toolbar write), "Enroll {{n}} new" (`can_manage && enrolled > 0 && not_enrolled > 0`, existing `enrollNew`, `n = config.not_enrolled`; an `EnrollAllButton` with that label, as `ScreeningHeader.tsx:100-105` does today — empty body enrolls every not-yet-enrolled article), `StartScreeningButton` "Start screening" (primary, only when `progress(rows).myLeft > 0`): selects `nextToScreen(rows, null)`, opens the panel and sets `maximized=true` in the same update.
- Selection miss: `?article=` not among the rows once the read has data (initial or after a refetch) → delete the param (replace) + `toast(t('screening','notInPhase'))`; the same handler is the panel's `onNotInPhase`. No request is made for a client miss.
- Strip a legacy `?assignment=` param on mount (replace), open nothing.
- Panel close (any path) → `setMaximized(false)`.

Copy keys: `startScreening` "Start screening", `noArticlesTitle` "No articles yet", `noArticlesBody` "Import articles to start screening.", `importOpen` stays. Delete `summaryEnrolled`, `summaryNotEnrolled`, `summaryReviewerOne`, `summaryReviewers` only in Task 9 (the header still uses them).

- [ ] **Step 1: Write the failing tests** in `TitleAbstractWorkspace.test.tsx` (wrap in `HeaderActionsProvider` + `MemoryRouter` + fresh `QueryClient`, as `ArticlesSplitShell.test.tsx` does; MSW for records, assignment, decisions, enroll):
  - `shows skeleton rows while the records load`; `shows an error with retry`; `shows "No articles yet" with the import button for a project with no articles`; `shows Not enrolled rows and "Enroll all articles" for a manager when nothing is enrolled`; `tells a member that a manager enrolls articles`; `renders Import from PubMed for every non-viewer member in every state` (parametrized over the four states above + running, as reviewer and as manager).
  - `a viewer sees no toolbar writes` (all role flags false, parametrized over nothing enrolled and running: no "Import from PubMed", "Enroll all articles", "Enroll N new" or "Start screening" button; the rows still render).
  - `shows "Enroll N new" only to a manager with enrolled and new articles` (manager, `enrolled: 7, not_enrolled: 2` → "Enroll 2 new"; clicking it posts `POST …/screening/enroll` with an empty body (MSW captures it) and toasts; absent for a reviewer with the same counts; absent for a manager with `not_enrolled: 0`; absent with `enrolled: 0`, where "Enroll all articles" shows instead).
  - `defaults the status view by role` (manager → All tab selected; reviewer → To screen; consensus with a conflict → Conflict; consensus without → To screen; viewer → All).
  - `keeps a decided row in the To screen view until the view or a filter changes` (reviewer on To screen decides row A; the records refetch returns A as `included` → A is still listed with the "Included" chip; clicking the All tab then To screen again → A is gone; same after a search edit; a fresh mount with the same data does not list it).
  - `opens a row in the panel and writes ?article=` (location search via a `useLocation` probe).
  - `Start screening selects the first To screen in queue order and maximizes` (`[data-maximized="true"]` present, panel shows that title); `hides Start screening when nothing is left for me`.
  - `strips ?assignment= and opens nothing`.
  - `clears a selection that is not a row and toasts` (initial `?article=missing`; no assignment request is made); `clears a selection that drops out after a refetch` (second records response without it).
  - `Escape restores, then closes, then clears the selection, then the checked rows` (list hook mounted; one step per press).

Run: `npm run test:run -- frontend/components/screening/__tests__/TitleAbstractWorkspace.test.tsx`
Expected: FAIL — unresolved import.

- [ ] **Step 2: Implement** the workspace and `ScreeningToolbarActions.tsx` (move the two buttons out of `ScreeningHeader.tsx` in the same edit; `ScreeningHeader`/`ScreeningTab` import them from there), copy keys.

- [ ] **Step 3: Run to verify it passes**, then `npm run test:run -- frontend/components/screening && npm run typecheck && npx eslint frontend/components/screening`
Expected: PASS, exit 0. (The workspace is wired into the tab in Task 9.)

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add frontend/components/screening frontend/lib/copy/screening.ts
git -C "$WT" commit -m "feat(screening): add the title/abstract list + panel workspace" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Screening tab, switcher, Settings sub-view, and the deletions they enable (frontend, S1b-5)

**Depends on:** Task 8. **Parallel with:** Task 2.

**Files:**
- Rewrite: `frontend/components/screening/ScreeningTab.tsx`, `frontend/components/screening/__tests__/ScreeningTab.test.tsx`
- Create: `frontend/components/screening/ScreeningSettings.tsx`, `frontend/components/screening/__tests__/ScreeningSettings.test.tsx`
- Modify: `frontend/components/layout/sectionViews.ts`, `frontend/components/navigation/SectionViewSwitcher.tsx` (`:20` widen `hasViews`, `:37-40` aria), `frontend/components/navigation/SectionViewSwitcher.test.tsx`, `frontend/lib/copy/navigation.ts` (`viewsScreeningAria` "Screening views"), `frontend/lib/copy/screening.ts`
- Modify: `frontend/hooks/screening/useScreeningMutations.ts` (drop `useDecide`'s optimistic update on `screeningKeys.queue`, `onMutate`/`onError` and the context type; keep `onSettled`), `frontend/lib/query-keys/screening.ts` (remove `queue`, `conflicts`), `frontend/services/screeningService.ts` (remove `fetchScreeningQueue` `:102`, `fetchConflicts` `:133`, aliases `ScreeningQueueRead` `:19`, `ScreeningConflictsRead` `:22`)
- Delete: `frontend/components/screening/ScreeningQueue.tsx`, `ScreeningHeader.tsx`, `ConflictsPanel.tsx`, `ScreeningConfigForm.tsx`, `frontend/hooks/screening/useScreeningQueue.ts`, `useScreeningConflicts.ts`, `frontend/components/screening/__tests__/ScreeningQueue.test.tsx`, `ConflictsPanel.test.tsx` (their cases were ported in Tasks 7–8 and here), `frontend/hooks/screening/__tests__/useScreeningQueue.test.tsx` → rewritten as `useScreeningMutations.test.tsx`
- Modify: `frontend/hooks/screening/__tests__/screeningQueries.remount.test.tsx` (drop the queue/conflicts mocks `:15-24` and imports `:31,:33`)

**Interfaces:**
- Consumes: `TitleAbstractWorkspace`, `PubMedImportButton` (Task 8), `isReadOnly` (Task 4), `useScreeningConfig`, `useSetScreeningConfig`, `SettingsPage`/`SettingsGroup`/`SettingsRow` (`frontend/components/settings`), `FieldHint` (`components/patterns/FieldHint`).
- Produces: `sectionViews.screening = [{value: 'title_abstract', label: t('screening','tabTitleAbstract'), urlParam: 'screeningTab'}, {value: 'settings', label: t('screening','tabSettings'), urlParam: 'screeningTab', managerOnly: true}]` (no `sectionDescriptionKey`; `defaultValue` and Duplicates are S2). `ScreeningTab({projectId})`. `ScreeningSettings({projectId, config})`.

`ScreeningTab` rules (§4, §4.6):
- Config pending → `LoadingState`; error → `ErrorState` with retry. **No redirect and no first-run landing until the config query has succeeded.**
- Once loaded: `screeningTab=settings` and `!can_manage` → `setSearchParams` with `screeningTab=title_abstract` (replace, no toast). No `screeningTab` param, `reviewer_count === null`, `can_manage` → `screeningTab=settings` (replace; first run).
- `title_abstract` (default) and `reviewer_count === null` → the toolbar row first (the toolbar always renders, spec §4: `PubMedImportButton` from `ScreeningToolbarActions.tsx` when `!isReadOnly(config)`, nothing for a viewer), then `Notice`: manager "Screening is not set up" + a link button "Open Settings" (sets `screeningTab=settings`); member: existing `notConfiguredTitle` / `notConfiguredMember`.
- Otherwise `title_abstract` → `TitleAbstractWorkspace`; `settings` → `ScreeningSettings`.
- `?assignment=` is stripped by the workspace (Task 8).

`ScreeningSettings` (§6.2 TA part, `SettingsPage` `max-w-3xl`): group "Reviewers per article — title/abstract": the 1–3 radio (logic moved from `ScreeningConfigForm`, options above `reviewer_capable` disabled with today's hint), disabled with `FieldHint` "Locked after the first title/abstract decision" when `reviewer_count_locked`; Save disabled while pending; success toast `configSavedToast`; 409 `SCREENING_CONFIG_FROZEN` → `toast.error(screeningErrorMessage)` + `queryClient.invalidateQueries({queryKey: screeningKeys.project(projectId)})` (TanStack v5 filters object, the house pattern of `useScreeningConfig.ts:46,60`; the project prefix also refreshes the records read); 403 → `ErrorState` "Only project managers can do this". Group "Exclusion reasons": read-only list of `config.exclusion_reasons` (empty → "The protocol lists no exclusion reasons") + link "Edit in protocol" to `?tab=settings&section=review-question`.

Copy keys: add `tabTitleAbstract` "Title/abstract", `tabSettings` "Settings", `notConfiguredManagerTitle` "Screening is not set up", `openSettings` "Open Settings", `settingsReviewersTitle` "Reviewers per article — title/abstract", `settingsReviewersLocked` "Locked after the first title/abstract decision", `settingsReasonsTitle` "Exclusion reasons", `settingsReasonsEmpty` "The protocol lists no exclusion reasons", `editInProtocol` "Edit in protocol", `managerOnlyError` "Only project managers can do this". Delete every key whose last consumer this task removes (`tabQueue`, `tabConflictsCount`, `summaryEnrolled`, `summaryNotEnrolled`, `summaryReviewerOne`, `summaryReviewers`, `remainingForYou`, `waitingTitle`, `waitingBody`, `doneTitle`, `doneBody`, `conflictsEmptyTitle`, `conflictsEmptyBody`, `unnamedReviewer`, `configureTitle`/`configureDescription` if unused, `viewerNotice`, `nothingEnrolledTitle`/`nothingEnrolledManager`/`nothingEnrolledMember`/`nothingToEnroll` if unused, …): `check_copy_keys.py` lists them; keep `nextRecordAnnouncement` (Task 10).

- [ ] **Step 1: Write the failing tests**
  - `SectionViewSwitcher.test.tsx`: `renders Title/abstract and Settings for a screening manager`, `hides Settings for a screening member`, `labels the screening views "Screening views"`.
  - `ScreeningTab.test.tsx` (rewrite; MSW config + records): `shows the loading state while the config loads`; `never redirects while the config read is pending` (manager deep link `?screeningTab=settings` with a never-resolving config → URL unchanged); `redirects a member deep-linked to settings only after the config resolves` (→ `screeningTab=title_abstract`, no toast); `never bounces a manager's settings deep link`; `lands a manager with no config on Settings`; `shows "not set up" with Open Settings to a manager on Title/abstract`; `shows the member "not set up" notice`; `shows the config error with retry`; `never redirects or lands on Settings after the config read errors` (config → 500: a member deep link `?screeningTab=settings` keeps its URL, and a manager with no `screeningTab` keeps none — read through a `useLocation` probe after the ErrorState shows); `shows the toolbar with Import from PubMed above the "not set up" notice` (reviewer and manager: button present above the Notice; viewer: absent); `renders the workspace once configured`; `ignores and strips ?assignment=` (rewritten from `:395`).
  - `ScreeningSettings.test.tsx`: `saves the reviewer count`; `disables the count with the lock hint once locked`; `disables the controls while saving`; `toasts and refetches the config on 409 SCREENING_CONFIG_FROZEN` (spy `invalidateQueries` called with `{queryKey: ['screening','project',projectId]}`); `lists the protocol's exclusion reasons with Edit in protocol` (href contains `tab=settings&section=review-question`); `says when the protocol lists none`; `shows "Only project managers can do this" on 403`.
  - `useScreeningMutations.test.tsx`: `refetches the screening family and the record after a decision` (ported from `useScreeningQueue.test.tsx:99`), `after a ruling`; `lives under the family a PubMed import refreshes` (`:119`); no optimistic case.

Run: `npm run test:run -- frontend/components/navigation frontend/components/screening frontend/hooks/screening`
Expected: FAIL on the new cases.

- [ ] **Step 2: Implement** the tab, Settings, switcher entry; then delete every file listed under Delete plus the service functions, aliases and keys, and the optimistic block, in this same task.

- [ ] **Step 3: Run to verify it passes, then the full static set**

Run: `npm run test:run -- frontend/components frontend/hooks frontend/lib frontend/test && npm run typecheck && npm run lint && npm run deadcode && npm run deadcode:production`, and from `$WT/backend`: `uv run --frozen python ../scripts/fitness/check_copy_keys.py`, `… check_react_query_keys.py`, `… check_frontend_data_path.py`, `… check_file_size.py`, `… check_button_scale.py`
Expected: all PASS / exit 0; knip zero in both modes; `grep -rn "fetchScreeningQueue\|fetchConflicts\|useScreeningQueue\|useScreeningConflicts\|ScreeningQueueRead\|ScreeningConflictsRead" "$WT/frontend" --include='*.ts' --include='*.tsx' | grep -v types/api` prints nothing.

- [ ] **Step 4: Commit**

```bash
git -C "$WT" add -A frontend
git -C "$WT" commit -m "feat(screening): title/abstract and settings sub-views replace the queue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Keyboard integration, auto-advance, prefetch, E2E rewrite, 5,000-row check (frontend, S1d-2)

**Depends on:** Task 9. **Parallel with:** Task 11 (Task 10 must not touch `frontend/types/api/*` or any backend file).

**Files:**
- Modify: `frontend/components/screening/TitleAbstractWorkspace.tsx`, `ScreeningRecordList.tsx`, `ScreeningRecordTable.tsx`, `frontend/hooks/screening/useScreeningAssignment.ts` (export `assignmentQueryOptions(assignmentId: string)` used by the hook and by prefetch)
- Modify: `frontend/components/screening/__tests__/TitleAbstractWorkspace.test.tsx`; Create: `frontend/components/screening/__tests__/ScreeningRecordList.scale.test.tsx`
- Rewrite: `frontend/e2e/flows/screening.ui.e2e.ts`

**Interfaces:**
- Consumes: `useKeyboardShortcuts` (bare chords: `j`, `k`, `ArrowDown`, `ArrowUp`, `Enter`, `x`), `nextToScreen`, `onVisibleRowsChange`, `onToggleRow`.
- Produces: no new exports beyond `assignmentQueryOptions`.

Rules (§4.4, §4.5): j/k/↓/↑ move `cursorArticleId` through the visible order; with the panel open the selection follows (`?article=` replace), closed it moves only the cursor; Enter selects the cursor row and opens the panel; `x` toggles the cursor row's check; ⇧-click on a checkbox selects the range from the last toggled row to this one in visible order; ⌘A stays the list hook's. Moving the cursor writes nothing to the server. After `onDecided`: select `nextToScreen(rows, decided.article_id)` (queue order; the decided row stays listed with its new chip after the refetch through Task 8's `keepArticleIds`), set the `role="status"` live region to `nextRecordAnnouncement` with the next title, and `queryClient.prefetchQuery(assignmentQueryOptions(id))` for the next two To screen rows after it. No next row → panel stays on the decided record.

- [ ] **Step 1: Write the failing tests** (in `TitleAbstractWorkspace.test.tsx`)
  - `j and k move the cursor; the panel follows when open`; `arrow keys move the cursor too`; `Enter opens the cursor row`; `keys are inert in a text field` (focus search, press `j` → no move); `keys are inert under a dialog` (open the PubMed import dialog, press `j`/`1` → nothing).
  - `x toggles the cursor row`; `shift-click selects a range`.
  - `auto-advances to the next To screen in queue order after a decision` (and, after the records refetch, the decided row is still listed in the To screen view with its new chip) and `announces the next record`; `prefetches the next two assignments` (MSW counts GETs for those two ids before they are opened).
  - `Esc order: popover, maximize, panel, selection, checked rows — one step per press` (filter popover open first; screening passes no `deselectAll`); `Esc in the search field clears nothing`.
  - `ScreeningRecordList.scale.test.tsx`: `renders 5,000 rows, switches a status view and re-renders after a refetch` — synthetic rows; `performance.now()` around (a) mount, (b) a status-tab click until its rows render, (c) a `rerender` with a new `read`; `console.info` the three numbers (the PR records them). Budget: `const budget = process.env.CI ? 2000 : 200` — strict 200 ms locally; under `CI` only a generous 2,000 ms ceiling, so a slow shared runner does not flake the required suite while a gross regression still fails.

Run: `npm run test:run -- frontend/components/screening/__tests__/TitleAbstractWorkspace.test.tsx frontend/components/screening/__tests__/ScreeningRecordList.scale.test.tsx`
Expected: FAIL on the keyboard/advance cases; the scale test prints its numbers.

- [ ] **Step 2: Implement** the bindings, cursor, range selection, auto-advance, announcement and prefetch.

- [ ] **Step 3: The 5,000-row decision point** (local numbers, `CI` unset). If any scale number is ≥ 200 ms in Vitest, **stop and report the three numbers to the controller** with the same three measured in real Chromium (a throwaway Playwright spec that fulfils the config/records routes with 5,000 rows via `page.route`, logged in with `loginViaUi`; delete it after). The controller rules between adding row windowing in this task and recording the number as the known limit (spec §4.6, Open question 3). Do not add windowing unasked.

- [ ] **Step 4: Rewrite the E2E** `screening.ui.e2e.ts` (same project and fixtures; keep the reset test, updating `imported_not_enrolled` only if PRISMA changed — it does not in S1): owner lands on Settings (first run), checks "2 reviewers", saves, opens Title/abstract, clicks "Enroll all articles", sees the "To screen"/"All" tab with "2"; reviewer B clicks "Start screening", presses `1`, sees the next record, presses `1`, sees "you: 0 left"; reviewer C decides by API, finding assignment ids through `GET /projects/{id}/screening/records?phase=title_abstract` (rows' `article_id` → `assignment_id`) — include Alpha, exclude Beta; owner reloads, opens the "Conflict 1" tab, opens Beta, clicks "Use Reviewer B's decision" (B = reviewer C, the second decision in server order), sees Beta's chip "Excluded"; PRISMA rows as today.

Run (only if the local stack is up — coordinate, it is shared): `npx playwright test frontend/e2e/flows/screening.ui.e2e.ts --project=local-ui`
Expected: 2 passed. If the stack is down, say so in the task report; CI's Frontend E2E runs it.

- [ ] **Step 5: Run the screening suites**, `npm run typecheck`, `npx eslint frontend/components/screening frontend/hooks/screening frontend/e2e/flows/screening.ui.e2e.ts`, `npm run deadcode`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git -C "$WT" add frontend/components/screening frontend/hooks/screening frontend/e2e/flows/screening.ui.e2e.ts
git -C "$WT" commit -m "feat(screening): keyboard triage, auto-advance and the list-first E2E" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Retire `/screening/queue` and `/screening/conflicts` (backend + gate, S1a-3)

**Depends on:** Task 2 (same service/endpoint files), Task 9 (no frontend consumer left; regenerated types must not break `tsc`). **Parallel with:** Task 10.

**Files:**
- Modify: `backend/app/api/v1/endpoints/screening.py` (delete `get_screening_queue` `:107-123`, `get_screening_conflicts` `:183-196`, their schema imports; module docstring), `backend/app/services/screening_review_service.py` (delete `queue` `:192-221`, `conflicts` `:266-305`; drop now-unused imports — `reveals_peers` stays for `_read`), `backend/app/repositories/screening_repository.py` (delete `_awaiting` `:188-204`, `queue_page` `:206-217`, `count_awaiting_me` `:219-229`; `assignments_with_articles` stays), `backend/app/schemas/screening.py` (delete `ScreeningQueueItem`, `ScreeningQueueRead`, `ScreeningConflictItem`, `ScreeningConflictsRead`)
- Modify: `backend/tests/unit/test_screening_review_unit.py` (`:25,34,65-66,128-137`; drop `queue_page`, `count_awaiting_me` from the parametrize `:110-111`), `backend/tests/unit/test_screening_arbitration_unit.py` (`:23,34,60-61,136-147`)
- Modify (migrate to the records read, never delete coverage): `backend/tests/integration/test_screening_review.py` (`:44-45` path, `:243-246`, `:306-308`, `test_moved_article_leaves_the_queue_and_404s` `:322`, `test_queue_contents_and_order` `:367`, `test_queue_requires_reviewer_role` `:403`), `backend/tests/integration/test_screening_arbitration.py` (`:42-61`, `:127-172`, `:197`, `:332-339`)
- Modify: `scripts/fitness/check_retired_symbols.py` (`RETIRED`)
- Regenerate: `frontend/types/api/openapi.json`, `schema.d.ts`

Test migration map (assertions keep their intent):
- conflicts listed for arbitrators → records read: those rows have `status == "conflict"` for MANAGER and consensus, `waiting`/`in_review` for reviewers, never `conflict`; the old 403 for reviewer/viewer becomes "the read never says conflict to them".
- unconfigured queue 409 → records 409 (already in Task 1; the `:306` lines just go).
- moved article leaves the queue → leaves the records rows (`awaiting_me` count → `to_screen` count drops by one).
- queue contents and order → records order of the enrolled rows (md5 within enrollment) and statuses after decisions (`one` waiting for a, `two` included, `three` included by ruling); `exclusion_reasons == REASONS`.
- queue requires reviewer role → a viewer reads records (200) with no `to_screen` row.
- seated arbitrator cannot see their own conflict → their row is `waiting`, an unseated arbitrator's is `conflict`.

`RETIRED` additions (word symbols; matcher `\b<sym>\b`, `check_retired_symbols.py:399`), one `Retired(symbol, "screening workspace S1", why)` each: `fetchScreeningQueue`, `fetchConflicts`, `get_screening_queue`, `get_screening_conflicts`, `count_awaiting_me`, `queue_page`, `ScreeningQueueItem`, `ScreeningConflictItem`, `ScreeningQueueRead`, `ScreeningConflictsRead` — why: "the queue/conflicts reads were replaced by GET /screening/records".

- [ ] **Step 1: Make the retirement fail first** — add the `RETIRED` entries.

Run: `cd "$WT/backend" && uv run --frozen python ../scripts/fitness/check_retired_symbols.py`
Expected: exit 1, findings in `endpoints/screening.py`, `screening_review_service.py`, `screening_repository.py`, `schemas/screening.py` and the backend tests (none in `frontend/` other than the excluded `frontend/types/api/`).

- [ ] **Step 2: Migrate the integration tests** per the map (they now call only the records read).

Run: `cd "$WT/backend" && uv run pytest tests/integration/test_screening_review.py tests/integration/test_screening_arbitration.py -q`
Expected: PASS (the read exists since Task 1).

- [ ] **Step 3: Delete** the endpoints, service methods, repository methods, schemas and the unit-test cases that only exercised them.

- [ ] **Step 4: Verify**

Run: `cd "$WT" && npm run generate:api-types && npm run typecheck`; `make -C "$WT" test-backend` (screening + PRISMA files at least: `cd "$WT/backend" && uv run pytest tests/unit tests/integration/test_screening_*.py tests/integration/test_prisma_counts.py -q`); from `$WT/backend`: `check_retired_symbols.py`, `check_scope_guards.py`, `check_api_response_envelope.py`, vulture; `make -C "$WT" lint-backend`
Expected: all exit 0; `grep -c '"/api/v1/projects/{project_id}/screening/queue"' "$WT/frontend/types/api/openapi.json"` → 0; vulture reports no new finding (nothing to tighten: the baseline held none of these).

- [ ] **Step 5: Commit**

```bash
git -C "$WT" add backend scripts/fitness/check_retired_symbols.py frontend/types/api
git -C "$WT" commit -m "refactor(screening): retire the queue and conflicts reads" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Slice verification and design review

**Depends on:** Tasks 1–11. **Files:** none modified; a fix found here goes back to the owning task's files with its own commit. Throwaway (never committed): `frontend/e2e/flows/__design_review_screening.ui.e2e.ts`, screenshots in the session scratchpad.

- [ ] **Step 1: Full test runs**

Run: `npm run test:run` and `make -C "$WT" test-backend`
Expected: frontend `0 failed`; backend summary line `N passed`, no `FAILED`/`ERROR`, skips ≤ 25.

- [ ] **Step 2: Every S1 gate** (spec §9 "Gates per slice"; expected exit 0 each)
- `npm run typecheck` · `npm run lint`
- `npm run deadcode` and `npm run deadcode:production` — zero findings
- from `$WT/backend`: `uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`
- from `$WT/backend`, `uv run --frozen python ../scripts/fitness/<x>.py` for `check_copy_keys.py`, `check_react_query_keys.py`, `check_file_size.py`, `check_retired_symbols.py`, `check_scope_guards.py`, `check_button_scale.py`, `check_api_response_envelope.py`, `check_frontend_data_path.py`, `check_layered_arch.py`
- `make -C "$WT" lint-backend`
- `cd "$WT" && npm run generate:api-types && git -C "$WT" diff --exit-code frontend/types/api` (the CI api-contract check)
- `cd "$WT/backend" && uv run alembic check` against the test DB → "No new upgrade operations detected" (proves S1 needed no migration)

- [ ] **Step 3: Design review (`/design-review`) of the TA list and panel**

Setup: confirm the local stack and that `:8080` is this tree's server (design-review skill § Render); `make -C "$WT" db-seed-screening` with `--manager-email` set to the E2E default user (`frontend/e2e/_fixtures/fixture-ids.ts`), which needs two other local profiles. Write the throwaway spec: `loginViaUi(page)` (`frontend/e2e/_fixtures/auth.ts:5`), go to the seed project's `?tab=screening`, and `page.screenshot` into the scratchpad at 1280×800 and 390×844 for: All view (panel closed); a To screen record open (docked); "Start screening" (maximized); the conflict record (ruling form, "Reviewer A/B"); Settings. Run it with `npx playwright test <spec> --project=local-ui`, then compare per the design-review skill (frontend-ux §7 checklist + the Linear references), fix P0/P1 in the owning files, re-capture. Also confirm (coordinator input): the maximized panel's `getBoundingClientRect().width` equals the group's width, and the list's scroll position after maximize → restore equals the one before (scroll the list, maximize, restore, read `scrollTop`). Then `rm` the spec and confirm `git -C "$WT" status --short` is clean.

- [ ] **Step 4: Branch state and PR notes**

Run: `git -C "$WT" status --short && git -C "$WT" log --oneline dev..HEAD`
Expected: clean tree; the task commits in order. The PR body records: the 5,000-row numbers (Task 10), "above 5,000 articles per phase is a known limit", the design-review findings, and whether the E2E ran locally.
