---
name: systematic-debugging
description: prumo's delta on the four-phase debugging framework. Use BEFORE forming any hypothesis when a bug, failing test, or unexpected behaviour is reported. Stops the "I bet it's X, let me change X" reflex that produces three new bugs.
---

# Systematic Debugging (prumo)

**Read `superpowers:systematic-debugging` first.** It owns the generic method:
the iron law, the four phases, the red flags, and the rationalisation table.
This file does not repeat them — it layers the prumo-specific delta on top.

Random fixes waste time and mask the real issue. On prumo, the cost is paid in HITL data integrity — a "quick fix" to `run_lifecycle_service.advance_stage` is the kind of thing that loses a reviewer's decisions.

Don't skip the process because the bug seems simple: most prumo bugs touch 2+ layers (request → service → DB → RLS, or hook → service → cache → API).

## Phase 1 gate — a red loop before any theory

Phase 1 is done only when you can name **one command** you have **already run**, with its output shown, that is:

- **Red-capable**: it drives the real bug path and asserts the user's exact symptom, so it goes red on this bug and green once fixed. "Runs without error" does not count.
- **Deterministic**: same verdict every run. For a flaky bug, a pinned, high reproduction rate.
- **Fast**: seconds, not minutes.
- **Agent-runnable**: no human in the loop.

Build it in roughly this order: a failing pytest or vitest at the seam that reaches the bug; a `curl` against the local API with a real JWT; a Playwright script asserting on DOM, console, or network; a replayed captured payload; a throwaway harness calling the service directly; `git bisect run` between a good and a bad SHA; the same input through two versions or configs, diffed.

Then **tighten** it: narrow the test scope, pin time and seeds, assert on the symptom rather than "didn't crash". For a non-deterministic bug, raise the reproduction rate (`--count=50`, parallel runs, injected sleeps) until it is debuggable. If you cannot build a loop, stop and say what you tried and what access you need.

**Minimise** once it is red: cut inputs, fixtures, callers and steps one at a time, re-running after each cut, until every remaining element is load-bearing. The minimal repro becomes the regression test.

## Phase 1 delta — where prumo state can drift

prumo's request lifecycle has six places where state can drift. Instrument *all*
of them before you have a theory:

```
Request (Pydantic) → Endpoint (deps + auth) → Service (business logic)
  → SQLAlchemy session (commit/rollback) → Postgres + RLS
  → Response (Pydantic) → Frontend Zod → TanStack cache → React render
```

```python
# backend service entry
logger = structlog.get_logger()
logger = logger.bind(run_id=run_id, project_id=project_id, stage=run.stage)
logger.info("advance_stage.enter", current_stage=run.stage, target=target_stage)

# right before commit
logger.info("advance_stage.about_to_commit", row_version=run.row_version)
await session.commit()
logger.info("advance_stage.committed")
```

```ts
// frontend hook / service
console.debug('[DEBUG-a4f2] useExtractionData queryKey', queryKey, 'enabled', enabled);
console.debug('[DEBUG-a4f2] extractionValueService payload', payload);
```

Tag every temporary probe with one unique prefix such as `[DEBUG-a4f2]`, in Python and TypeScript alike. Cleanup is then one `grep -rn "DEBUG-a4f2"` that must come back empty. Bound structlog context (`run_id`, `project_id`) is the permanent kind and stays.

Run once. Read the logs/console. **Then** identify which layer is wrong. Theorising before this step is how you spend two hours fixing the wrong layer.

**Reproduction commands.** Backend: `pytest -k <name> -x --tb=long`; if flaky, `--count=20` (pytest-repeat). Frontend: `vitest run <path> -t "<name>"`. E2E: `npx playwright test --trace on`, then open the trace.

**Diff the recent commits.** `git log --oneline -20`, `git diff HEAD~5 -- backend/app/services backend/alembic`. Bugs in `extraction_*` or `hitl_*` are almost always co-located with a recent migration, a service rename (e.g. `qa_template_clone_service` → `template_clone_service`), or a TanStack key change.

If the exception lands inside `extraction_consensus_service.py` but the bad input came from a hook, switch to `root-cause-tracing/SKILL.md` and walk back.

### prumo-specific evidence to capture

- For BOLA / authorisation bugs: which `Depends(...)` is on the endpoint? Does the service re-check `project_members`? What does the RLS policy on that table actually say (`select polname, polqual from pg_policies where tablename='extraction_runs'`)?
- For async bugs: grep the suspect function for `async def`, then for every `await`. A missing `await` returns a coroutine that looks truthy — and tests pass.
- For SQLAlchemy bugs: was the session committed? Is the object detached? Did you use `await session.refresh(obj)` after an update? `select ... for update` for the TOCTOU candidates?
- For Celery bugs: is the task acking before or after the DB write? Look at `acks_late`, `retry`, `autoretry_for`.
- For TanStack bugs: what's the *full* query key? Does it include `run_id` *and* `template_version_id`? Is there an `invalidateQueries` somewhere that's too broad or too narrow?

