---
name: systematic-debugging
description: Four-phase debugging framework for prumo. Use BEFORE forming any hypothesis when a bug, failing test, or unexpected behaviour is reported. Stops the "I bet it's X, let me change X" reflex that produces three new bugs.
---

# Systematic Debugging (prumo)

Random fixes waste time and mask the real issue. On prumo, the cost is paid in HITL data integrity — a "quick fix" to `run_lifecycle_service.advance_stage` is the kind of thing that loses a reviewer's decisions.

**Core principle:** find root cause before proposing a fix. Symptom fixes are failure.

## The iron law

> No fix without root-cause investigation. If Phase 1 is not done, you do not get to propose code changes.

## When to use

Any technical issue: failing pytest/vitest, wrong number in the UI, a Celery task that silently does nothing, an Alembic migration that "feels off", a stale TanStack query. **Especially** when:

- You're under time pressure (emergencies are when guessing feels free, and is most expensive).
- "Just one quick fix" feels obvious.
- A previous fix didn't work.
- The bug "doesn't make sense" given what you think the code does.

Don't skip because the bug seems simple: most prumo bugs touch 2+ layers (request → service → DB → RLS, or hook → service → cache → API).

## The four phases

You must finish each phase before starting the next.

### Phase 1 — Root cause investigation

1. **Read the error verbatim.**
   - Full stack trace, full structlog event. Note `run_id`, `project_id`, `user_id`, `template_version_id`, decision IDs.
   - Don't paraphrase. Don't skip "boring" frames.

2. **Reproduce deterministically.**
   - Backend: `pytest -k <name> -x --tb=long`. If flaky, run with `--count=20` (pytest-repeat) or in a loop.
   - Frontend: `vitest run <path> -t "<name>"`. For UI repro, run `make start` and capture the exact sequence with `vite` devtools + TanStack Query devtools open.
   - E2E: `npx playwright test --trace on` then open the trace.
   - If you cannot reproduce, **do not guess**. Add instrumentation, run again, gather more data.

3. **Diff the recent commits.**
   - `git log --oneline -20`, `git diff HEAD~5 -- backend/app/services backend/alembic`.
   - Bugs in `extraction_*` or `hitl_*` are almost always co-located with a recent migration, a service rename (e.g. `qa_template_clone_service` → `template_clone_service`), or a TanStack key change.

