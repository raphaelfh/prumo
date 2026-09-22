---
name: code-review
description: "Use before claiming prumo work is done, fixed or passing, before drafting a PR, and when reviewing a diff or answering review feedback. Supplies prumo's verification commands and a review checklist built from its recurring incident classes: BOLA, run-state races, error swallowing, schema and envelope drift, stale TanStack cache, migrations."
---

# Code Review (prumo)

**Evidence before claims.** Every claim in a review, yours or a reviewer's, rests on a `file:line`, a command's output, or a doc section. The generic discipline lives in superpowers: `verification-before-completion` (the gate), `requesting-code-review` and `receiving-code-review`. This skill adds prumo's commands and the checklist of bug classes that already shipped here once.

## The verification gate: prumo's commands

Run from the repo root unless noted. Read the whole output before you claim.

| Claim | Command | Passes when |
|---|---|---|
| Backend tests pass | `make test-backend` | exit 0, no `FAILED` or `ERROR` |
| One backend test passes | `cd backend && uv run pytest -k <name> -x --tb=short` | `1 passed` |
| Backend lint and types | `make lint-backend` (ruff + the CI mypy ratchet against `backend/.mypy_baseline`; never `--update` it to pass) | exit 0, `mypy ratchet OK: … no new errors.` |
| Frontend tests pass | `npm run test:run` | exit 0 |
| One frontend test passes | `npx vitest run <path> -t "<name>"` | `1 passed` |
| Frontend lint and types | `npm run lint` and `npm run typecheck` (not a bare `tsc --noEmit`) | exit 0 |
| Migration is sound | `cd backend && uv run alembic upgrade head && uv run alembic check` (what CI runs) | both exit 0 |
| Endpoint is authorized | each client-supplied id maps to its guard (§ A); `python3 scripts/fitness/check_scope_guards.py` | exit 0 |
| RLS policy holds | a query run as `authenticated` with a JWT claim is refused (`set_config('request.jwt.claims', …, true)` + `SET LOCAL ROLE authenticated`, as `backend/tests/integration/test_llm_connection_rls.py` does). Tests connect as `postgres`, which bypasses RLS | the query returns nothing or errors |
| Bug is fixed | the regression test failed before the fix and passes after | red, then green, in the output |
| The UI is right | `design-review` on the changed screen | a screenshot you captured |
| Everything | `make quality-scan` (`scripts/verify_all.sh`) | exit 0 |

A subagent's "done" is a claim, not evidence: read `git status` and `git diff`, and rerun the tests yourself. CI green is necessary, not sufficient.

## The prumo review checklist

Apply it to every diff: yours before you ask for review, anyone's before you approve.

### A. Authorization (BOLA, the #1 incident class)

- [ ] Every client-supplied id (path, query, body) is bound by its guard **before** the data access. The canonical list is `.claude/rules/backend.md` § Ownership guards: `require_project_*` / `ensure_project_*` for a project, `load_run_for_member` for a run, `assert_kickoff_scope` for the AI kickoff coordinate, the named `owned_*` guard for a row in its parent.
- [ ] No hand-rolled ownership check. A `select` or `db.get` followed by a compare, where a named guard exists, is a second copy: `check_scope_guards.py` catches WHERE-clause copies and raw `project_members` SQL, not a fetch-then-compare.
- [ ] The role matches the operation: reviewer for workflow writes, arbitrator for consensus and finalize, manager for configuration and destructive operations. Membership alone is the floor.
- [ ] The server decides authorization. A client-side permission check is UX, never the gate.

### B. RLS

- [ ] A new table enables RLS in its own migration, with a policy per command that calls the `public.is_project_*(project_id, auth.uid())` helpers, never an inline `FROM project_members`. A backend-only table may instead be `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL` with no policy (migrations 0075, 0076).
- [ ] Count `op.create_table` against `ENABLE ROW LEVEL SECURITY` by hand: `check_rls_coverage.py` only sees a literal `CREATE TABLE`.
- [ ] A policy relaxation says in the PR body who gains access, and why.
- [ ] RLS never substitutes for § A: the API and the worker connect as a privileged role and bypass it. Storage policies that read `public` tables live in Alembic (0003); pure bucket policies live in `supabase/migrations/`.

### C. Run state and concurrency (TOCTOU)

- [ ] Stage changes (`pending → extract → consensus → finalized`, or `cancelled`) go through `run_lifecycle_service`, never an ad-hoc `run.stage = …`.
- [ ] Check-then-write happens under a lock in one transaction: `load_run_for_update` (`services/_extraction_run_lock.py`) for a run row, `take_advisory_xact_lock` (`services/advisory_locks.py`) for a coordinate, keyed exactly as its other callers key it.
- [ ] Opening a HITL session is idempotent: resending the request creates no second run.
- [ ] A Celery task that mutates run state re-reads it under the lock; state captured at enqueue time is stale.

### D. Error swallowing

- [ ] No catch returns a success-shaped object (`.catch(() => ({ success: true }))`); no `except Exception: pass`, no bare `except:`.
- [ ] `Promise.all` only when every child must succeed; otherwise `Promise.allSettled` with partial failures surfaced. A Supabase `{ error }` result is checked, not dropped.
- [ ] An empty result is not proof of "nothing there": on the backend it can be a wrong scope predicate, in the browser it is RLS filtering rows.
- [ ] A failed Celery enqueue answers 503 `SERVICE_UNAVAILABLE` (`endpoints/section_extraction.py`), never a fake success.

