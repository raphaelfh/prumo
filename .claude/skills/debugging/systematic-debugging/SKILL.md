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
console.debug('[useExtractionData] queryKey', queryKey, 'enabled', enabled);
console.debug('[extractionValueService] payload', payload);
```

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

## Phase 4 delta — the failing test, per layer

- Backend: a pytest in `backend/tests/` that reproduces the bug, fails on `main`, passes after the fix.
- Frontend: a vitest with the smallest possible component + a mocked service that triggers the bug.
- For DB invariants, a test that calls the service twice / concurrently / with the bad input the wild caller sent.

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

- Phase 1 produces logs with `run_id` and `project_id` bound.
- Phase 2 cites a working sibling and the canonical doc.
- Phase 3 states one hypothesis in writing.
- Phase 4 produces (a) a failing test that now passes, (b) one focused change, (c) green `make test-backend` / `npm test` output.

If any of those four are missing, the bug isn't fixed — it's hidden.
