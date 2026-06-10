# Race conditions and TOCTOU on prumo

TOCTOU = Time-Of-Check-To-Time-Of-Use. You check a precondition, then act on it. Between the check and the use, another request changes the world out from under you. Result: two requests both "win", or a state transition fires twice, or a row gets created/closed/duplicated.

The HITL stack on prumo is the highest-risk surface because run state transitions are concurrent by design (reviewer submits while AI finishes its pass, manager publishes while reviewer is still editing, etc.).

## The classic prumo TOCTOU shape

```python
# WRONG — TOCTOU
run = await get_run(db, run_id)
if run.status != "REVIEW":
    raise HTTPException(409, "wrong state")
# ... another request flips status here ...
run.status = "PUBLISHED"
await db.commit()
```

Two requests can both pass the `if run.status != "REVIEW"` check before either commits. Both then write `PUBLISHED`. Or worse: one writes `PUBLISHED`, the other writes `ARCHIVED`, last write wins.

## The fix patterns

### 1. Conditional UPDATE with RETURNING

```python
# RIGHT — atomic
result = await db.execute(
    update(Run)
    .where(Run.id == run_id, Run.status == "REVIEW")
    .values(status="PUBLISHED", updated_at=func.now())
    .returning(Run)
)
updated = result.scalar_one_or_none()
if updated is None:
    raise HTTPException(409, "wrong state or race lost")
```

Either you wrote the row (you saw `REVIEW` and now it's `PUBLISHED`) or nobody can claim you did. Exactly-one-winner.

### 2. SELECT FOR UPDATE inside a transaction

```python
async with db.begin():
    run = (await db.execute(
        select(Run).where(Run.id == run_id).with_for_update()
    )).scalar_one()
    if run.status != "REVIEW":
        raise HTTPException(409, "wrong state")
    run.status = "PUBLISHED"
```

Use when you need to read multiple rows before the decision, not just one.

### 3. Idempotency keys

For session opens, run creation, decision posting — accept an idempotency key from the client (or derive one from `(user_id, run_id, action)`). On duplicate, return the existing row instead of inserting a new one.

## Endpoints / services that historically had races

- `run_lifecycle_service` — stage transitions (PROPOSAL → REVIEW → PUBLISHED → ARCHIVED). See commit `1994ceb` for the audit.
- `hitl_session_service` — session open/close, especially when AI extraction finishes concurrently with a reviewer opening the session.
- `extraction_consensus_service` — multiple reviewers' decisions racing to advance run state.
- `template_clone_service` — concurrent clone attempts; healing path must be idempotent.
- Celery tasks that mutate run state — the worker re-fetches state and must lock or use conditional update.

## Celery-specific traps

A Celery task enqueued with `run_id` captures `run_id`, not `run.status`. Between enqueue and execution, anything can change.

- [ ] At task start, re-fetch the run.
- [ ] Validate it's still in the state the task assumes. If not, log + return; do not blindly write.
- [ ] If two tasks for the same run could be in flight, gate with a DB-level lock or a status-conditional update.
- [ ] `acks_late=True` + idempotent task body for anything that mutates DB state.

## Frontend-side equivalents

Yes, the frontend can have TOCTOU too:

```ts
// WRONG
const run = await fetchRun(runId);
if (run.status === "REVIEW") {
  await api.publish(runId); // by the time this lands, status changed
}
```

Either (a) the server enforces the precondition (it should) and the client just surfaces the 409, or (b) you accept that the client is optimistic and design for retry.

`useMutation` + `onError` + `invalidateQueries` is the loop. Optimistic update without rollback in `onError` is a stale-cache TOCTOU bomb.

## Audit grep

```sh
# Direct status assignments — candidates for racy transitions
grep -RnE '\.status\s*=\s*"' backend/app/services/ backend/app/api/v1/endpoints/

# get-then-write patterns — read the surrounding code for race shape
grep -RnB2 -A4 'if .*\.status' backend/app/services/
```

## Test patterns

Race tests are hard but not impossible:

```python
async def test_concurrent_publish_only_one_wins(db, run_in_review):
    async def attempt():
        try:
            await publish_run(db, run_in_review.id)
            return "won"
        except HTTPException as e:
            return e.status_code

    results = await asyncio.gather(attempt(), attempt(), return_exceptions=True)
    wins = sum(1 for r in results if r == "won")
    assert wins == 1  # exactly one
```

Even if the test is flaky-prone, a passing version proves the conditional UPDATE works. A consistently passing version with `asyncio.gather` of N=10 is good enough for the suite.

## Bottom line

If your handler reads state then writes it in two separate statements, that's a race in waiting. Make it one statement with `WHERE` on the precondition, or put both inside a transaction with `FOR UPDATE`.
