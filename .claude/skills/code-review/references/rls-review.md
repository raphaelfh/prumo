# RLS review checklist (prumo)

RLS (Row-Level Security) on PostgreSQL via Supabase is prumo's defense-in-depth layer. Even when the application-layer auth check (`ensure_project_member`) is correct, RLS makes data leakage impossible at the DB level. Even when RLS is correct, the app check gives a clean 403. **You want both, always.**

## When this matters

Any PR that touches:

- `backend/alembic/versions/*` adding a new table.
- `backend/alembic/versions/*` altering an existing RLS policy.
- `supabase/migrations/*` (storage / auth policies).
- The shape of `project_memberships`, `extraction_reviewer_states`, or any role table.

…requires an RLS review.

## The standard pattern

```sql
ALTER TABLE <new_table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "<table>_member_read" ON <new_table>
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project_memberships m
            WHERE m.project_id = <new_table>.project_id
              AND m.user_id = auth.uid()
        )
    );

CREATE POLICY "<table>_reviewer_write" ON <new_table>
    FOR INSERT WITH CHECK ( is_project_reviewer(<new_table>.project_id) )
    FOR UPDATE USING ( is_project_reviewer(<new_table>.project_id) );
```

Reference helper: `is_project_reviewer` added in migration `0018`.

## Checklist

- [ ] **RLS is enabled on every project-scoped table.** `ENABLE ROW LEVEL SECURITY` runs as part of the migration that creates the table, not "later".
- [ ] **There is at least one policy per access pattern** (SELECT / INSERT / UPDATE / DELETE). A table with RLS enabled but zero policies denies everything — usually unintentional.
- [ ] **Policies use `auth.uid()`** and reference `project_memberships` (or the role helpers). They do not reference raw user IDs or accept policy-via-application-layer.
- [ ] **The policy is symmetric with the application check.** If `ensure_project_member` allows read for any member, RLS should too. If the app enforces manager-only write, the RLS write policy should match.
- [ ] **Policies for indirect tables resolve through the parent.** E.g. `extraction_reviewer_decisions` joins via `run_id → runs.project_id`. Do not duplicate `project_id` to dodge the join unless the duplication is enforced by an FK + trigger.
- [ ] **Tests cover the negative case.** A non-member who runs the query directly should get an empty result, not an error.
- [ ] **The migration documents intent.** PR body says "this table is reviewer-write because X". A reviewer should not have to reconstruct the access matrix from the SQL.

## Common RLS pitfalls on prumo

1. **Forgot to enable RLS at all.** Easy to miss; the table is created and policies are added but `ENABLE ROW LEVEL SECURITY` was omitted. Result: policies exist but are not enforced. Always grep:
   ```sh
   grep -A2 "CREATE TABLE" backend/alembic/versions/<file> | grep -c "ENABLE ROW LEVEL SECURITY"
   ```
2. **`USING` vs `WITH CHECK` confusion.** `USING` is read-side; `WITH CHECK` is write-side. UPDATE needs both. INSERT only takes `WITH CHECK`.
3. **Policy too permissive.** E.g. `USING (true)` "just for now". Migration ships, becomes permanent. Reject.
4. **Service-role bypass not justified.** Backend service role bypasses RLS. That is fine for backend logic — but only because the backend then enforces `ensure_project_member`. If a piece of code uses the service role and doesn't auth-check, that's the bug.
5. **Storage policies forgotten.** When you add a new bucket in `supabase/migrations/`, ship the bucket policies in the same migration.

## Relaxation review

If a PR **relaxes** an RLS policy (e.g. lets reviewers write where only managers could), the PR body must answer:

1. Who gains access?
2. What is the new attack surface? (Spelled out: "a reviewer can now overwrite another reviewer's decision in the same run". Worth it?)
3. Is there an audit log? Workflow tables on prumo typically have `updated_by` + `updated_at` for exactly this.
4. Is the corresponding application-layer check still tight, or did it relax in lockstep?

Migration `0018` did this correctly — read its PR + migration body for the template.

## Test patterns

```python
async def test_rls_blocks_non_member_select(db, non_member_session):
    rows = await non_member_session.execute(
        select(SomeModel).where(SomeModel.project_id == some_project.id)
    )
    assert rows.scalars().all() == []  # not an exception — just empty

async def test_rls_blocks_non_member_write(db, non_member_session):
    with pytest.raises(IntegrityError | PermissionError):
        await non_member_session.execute(
            insert(SomeModel).values(project_id=some_project.id, ...)
        )
        await non_member_session.commit()
```

Run these with a session that authenticates as the non-member user, not the service role. A test that uses the service role is testing nothing about RLS.

## See also

- `docs/reference/migrations.md` — RLS conventions section.
- Migration `0018` — the `is_project_reviewer` helper and reviewer-write relaxations.