## Phase 2 delta — prumo's siblings and canon

1. **Find a working sibling.** prumo has 20+ endpoints in `backend/app/api/v1/endpoints/`. A bug in `hitl_sessions.py` is most cheaply diagnosed by diffing against `extraction_runs.py` for the same shape of operation.
2. **Compare against the canonical reference.** For anything in extraction/HITL: `docs/reference/extraction-hitl-architecture.md`. Read the relevant section in full, not just the headers.
3. **Map dependencies.** What migrations did this code grow with? What seed data does it assume? What RLS does it presume? What Pydantic schema does the frontend expect?

## Phase 3 delta — ranked, falsifiable hypotheses

This overrides the single-hypothesis step of the generic method. List **3–5 hypotheses, ranked**, before testing any. One hypothesis anchors on the first plausible idea. Each must state its prediction: "If X is the cause, then changing Y makes the bug disappear." A hypothesis with no prediction is a vibe; sharpen or drop it. Show the list to the user when they are present; they often re-rank it instantly. Test in rank order, one variable at a time, each probe mapped to one prediction.

## Phase 4 delta — the failing test, per layer

- Backend: a pytest in `backend/tests/` that reproduces the bug, fails on `dev`, passes after the fix.
- Frontend: a vitest with the smallest possible component + MSW handlers that trigger the bug.
- For DB invariants, a test that calls the service twice / concurrently / with the bad input the wild caller sent.

The test only counts at a **correct seam**: one that reproduces the bug as it happens at the call site. If the only reachable seam is too shallow (one caller when the bug needs two, a unit test that cannot replay the chain), a test there is false confidence. Say so in the PR: a missing seam is an architecture finding for `/improve-codebase-architecture`.

Verify via `verification-before-completion/SKILL.md` — it carries prumo's command table.

### Phase 4.5 — when 3+ fixes failed

Patterns that indicate architectural problems on prumo:

- Every fix touches a different file in `backend/app/services/` — the boundary is wrong.
- Each fix passes its own test but breaks an integration test — invariants aren't enforced in one place.
- The fix needs to "also update" the Pydantic schema, the Alembic migration, the Zod schema, *and* the cache key — drift is the bug.

Stop. Ask: should this be a `CHECK` constraint? A deferred trigger? A SECURITY DEFINER helper? A single-source-of-truth schema? Discuss before attempting fix #4.

## Worked example — TOCTOU in `run_lifecycle_service.advance_stage`

Symptom: a reviewer occasionally sees a 409 from `POST /api/v1/runs/{id}/advance`, sometimes the stage advances twice, sometimes a `published_state` ends up pointing at a decision from the wrong run.

**Phase 1.** Reproduce with `pytest -k advance_stage --count=50`. Bind structlog context (`run_id`, `current_stage`, `target_stage`, `row_version`). The logs reveal: two concurrent requests both read `stage=PROPOSAL`, both write `stage=REVIEW`. No `select ... for update`, no `WHERE row_version=...` guard. RLS is fine; the bug is TOCTOU.

**Phase 2.** Sibling endpoints — `extraction_consensus_service.publish_decision` — use `with_for_update()` on the run row. `hitl_session_service.open_session` does the same. `advance_stage` does not.

**Phase 3.** Hypothesis: `advance_stage` lacks pessimistic locking on the run row. Test: write a pytest that opens two async sessions, both call `advance_stage` for the same `run_id`, assert one raises `ConcurrentUpdateError`.

**Phase 4.** Add `await session.execute(select(Run).where(Run.id == run_id).with_for_update())` at the top of the transaction. Re-run the new test (now passes), then the existing suite, then `make test-backend`. Defense-in-depth (next skill): add a `CHECK (stage IN (...))`-compatible deferred trigger that forbids `published_state.run_id` from pointing at a different run than the decision's run (migration 0005 pattern). Now the *class* is closed.

## Integration with other skills

- `root-cause-tracing/SKILL.md` — how to walk back from a deep error to the trigger.
- `defense-in-depth/SKILL.md` — apply after Phase 3 so the bug class is impossible, not just this instance.
- `verification-before-completion/SKILL.md` — before claiming Phase 4 is done.

## What good looks like

- Phase 1 names one red loop command, shown with its output, and logs with `run_id` and `project_id` bound.
- Phase 2 cites a working sibling and the canonical doc.
- Phase 3 shows a ranked list of falsifiable hypotheses, and names the one that held.
- Phase 4 produces (a) a failing test at a correct seam that now passes, or a stated missing seam, (b) one focused change, (c) green `make test-backend` / `npm run test:run` output, and (d) the original loop re-run green.
- Cleanup: `grep` for the debug tag returns nothing, and the PR body states the hypothesis that turned out correct.

If any of those are missing, the bug isn't fixed — it's hidden.
