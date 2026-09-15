# RLS review checklist (prumo)

RLS (Row-Level Security) on PostgreSQL via Supabase is prumo's defense-in-depth layer. Even when the API guards are correct (`bola-audit.md`), RLS makes leakage through the browser client impossible at the DB level. Even when RLS is correct, the API guard gives a clean 403/404. **You want both, always.**

## When this matters

Any PR that touches:

- `backend/alembic/versions/*` adding a new table.
- `backend/alembic/versions/*` altering an existing RLS policy.
- `supabase/migrations/*` (storage / auth policies).
- The shape of `project_members`, `extraction_reviewer_states`, or any role table.

…requires an RLS review.

## The standard pattern

The helper inventory, the per-verb policy template and the policy shapes live in `backend-development/references/rls.md`. Every policy gates through `public.is_project_*(project_id, auth.uid())`; an inline `EXISTS (... FROM project_members ...)` is a finding.

## Checklist

- [ ] **RLS is enabled on every project-scoped table.** `ENABLE ROW LEVEL SECURITY` runs as part of the migration that creates the table, not "later".
- [ ] **There is at least one policy per access pattern** (SELECT / INSERT / UPDATE / DELETE). A table with RLS enabled but zero policies denies everything — usually unintentional.
- [ ] **Policies call the `public.is_project_*(project_id, auth.uid())` helpers.** They do not inline `FROM project_members`, reference raw user IDs, or defer the check to the application layer.
- [ ] **The policy is symmetric with the API guard.** If `ensure_project_member` allows read for any member, RLS should too. If the API enforces manager-only write, the RLS write policy should match.
- [ ] **Policies for indirect tables resolve through the parent.** E.g. `extraction_reviewer_decisions` joins via `run_id → runs.project_id`. Do not duplicate `project_id` to dodge the join unless the duplication is enforced by an FK + trigger.
- [ ] **Tests cover the negative case.** A non-member who runs the query directly should get an empty result, not an error.
- [ ] **The migration documents intent.** PR body says "this table is reviewer-write because X". A reviewer should not have to reconstruct the access matrix from the SQL.

## Common RLS pitfalls on prumo

1. **Forgot to enable RLS at all.** Easy to miss; the table is created and policies are added but `ENABLE ROW LEVEL SECURITY` was omitted. Result: policies exist but are not enforced. Always grep:
   ```sh
   grep -A2 "CREATE TABLE" backend/alembic/versions/<file> | grep -c "ENABLE ROW LEVEL SECURITY"
   ```
2. **`USING` vs `WITH CHECK` confusion.** `USING` is read-side; `WITH CHECK` is write-side. UPDATE needs both. INSERT only takes `WITH CHECK`. One `CREATE POLICY` covers one command (or `FOR ALL`).
3. **Policy too permissive.** E.g. `USING (true)` "just for now". Migration ships, becomes permanent. Reject.
4. **Service-role bypass not justified.** The API and worker connect as service role and bypass RLS. That is fine only because the API guards (`bola-audit.md`) then bind every id. Service-role code without a guard is the bug.
5. **Storage policies forgotten.** When you add a new bucket in `supabase/migrations/`, ship the bucket policies in the same migration.

## Relaxation review

If a PR **relaxes** an RLS policy (e.g. lets reviewers write where only managers could), the PR body must answer:

1. Who gains access?
2. What is the new attack surface? (Spelled out: "a reviewer can now overwrite another reviewer's decision in the same run". Worth it?)
3. Is there an audit log? Workflow tables on prumo typically have `updated_by` + `updated_at` for exactly this.
4. Is the corresponding application-layer check still tight, or did it relax in lockstep?

Templates: `backend/alembic/versions/archive/20260428_0018_is_project_reviewer_rls.py` (reviewer-write relaxation) and `0025_reviewer_scoped_select_rls.py` (the `is_project_arbitrator` helper).

## Test patterns

RLS only runs when the query executes as `authenticated` with a real JWT subject; a test on the default service-role session tests nothing about RLS. The working pattern, inside a transaction that rolls back: `SELECT set_config('request.jwt.claims', :claims, true)` then `SET LOCAL ROLE authenticated` (`backend/tests/integration/test_llm_connection_rls.py`).

Assert the negative case as an empty result for SELECT and a refused write for INSERT/UPDATE, next to a control case where a member succeeds.

## See also

- `docs/reference/migrations.md` — RLS conventions section.
- `backend-development/references/rls.md` — helpers, policy shapes, the service-role model.
