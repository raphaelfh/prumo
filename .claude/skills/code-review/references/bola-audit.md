# BOLA audit playbook (prumo)

BOLA = **Broken Object-Level Authorization** = OWASP API #1 = the single biggest historical bug class on prumo.

Symptom: an endpoint accepts an object ID (run, article, template, decision, etc.) and operates on it without verifying the caller belongs to the project that owns the object. Anyone with a valid auth token can read or mutate another tenant's data by guessing or harvesting IDs.

## The standard prumo authorization stack

Every route handler that touches project-scoped data should look like:

```python
from app.api.deps.security import ensure_project_member, get_current_user_sub

@router.post("/runs/{run_id}/...")
async def handler(
    run_id: UUID,
    body: SomeBody,
    db: AsyncSession = Depends(get_db),
    user_sub: str = Depends(get_current_user_sub),
):
    run = await runs_repo.get(db, run_id)
    if run is None:
        raise HTTPException(404)
    await ensure_project_member(db, run.project_id, user_sub)  # <-- the gate
    # ... only now do the actual work
```

Canonical example: `backend/app/api/v1/endpoints/extraction_runs.py:88`.

## How to audit an endpoint

For each handler in `backend/app/api/v1/endpoints/`:

1. **List the object IDs it accepts** in path / query / body. Anything ending in `_id` that scopes data.
2. **For each ID, ask: who owns this object?** If the answer is "a project", verify there is a membership check.
3. **Read the order of operations.** The check must come *before* the data access. A check after the fact is too late — the query already ran with whatever ID was passed.
4. **Watch for indirect IDs.** `decision_id`, `block_id`, `evidence_id` — these all eventually scope to a project. Resolve to project, check membership.
5. **Watch for body-supplied IDs.** `body.project_id` is attacker-controlled. Treat it like a path param.

## Audit grep recipe

```sh
# Endpoints that take an *_id path param and may need membership checks
grep -RnE 'async def [a-z_]+\([^)]*_id: ' backend/app/api/v1/endpoints/

# Of those, which DO call ensure_project_member? (you want every project-scoped one to)
grep -Rn 'ensure_project_member' backend/app/api/v1/endpoints/

# Diff the two lists — the gap is your audit set.
```

## Role-level authorization

Membership is the floor, not the ceiling. Some operations require a stricter role:

- **Reviewer** — write to `extraction_reviewer_decisions`, `quality_assessment_*`.
- **Manager** — open/close runs, edit templates, clone templates, change project settings.

If an endpoint mutates run state, edits a template, or changes a member's role, the membership check is not enough. Look for the role-specific helper (`is_project_reviewer`, manager check) and verify it runs.

## Frontend never controls authorization

If you find a check like:

```ts
if (currentUser.role === "manager") {
  await api.dangerousMutation(...);
}
```

…that is a UX hint, not a security control. The backend must enforce. If the backend doesn't, file a security issue.

## RLS as defense-in-depth

Even with `ensure_project_member` in the handler, RLS on the table is the second wall. Migration 0018 (`is_project_reviewer` helper + relaxed write policies) is the pattern. Don't disable RLS for "convenience" — every relaxation needs a PR-body paragraph explaining who gains access.

## Test patterns that catch BOLA

```python
async def test_endpoint_blocks_non_member(client, run_in_other_project):
    response = await client.post(
        f"/api/v1/runs/{run_in_other_project.id}/some-action",
        json={...},
        headers=auth(other_user),
    )
    assert response.status_code in (403, 404)
```

Every state-changing endpoint should have at least one of these. If it doesn't, add it as part of the BOLA audit.

## Historical incidents on prumo

- Commit `1994ceb fix(backend): resolve 31 auto-found bugs` — multiple endpoints in `hitl_sessions.py` and `extraction_runs.py` missing membership checks.
- Commit `7273add fix(templates): server-authoritative clone import` — frontend was inserting directly into `project_extraction_templates`; the server-side `POST /api/v1/projects/{id}/templates/clone` now owns the operation and enforces the manager check.

When you touch any of those modules, re-run the audit. Past fixes don't immunize new code.
