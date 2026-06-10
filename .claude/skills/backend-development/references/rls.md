# Supabase RLS in prumo

This is the security model. Read it before adding a table, an endpoint, or a Celery task that writes project data.

## The two-gate model

Prumo has two paths into the database:

1. **Browser → Supabase Postgres.** Connection uses an `authenticated` JWT. RLS policies run on every query.
2. **FastAPI / Celery worker → Postgres.** Connection uses the `service_role` connection string. **RLS is bypassed.**

So the API and worker run with god-mode permissions. The browser does not. If both code paths need the same security guarantees, both gates have to be enforced — and *they have to enforce the same rule*. Otherwise you have a bypass.

Pattern: each gate calls the *same SQL helpers* (`is_project_member`, `is_project_reviewer`, `is_project_manager`). The RLS policy uses them in its `USING` / `WITH CHECK` clauses; the API calls them via `ensure_project_member` and friends in `app/api/deps/security.py`.

## The helper inventory

Defined in `backend/alembic/versions/` (see `0008_function_hardening.py` and friends). All `SECURITY DEFINER`, `STABLE`, language plpgsql. They return `boolean`.

| Helper | Returns true when |
|---|---|
| `public.is_project_member(project_id, user_id)` | user has any role in the project |
| `public.is_project_reviewer(project_id, user_id)` | user is a reviewer, consensus reviewer, or manager |
| `public.is_project_manager(project_id, user_id)` | user is a project manager |

These are the only acceptable gates. Don't inline `EXISTS (SELECT ... FROM project_members ...)` in a new policy — it makes refactoring impossible and the linter can't catch drift.

## API-side enforcement (since RLS is bypassed)

Three helpers in `app/api/deps/security.py`:

```python
# Endpoint with project_id in body:
async def open_session(body: OpenHITLSessionRequest, db: DbSession, user_sub: ...):
    await ensure_project_member(db, body.project_id, user_sub)  # 403 if not a member
    ...

# Endpoint with project_id in path — FastAPI dependency:
@router.get("/projects/{project_id}/runs")
async def list_runs(
    user_sub: Annotated[UUID, Depends(require_project_scope)],
    ...
): ...

# Manager-only operations:
@router.post("/projects/{project_id}/hitl-config")
async def set_config(
    user_sub: Annotated[UUID, Depends(require_project_manager)],
    ...
): ...
```

Forget the gate, and the endpoint is a BOLA (Broken Object Level Authorization) vulnerability — the test suite has a fixture for this; use it.

## Adding a new `public.*` table

In the same migration that creates the table:

```python
op.execute('ALTER TABLE public.my_new_table ENABLE ROW LEVEL SECURITY;')

op.execute(
    """
    CREATE POLICY "my_new_table_select" ON public.my_new_table
    FOR SELECT TO authenticated
    USING (public.is_project_member(project_id, auth.uid()));
    """
)
op.execute(
    """
    CREATE POLICY "my_new_table_insert" ON public.my_new_table
    FOR INSERT TO authenticated
    WITH CHECK (public.is_project_reviewer(project_id, auth.uid()));
    """
)
op.execute(
    """
    CREATE POLICY "my_new_table_update" ON public.my_new_table
    FOR UPDATE TO authenticated
    USING (public.is_project_reviewer(project_id, auth.uid()))
    WITH CHECK (public.is_project_reviewer(project_id, auth.uid()));
    """
)
op.execute(
    """
    CREATE POLICY "my_new_table_delete" ON public.my_new_table
    FOR DELETE TO authenticated
    USING (public.is_project_manager(project_id, auth.uid()));
    """
)
```

Conventions:
- Policy name: `<table>_<verb>` (e.g. `extraction_runs_select`).
- Always specify `TO authenticated` — leaving the role list empty opens to `anon`.
- Both `USING` (visibility) and `WITH CHECK` (write authorization) on UPDATE — they answer different questions.
- Don't write a single `FOR ALL` policy unless you genuinely need the same rule for every verb. Splitting per-verb is more flexible and easier to audit (see `0009_tighten_rls_policies.py` for the cleanup of a too-broad policy).

## Policy shapes catalog

**Project-scoped read, reviewer write, manager delete** — most common:
```sql
USING (public.is_project_member(project_id, auth.uid()))           -- SELECT
WITH CHECK (public.is_project_reviewer(project_id, auth.uid()))    -- INSERT/UPDATE
USING (public.is_project_manager(project_id, auth.uid()))          -- DELETE
```

**Owner-only writes** (e.g. feedback by the author):
```sql
WITH CHECK (user_id = auth.uid())
```

**Join through another table** (e.g. `article_author_links` → `articles` → `project_members`):
```sql
USING (
  EXISTS (
    SELECT 1
    FROM public.articles a
    WHERE a.id = article_author_links.article_id
      AND public.is_project_member(a.project_id, auth.uid())
  )
)
```

**Read-only global tables** (e.g. seeded QA templates that all users see):
```sql
FOR SELECT TO authenticated USING (true)
-- no write policies — only seed script (service role) writes
```

## Common mistakes

| Mistake | Why it breaks |
|---|---|
| `FOR ALL TO authenticated WITH CHECK (true)` | Lets anyone authenticated write anything. Real example: `feedback_reports_insert` before `0009_tighten_rls_policies.py`. |
| Forgetting `ENABLE ROW LEVEL SECURITY` | RLS is opt-in; without enabling, policies don't apply. |
| Inlining `EXISTS (...) FROM project_members` instead of `is_project_member(...)` | The helper is SECURITY DEFINER and STABLE — the inlined version isn't, and bypasses the policy on `project_members` itself. |
| Service-role from the browser | The service-role key must never reach the browser. It's in the backend env only. |
| API endpoint missing `ensure_project_member` | Bypass. The DB doesn't catch it because the API connection is service-role. |
| Bypassing RLS from a future "admin script" without calling the helper | Same bypass class. If a script writes data, it goes through the same helper or it documents in writing why it's safe. |

## Auditing

To find tables in `public` without RLS:
```sql
SELECT n.nspname, c.relname
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
```

To find policies on a table:
```sql
SELECT polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid)
FROM pg_policy
WHERE polrelid = 'public.extraction_runs'::regclass;
```

Add these as snapshots in tests when refactoring an RLS migration — diffing the dump catches accidental policy drops.