4. **Gather evidence at every boundary** before theorising. prumo's request lifecycle has six places where state can drift:

   ```
   Request (Pydantic) → Endpoint (deps + auth) → Service (business logic)
     → SQLAlchemy session (commit/rollback) → Postgres + RLS
     → Response (Pydantic) → Frontend Zod → TanStack cache → React render
   ```

   Instrument *all* of them before you have a theory:

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
   console.debug('[useExtractionData] queryKey', queryKey, 'enabled', enabled);
   console.debug('[extractionValueService] payload', payload);
   ```

   Run once. Read the logs/console. **Then** identify which layer is wrong. Theorising before this step is how you spend two hours fixing the wrong layer.

5. **Trace data flow when the error is deep.**
   - If the exception lands inside `extraction_consensus_service.py` but the bad input came from a hook, switch to `root-cause-tracing/SKILL.md` and walk back.
   - Fix at the source, not where it explodes.

#### prumo-specific evidence to capture

- For BOLA / authorisation bugs: which `Depends(...)` is on the endpoint? Does the service re-check `project_members`? What does the RLS policy on that table actually say (`select polname, polqual from pg_policies where tablename='extraction_runs'`)?
- For async bugs: grep the suspect function for `async def`, then for every `await`. A missing `await` returns a coroutine that looks truthy — and tests pass.
- For SQLAlchemy bugs: was the session committed? Is the object detached? Did you use `await session.refresh(obj)` after an update? `select ... for update` for the TOCTOU candidates?
- For Celery bugs: is the task acking before or after the DB write? Look at `acks_late`, `retry`, `autoretry_for`.
- For TanStack bugs: what's the *full* query key? Does it include `run_id` *and* `template_version_id`? Is there an `invalidateQueries` somewhere that's too broad or too narrow?

### Phase 2 — Pattern analysis

1. **Find a working sibling.** prumo has 20+ endpoints in `backend/app/api/v1/endpoints/`. A bug in `hitl_sessions.py` is most cheaply diagnosed by diffing against `extraction_runs.py` for the same shape of operation.
2. **Compare against the canonical reference.** For anything in extraction/HITL: `docs/reference/extraction-hitl-architecture.md`. Read the relevant section in full, not just the headers.
3. **Enumerate differences.** Even "that can't matter" differences. The bug usually is in one of them.
4. **Map dependencies.** What migrations did this code grow with? What seed data does it assume? What RLS does it presume? What Pydantic schema does the frontend expect?

### Phase 3 — Hypothesis and testing

1. **Write the hypothesis down.** "I think X is the cause because Y." One sentence. If you can't write it, you don't have one.
2. **Test minimally.** *One* variable. Add a single `print`, change a single value in a unit test, flip a single flag. Do not bundle.
3. **Verify before continuing.** If it didn't work, form a *new* hypothesis. Do not stack fixes on top of an unverified one.
4. **Admit unknowns.** "I don't know what `row_version` is doing here" is fine; pretending is not.

### Phase 4 — Implementation

1. **Write the failing test first.**
   - Backend: a pytest in `backend/tests/` that reproduces the bug, fails on `main`, passes after the fix.
   - Frontend: a vitest with the smallest possible component + a mocked service that triggers the bug.
   - For DB invariants, a test that calls the service twice / concurrently / with the bad input the wild caller sent.

2. **Fix one thing.** Address the root cause. No "while I'm here" refactors, no doc updates, no rename. Those are separate commits.

3. **Verify.** Run the test you wrote, then the surrounding module, then `make test-backend` / `npm test`. See `verification-before-completion/SKILL.md`.

4. **If the fix doesn't work, count attempts.**
   - 1–2 failed attempts: return to Phase 1 with the new evidence.
   - 3+ failed attempts: **stop**. Each failure exposing a new place to patch is a signal the architecture is wrong, not that the fix is. Surface this to the user before attempt #4.

#### Phase 4.5 — When 3+ fixes failed

Patterns that indicate architectural problems on prumo:

- Every fix touches a different file in `backend/app/services/` — the boundary is wrong.
- Each fix passes its own test but breaks an integration test — invariants aren't enforced in one place.
- The fix needs to "also update" the Pydantic schema, the Alembic migration, the Zod schema, *and* the cache key — drift is the bug.

Stop. Ask: should this be a `CHECK` constraint? A deferred trigger? A SECURITY DEFINER helper? A single-source-of-truth schema? Discuss before attempting fix #4.

## Red flags — stop and restart Phase 1

- "Quick fix for now, investigate later."
- "Let me just try changing X and see."
- "Multiple changes at once will save time."
- "It's probably X."
- "Pattern says X but I'll adapt it."
- "Here are the main problems: [list of fixes, no evidence]."
- Each fix surfaces a new problem.
- About to attempt fix #3+ without a fresh Phase 1.

Any of these means: **stop and go back to Phase 1.**

## Common rationalisations

| Excuse | Reality |
|---|---|
| "Issue is simple, skip the process" | Simple bugs have root causes too. The process is fast for simple bugs. |
| "Emergency, no time" | Systematic is *faster* than thrashing — measured in hours/day. |
| "Try this first, then investigate" | First fix sets the pattern. Do it right. |
| "I'll write the test after" | Untested fixes regress within weeks on prumo. |
| "Multiple fixes at once" | You can't tell which one worked. |
| "I see the problem" | Seeing a symptom is not understanding the cause. |
| "One more attempt" (after 2+) | 3+ failures = wrong architecture, not wrong fix. |

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

- Phase 1 produces logs with `run_id` and `project_id` bound.
- Phase 2 cites a working sibling and the canonical doc.
- Phase 3 states one hypothesis in writing.
- Phase 4 produces (a) a failing test that now passes, (b) one focused change, (c) green `make test-backend` / `npm test` output.

If any of those four are missing, the bug isn't fixed — it's hidden.
