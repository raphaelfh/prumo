---
name: root-cause-tracing
description: Trace a bug backwards through prumo's call stack — frontend hook → service → API → SQLAlchemy → RLS — until you find the original trigger. Use when the error appears in one place but the bad data clearly came from somewhere upstream.
---

# Root Cause Tracing (prumo)

## Overview

Bugs in prumo almost always surface far from the trigger:
- A `null` published value renders as `"—"` in the extraction grid — but the `null` was minted three layers earlier when `Promise.all` swallowed an error.
- A wrong run progress percentage in the sidebar — but the cache key forgot `run_id`, so the hook is reading another run's data.
- A 500 from `extraction_consensus_service.publish_decision` — but the bad `decision_id` came from a stale `useExtractionData` query that didn't invalidate after a reviewer rebase.

**Core principle:** trace backwards through the call chain until you find the *original* trigger, then fix at the source. Patching where it explodes leaves the trigger free to fire again somewhere else.

## When to use

Use when:

- The exception's location does *not* look like where the bad input could have originated.
- A stack trace is long and the obvious "fix it here" is suspicious.
- The same symptom appears in multiple unrelated places (almost always a shared upstream source).
- You're looking at a UI symptom (wrong number, stale state, missing row) — UI symptoms are *never* root causes; they are downstream of state.

Don't use when the trigger is obviously local (e.g. a typo in the function you just edited). Use `systematic-debugging` for those.

## The tracing process

### 1. State the symptom precisely

Not "extraction is broken". Write:

```
The "Run progress" badge on /projects/:projectId/runs/:runId
shows 42% when /api/v1/runs/:runId/progress returns 67%.
Project membership is OK, run is in REVIEW stage.
```

Include the IDs, the URL, the stage, the user role. If you can't write the symptom this precisely, do Phase 1 of `systematic-debugging` first.

### 2. Find the immediate cause

What is the *last* piece of code that produced the wrong value? For UI: which component renders the value? For a 500: the line that raised.

```ts
// frontend/components/ExtractionRunProgressBadge.tsx
const { data: progress } = useRunProgress(runId);
return <span>{progress?.percentage ?? 0}%</span>;
```

OK — the rendering is correct *given the data*. Move up.

### 3. Ask "what called this with the bad value?"

```ts
// frontend/hooks/extraction/useExtractionProgress.ts
export function useRunProgress(runId: string) {
  return useQuery({
    queryKey: ['run-progress'], // <-- smell: no runId in key
    queryFn: () => runService.getProgress(runId),
  });
}
```

There. Two runs share the cache slot. The trigger was *the previous run's render*, which populated the cache; the second run's mount re-uses it.

### 4. Keep climbing until you hit ground truth

Don't stop at the first suspicious thing. Ask one more level:

- Is the wrong cache key isolated to this hook, or is it a pattern? (`grep -r "queryKey: \['" frontend/hooks/extraction/`)
- Did a recent rename (e.g. `qa_template_clone_service` → `template_clone_service`) leave stale keys behind?
- Does any sibling hook get this right? Compare.

The *root* trigger is the answer to "why does this code exist this way?", not "where does the value first appear wrong".

### 5. Fix at the source — and only there

Then go back down the chain and consider whether any *layer* between source and symptom should also defend against this class of input. That's `defense-in-depth/SKILL.md`.

## Backend tracing — async pitfalls

prumo's backend is async-first. Tracing through async code has specific gotchas:

### Missing `await`

```python
async def advance_stage(...):
    # `record_proposal` returns a coroutine; this line is a no-op
    extraction_proposal_service.record_proposal(...)
    await session.commit()
```

Symptom: data "disappears" but no exception. Trace strategy: grep callers of the swallowed coroutine. `ruff check --select ASYNC` catches some of these; trust but verify.

### `asyncio.gather` partial failure

```python
results = await asyncio.gather(
    propose_field_a(),
    propose_field_b(),
    propose_field_c(),
)  # one raises, the others' results are lost; the run sits in a half-done state
```

`gather` cancels siblings by default. If any task already wrote to the DB before being cancelled, you have inconsistent state. Use `return_exceptions=True` *and* explicit per-task error handling. Trace: when you see "half the fields got proposed", look up the call tree for a `gather`.

### Transaction not committed

```python
async with AsyncSession(engine) as session:
    obj = await service.do_thing(session, ...)
    # forgot session.commit() — obj is in memory, never persisted
return obj
```

Symptom: API returns 200 with the new object's ID, subsequent GET returns 404. Trace: find the service call site, walk up to where the session was opened, verify `commit()` (or the dependency that auto-commits) is reached on every path.

### Session boundary leak