### E. Schema drift

- [ ] Pydantic `X | None` matches `nullable=True` in SQLAlchemy and back. A default lives in one place (DB `server_default`), repeated in Pydantic only when the API fills it.
- [ ] A new enum value lands in a migration (`ALTER TYPE … ADD VALUE`) **and** in `POSTGRESQL_ENUM_VALUES` (`backend/app/models/base.py`).
- [ ] A changed endpoint or schema regenerates the frontend types (`npm run generate:api-types`) in the same PR; the CI `api-contract` job fails on drift.

### F. ApiResponse envelope

- [ ] Every JSON response is `ApiResponse[T]` with a typed `T`, built by `ApiResponse.success(x, trace_id=…)`; errors reach the client as `error.message` (`check_api_response_envelope.py`).
- [ ] The frontend unwraps once, in `apiClient<T>` (`frontend/integrations/api/client.ts`); services wrap it in `ErrorResult<T>` via `toResult`. `data.data.foo` in a hook is a double unwrap (`7100956`).

### G. TanStack Query cache

- [ ] Keys come from a factory (`frontend/lib/query-keys/`, or a domain one such as `runsKeys.detail(runId)`); a literal key array fails `check_react_query_keys.py`. The key carries every id the query reads by.
- [ ] Each `useMutation` invalidates every key family whose data it changed. No gate checks this: read each `onSuccess`.
- [ ] Every invalidated key has a reader: a `useQuery` on the same factory member (the run view is `runsKeys.detail(runId)`, read by `useRun`). knip does not flag an unused factory member, and a spy on `invalidateQueries` passes for a key nothing reads; assert through the reader hook with MSW, as `frontend/test/hooks/sectionExtractionJobs.test.tsx` does.
- [ ] An optimistic update has an `onError` rollback.
- [ ] When the backend auto-advances a run stage, the frontend invalidates the run detail key.

### H. Migrations

- [ ] Read `docs/reference/migrations.md` before touching `backend/alembic/versions/`.
- [ ] Revision id ≤ 32 characters, `down_revision` is the current head, one logical change per file.
- [ ] A migration that deletes or updates rows guards itself in SQL (`AND NOT EXISTS …`). Railway runs `alembic upgrade head` at boot, so a migration that raises blocks every later deploy, the fix included.
- [ ] No data migration in the same revision as a schema change that locks the table.

### I. Tests

- [ ] New behavior has a test that failed first; a bug fix has a regression test for the original symptom.
- [ ] No `sleep`-based waits. No clock library is installed: inject `now`.
- [ ] Each assertion can fail: expected values are independent literals, and the test asserts its precondition before its outcome (`web-testing` § Anti-patterns).
- [ ] Test names describe the scenario: `test_create_consensus_rejects_viewer_member`.

### J. Conventions

- [ ] Code, comments, commits and the PR body are in English.
- [ ] Conventional Commits with a scope (`fix(hitl): close session on abort`); the PR targets `dev`; its body fills `.github/PULL_REQUEST_TEMPLATE.md`, Definition of Done included.

### K. Decisions and docs land with the code

- [ ] An architectural decision (new dependency, storage strategy, cross-cutting pattern) ships its ADR under `docs/adr/` in the same PR, superseding an old one rather than editing it.
- [ ] A new or changed endpoint, or a new `extraction_*` table, updates its `docs/reference/` doc and `last_reviewed` in the same PR, or the PR body says "no doc change needed".

## The spec axis: does the diff do what was asked?

The checklist is the **standards** axis; a diff can pass it and still build the wrong thing. When the work has a source of intent (a `/ship-spec` spec or plan, an issue named in the commits, a plan under `docs/superpowers/plans/`), review that axis in a **separate sub-agent** so neither review colors the other. Brief it with the diff command (`git diff <base>...HEAD`), the commit list and the spec path, and ask for findings that quote the spec line:

1. Requirements missing or only partly done.
2. Behaviour nobody asked for (scope creep).
3. Requirements that look implemented but are wrong.

Report the two axes under separate headings; merging them lets one mask the other. Inside `/ship-spec`, `ship-reviewer` already reviews against the plan. With no spec, say "no spec available" and skip the axis.

## Asking for and answering review

- **Asking.** One concern per PR, self-reviewed against the checklist, never on red CI. Label `security` when the diff touches auth, RLS or endpoint exposure. The `pr-review` routine skips `claude/` and `autofix/` branches unless the PR carries `needs-review`.
- **Answering.** Verify each comment against the code before agreeing or pushing back. Push back with evidence when a suggestion contradicts `docs/reference/extraction-hitl-architecture.md` or `docs/reference/migrations.md`. Answer every comment: fixed in `<sha>`, won't fix because…, or a linked follow-up issue.
- **Writing review as an agent.** Each finding cites `file:line` or a command and names the concrete risk. Order Critical → Important → Minor and stop at ten. Style a linter could catch is not a finding.

## Automated PR review

Any automated surface reviewing a pull request (the `pr-review` cloud routine, a "review PR N" session) uses this checklist as WHAT to review and [`references/automated-pr-review.md`](references/automated-pr-review.md) as the contract: how to find the PR, the dedup rule, the `## Claude review` comment format, and the comment-only rules. Keep review knowledge here, never inlined in routine prompts.
