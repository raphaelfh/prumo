# BOLA audit playbook (prumo)

BOLA = **Broken Object-Level Authorization** = OWASP API #1 = prumo's most repeated incident class.

Symptom: an endpoint accepts an object ID (run, article, template, decision, etc.) and operates on it without binding it to the caller's scope. Anyone with a valid auth token can read or mutate another tenant's data by guessing or harvesting IDs.

The rules (one implementation per ownership predicate, scope in the WHERE clause, the named row-in-parent guards) live in `.claude/rules/backend.md` § Ownership guards. This file is the audit procedure against them.

## Which guard binds which id

| The request names | Guard | Refuses with | Where |
|---|---|---|---|
| `project_id` in the path | `Depends(require_project_scope)` / `Depends(require_project_manager)` | 403 | `api/deps/security.py` |
| `project_id` in the body | `ensure_project_member`, `ensure_project_reviewer`, `ensure_project_manager`, `ensure_project_arbitrator` | 403 | `api/deps/security.py` |
| `run_id` alone | `load_run_for_member` | 404 missing, 403 non-member | `api/deps/scope.py` |
| The AI kickoff coordinate (project, article, template, run) | `assert_kickoff_scope` | 400 when the body ids do not belong together | `api/deps/scope.py` |
| A row inside a parent (template in project, section in template, article in project, instance in coordinate, LLM connection in user or project) | The named guard for that pair | 404-class for missing and foreign alike | Listed in `.claude/rules/backend.md` § Ownership guards |

Membership binds the caller to a project. It does not bind a second id to that project: an endpoint taking `project_id` and `article_id` needs `ensure_project_member` **and** `owned_article`.

Live examples in `backend/app/api/v1/endpoints/extraction_runs.py`: `create_run` checks a body `project_id` with `ensure_project_member` then `ensure_project_reviewer`; the run-scoped endpoints call `load_run_for_member`.

## How to audit an endpoint

For each handler in `backend/app/api/v1/endpoints/`:

1. **List every client-supplied id** in path, query and body that scopes data.
2. **Name its guard** from the table. No guard is a finding. A hand-rolled check (a `select` or `db.get`, then a compare) where a named guard exists is also a finding: it is the second copy the rule forbids.
3. **Check the order.** The guard runs before any read or write that uses the id.
4. **Resolve indirect ids** (`decision_id`, `evidence_id`, `proposal_record_id`) to their parent through the guard that owns the pair, or a scoped query when there is none yet (then add the guard). The two shared compositions in `api/deps/scope.py` are the only place a resolved row is compared against body ids.
5. **Check the role.** Membership is the floor. Reviewer for workflow writes, arbitrator for consensus and finalize, manager for project configuration and destructive operations.
6. **Check the refusal** against the table's "Refuses with" column. A row-in-parent guard answers missing and foreign rows with the same 404-class error, and the message names no field of the foreign row.

## Audit grep recipe

```sh
# Every client-supplied id the endpoints accept
grep -RnE '_id: (UUID|str)' backend/app/api/v1/endpoints/

# Every guard call: membership, run resolution, kickoff, row-in-parent
grep -RnE 'require_project_(scope|manager)|ensure_project_(member|reviewer|manager|arbitrator)|load_run_for_member|assert_kickoff_scope|owned_[a-z_]+|assert_instance_in_coordinate' backend/app/api/v1/endpoints/

# The gate: a second implementation of an existing predicate fails
python scripts/fitness/check_scope_guards.py
```

Diff the first two lists; the gap is your audit set. The gate catches repeated WHERE-clause predicates and raw `project_members` SQL, so it cannot see a `db.get`-then-compare copy. Step 2 reads for exactly that.

## Frontend never controls authorization

If you find a check like:

```ts
if (currentUser.role === "manager") {
  await api.dangerousMutation(...);
}
```

…that is a UX hint, not a security control. The backend must enforce. If the backend doesn't, file a security issue.

## RLS as defense-in-depth

The API and the worker connect as service role, so RLS does not gate them: the guards above are their only wall. RLS gates the browser. Both call the same `public.is_project_*` SQL helpers. Don't disable RLS for "convenience"; every relaxation needs a PR-body paragraph explaining who gains access. Checklist: `rls-review.md`.

## Test patterns that catch BOLA

Endpoint tests use `db_client` with the auth override pointed at a seeded profile, then switch identity mid-test (`backend/tests/integration/test_extraction_runs_endpoints.py`):

```python
async def test_create_consensus_rejects_viewer_member(db_client, db_session, auth_as_profile):
    run_id, instance_id, field_id, decision_id = await _setup_consensus_run(db_client, db_session)
    # ... make SEED.outsider_profile a viewer of the project ...
    _auth_as(SEED.outsider_profile)
    response = await db_client.post(f"{API_PREFIX}/{run_id}/consensus", json={...})
    assert response.status_code == 403, response.text
```

Every state-changing endpoint gets one test per guard it depends on: a non-member (403), a member with the wrong role (403), and a foreign row id (the guard's refusal from the table). Pair each with a control case where the authorized caller succeeds, so the refusal cannot pass vacuously. Recipe: `web-testing/references/pytest.md` § Authorization tests.

## Historical incidents on prumo

- Commit `1994ceb fix(backend): resolve 31 auto-found bugs`: multiple endpoints in `hitl_sessions.py` and `extraction_runs.py` missing membership checks.
- Commit `7273add fix(templates): server-authoritative clone import`: the frontend inserted directly into `project_extraction_templates`; `POST /api/v1/projects/{id}/templates/clone` now owns the operation and enforces the manager check.
- PR #831: a bulk-delete endpoint mirrored its create sibling's reviewer check, while the RLS delete policy on the same table required a manager. The API was more permissive than the database on a destructive path.

When you touch any of those modules, re-run the audit. Past fixes don't immunize new code.