A model loaded in one async session can't be safely refreshed in another. Symptom: `DetachedInstanceError` or stale fields. Trace: who owns the session? Is it a FastAPI `Depends`-provided session? Is the model crossing a Celery task boundary (it shouldn't)?

## Frontend tracing — error-swallowing

`frontend/hooks/extraction/*` and `frontend/services/*` are the highest-risk surface. Common swallowers:

```ts
// services/extractionValueService.ts
const results = await Promise.all(payloads.map(p => api.post('/values', p).catch(() => undefined)));
// one POST fails, returns `undefined`, others succeed; UI shows "all saved"
```

Trace strategy:

1. Symptom: a value the user typed didn't persist.
2. Immediate cause: the `useExtractionAutoSave` hook didn't surface an error.
3. Up one: the hook called `extractionValueService.saveMany`.
4. Up one: the service used `Promise.all(...).catch(() => undefined)`. **Found.**
5. Fix at source: `Promise.allSettled`, surface failures, retry policy.
6. Defense at every layer: hook should toast on error; service should `throw`, never silently return `undefined`; backend should accept a batch idempotency key so retries are safe.

## Adding instrumentation when manual trace is unclear

When you can't read the chain from source alone, instrument *before* the suspect operation, not after the symptom:

### Backend

```python
import structlog
log = structlog.get_logger()

async def publish_decision(run_id: UUID, decision_id: UUID, session: AsyncSession):
    log_ctx = log.bind(run_id=str(run_id), decision_id=str(decision_id))
    log_ctx.info("publish_decision.enter")

    decision = await session.get(ExtractionReviewerDecision, decision_id)
    log_ctx.info(
        "publish_decision.loaded",
        decision_run_id=str(decision.run_id) if decision else None,
        decision_kind=decision.kind if decision else None,
    )
    # ... proceed
```

Use `bind_contextvars` at the request boundary (FastAPI dependency) so the IDs follow the whole request through structlog without re-binding.

### Frontend

```ts
// useExtractionData.ts
useEffect(() => {
  console.debug('[useExtractionData]', { runId, templateVersionId, queryKey, enabled });
}, [runId, templateVersionId, queryKey, enabled]);
```

Or, better, the TanStack Query devtools — they show every key, every cached entry, every state transition. Open them first.

### Distributed: Celery → API → DB

prumo runs Celery for long extraction tasks. If the bug spans a task boundary, manual print-tracing is hopeless. Use the OTel trace ID:

1. Bind it on the request: `bind_contextvars(trace_id=get_current_span().get_span_context().trace_id)`.
2. Pass it into the Celery task payload.
3. Re-bind on the task side at `task_prerun`.
4. Search logs by trace ID — the span tree shows exactly where the data went wrong.

## Finding which test pollutes state

If a test fails only when run after some other test:

```bash
# bisect with pytest
pytest backend/tests/ -x --tb=line
# narrow with -k and remove tests until the failure disappears
pytest -k "test_a or test_b or test_c"
```

Common culprits on prumo: a test that wrote to `seed_data`-shared tables without an explicit teardown; a test that left a `pg_advisory_lock` held; a fixture that didn't roll back its transaction.

## The principle, restated

> Never fix only where the error appears. Trace back to the original trigger, fix there, then add defenses at each layer in between.

Symptoms are honest narrators about *something*, but rarely about themselves.

## Worked example — wrong progress % in sidebar

**Symptom.** `RunProgressBadge` shows 42% but `GET /api/v1/runs/:id/progress` returns 67%.

**Immediate cause.** `useRunProgress(runId).data.percentage === 42`.

**Up one.** TanStack devtools show two entries under `queryKey: ['run-progress']`: one with `percentage: 42` (from a previous run), one with `percentage: 67` (current). The hook is reading the first.

**Up one.** `useRunProgress`'s `queryKey` is `['run-progress']` — no `runId`. **Trigger found.**

**Source fix.** `queryKey: ['run-progress', runId]`.

**Defense at every layer.**
- ESLint rule (or PR review checklist) that flags fixed-string `queryKey` arrays in `frontend/hooks/extraction/`.
- Service layer (`frontend/services/`) should never accept an undefined `runId` — throw early.
- Backend should never return progress for a run the caller can't access (RLS + endpoint check).

This produces a fix that holds even after the next refactor.

## Stack-trace tips

- In pytest, capture stacks with `pytest --tb=long`. For async, `pytest -p asyncio --tb=long`.
- In Node/Vitest, the default trace is fine; for service-level recursion, add `Error.captureStackTrace`.
- Always log *before* the dangerous operation — once it raises, you've lost the call-site context.
- Always log the IDs (`run_id`, `project_id`, `user_id`, `template_version_id`) — a trace without IDs is a chair without legs.
