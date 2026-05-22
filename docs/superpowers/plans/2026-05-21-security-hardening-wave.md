# Security Hardening Wave — 2026-05-21

> **For executor:** Tasks below are self-contained. Run them in order; each
> ends with a verification step. The migrations in this wave land together
> in one PR so production RLS state stays consistent.

**Goal:** Close three Supabase advisor warnings flagged by the user (BOLA-like
RLS policy on `article_authors`, broad email→UUID enumeration via
`find_user_id_by_email`, missing RLS on `alembic_version`) and document the
dashboard step for the auth `leaked_password_protection` toggle.

**Architecture:** Two Alembic migrations on top of `0017`:

- `0018_lock_article_authors_insert.py` — drops the `WITH CHECK (true)`
  INSERT policy on `article_authors` (the backend is the only writer, via
  service-role bypass; the frontend never inserts directly) and enables RLS
  on `alembic_version` with deny-all policies for authenticated/anon.
- `0019_gate_find_user_id_by_email.py` — redefines
  `find_user_id_by_email` to require `p_project_id` and reject callers
  that are not project managers, eliminating the broad enumeration surface.

Frontend ships one matching change in `TeamMembersSection.tsx` to pass the
new parameter, plus regenerated Supabase types.

**Tech Stack:** Alembic, SQLAlchemy 2.0, FastAPI (no API surface change),
React + Supabase JS RPC, Render Blueprint.

---

## Out of scope (documented, not coded)

- **Render worker + Redis approval** — user-side action in Render
  Dashboard → Blueprints → Apply changes (blueprint already shipped in
  `7186fbc`).
- **Auth `leaked_password_protection`** — cannot be toggled via SQL or
  the Supabase MCP; user must enable it via Dashboard
  (`Authentication → Providers → Email`, toggle "Prevent compromised
  passwords"). After enabling, re-run advisors to confirm.
- **CI seed for BOLA tests** — already validated. `af255bb` is on `main`
  and CI is green on the latest runs for both `dev` and `main` (run
  IDs 26263274779 / 26263270567 at 2026-05-22T01:34Z).

---

## Task 1: Migration 0018 — lock `article_authors_insert` + `alembic_version` RLS

**Files:**
- Create: `backend/alembic/versions/0018_lock_article_authors_and_alembic_version.py`

**Context:** `article_authors` is inserted exclusively by the backend via
`ArticleAuthorRepository` (`backend/app/repositories/article_author_repository.py`).
The frontend uses `supabase.from('article_authors').insert(...)` zero times
(verified with grep). The current INSERT policy was added in `0009` with
`WITH CHECK (true)` because authors are inserted before any link exists, but
since the backend uses the service role it bypasses RLS regardless. Drop the
policy → authenticated cannot INSERT, service role still can. SELECT
remains gated by the article_author_links → articles → project_members
chain (added by the original Zotero migration).

The `alembic_version` table is created by Alembic itself and has RLS
disabled (flagged as ERROR-level by the advisor). Enable RLS and add no
policies — that denies all non-bypassing roles. The service role used by
the Alembic process bypasses RLS so `alembic upgrade head` keeps working.

- [ ] **Step 1: Create the migration**

```python
"""lock article_authors_insert and enable RLS on alembic_version

Revision ID: 0018_lock_article_authors_and_alembic_version
Revises: 0017_backfill_role_in_snapshot
Create Date: 2026-05-21

Two Supabase advisor warnings closed here:

1. ``rls_policy_always_true`` on ``public.article_authors``: the
   ``article_authors_insert`` policy was ``WITH CHECK (true)``, letting any
   authenticated user INSERT (BOLA-like). The backend is the only writer
   (via ``ArticleAuthorRepository``); it uses the service role which
   bypasses RLS. The frontend never INSERTs directly. Drop the policy so
   authenticated cannot INSERT at all.

2. ``rls_disabled_in_public`` (ERROR) on ``public.alembic_version``:
   Alembic creates this table without RLS. Enable RLS and add no policies
   — authenticated/anon cannot read/write; the service role used by the
   migration runner bypasses RLS, so ``alembic upgrade head`` keeps
   working.
"""

from alembic import op

revision = "0018_lock_article_authors_and_alembic_version"
down_revision = "0017_backfill_role_in_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- article_authors: lock INSERT --------------------------------------
    # SELECT/UPDATE/DELETE policies stay; they already gate by membership.
    op.execute('DROP POLICY IF EXISTS "article_authors_insert" ON public.article_authors;')

    # --- alembic_version: enable RLS, deny all non-bypassing -------------
    op.execute("ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY;")


def downgrade() -> None:
    op.execute("ALTER TABLE public.alembic_version DISABLE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY "article_authors_insert" ON public.article_authors
        FOR INSERT TO authenticated WITH CHECK (true);
        """
    )
```

- [ ] **Step 2: Apply locally and verify**

```bash
cd backend && uv run alembic upgrade head
```

Expected: `INFO  [alembic.runtime.migration] Running upgrade
0017_backfill_role_in_snapshot -> 0018_lock_article_authors_and_alembic_version`.

- [ ] **Step 3: Smoke-check the policy state**

```bash
psql "$DATABASE_URL" -c "SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.article_authors'::regclass ORDER BY polname;"
psql "$DATABASE_URL" -c "SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'alembic_version';"
```

Expected: `article_authors_insert` absent; `relrowsecurity = t` for
`alembic_version`.

---

## Task 2: Migration 0019 — gate `find_user_id_by_email`

**Files:**
- Create: `backend/alembic/versions/0019_gate_find_user_id_by_email.py`

**Context:** The current function returns `auth.users.id` for any email
input. Any authenticated user can hit
`/rest/v1/rpc/find_user_id_by_email` and enumerate the user-by-email
mapping. The new signature accepts a `p_project_id` and refuses unless the
caller is a project manager — a manager already sees all member emails
via `get_project_members`, so this collapses the enumeration surface to a
set the caller already has access to.

We use `CREATE OR REPLACE FUNCTION` with the new argument list. Postgres
treats `(p_email text)` and `(p_email text, p_project_id uuid)` as
distinct overloads, so we explicitly `DROP FUNCTION` the old one to
prevent the unprotected version from lingering.

- [ ] **Step 1: Create the migration**

```python
"""gate find_user_id_by_email by project_id + manager check

Revision ID: 0019_gate_find_user_id_by_email
Revises: 0018_lock_article_authors_and_alembic_version
Create Date: 2026-05-21

Supabase advisor flagged
``authenticated_security_definer_function_executable`` on
``public.find_user_id_by_email(p_email text)`` — any signed-in user can
enumerate ``auth.users`` UUIDs by email via
``/rest/v1/rpc/find_user_id_by_email``.

Replace the single-arg overload with a two-arg version that takes
``p_project_id`` and rejects callers that are not project managers of
that project. Managers already see all member emails through
``get_project_members``, so this collapses the enumeration surface to
data the caller already has.

The frontend ``TeamMembersSection`` is updated in the same PR to pass
``p_project_id`` alongside ``p_email``.
"""

from alembic import op

revision = "0019_gate_find_user_id_by_email"
down_revision = "0018_lock_article_authors_and_alembic_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS public.find_user_id_by_email(text);")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.find_user_id_by_email(
            p_email text,
            p_project_id uuid
        )
        RETURNS uuid
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_catalog
        AS $fn$
        BEGIN
          IF NOT public.is_project_manager(p_project_id, auth.uid()) THEN
            RAISE EXCEPTION 'forbidden: caller is not a manager of the target project'
              USING ERRCODE = '42501';
          END IF;
          RETURN (
            SELECT id FROM auth.users WHERE email = p_email LIMIT 1
          );
        END;
        $fn$;
        """
    )

    op.execute(
        "REVOKE EXECUTE ON FUNCTION "
        "public.find_user_id_by_email(text, uuid) FROM anon, PUBLIC;"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION "
        "public.find_user_id_by_email(text, uuid) TO authenticated;"
    )


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS public.find_user_id_by_email(text, uuid);")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email text)
        RETURNS uuid
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_catalog
        AS $fn$
        BEGIN
          RETURN (
            SELECT id FROM auth.users WHERE email = p_email LIMIT 1
          );
        END;
        $fn$;
        """
    )
    op.execute(
        "REVOKE EXECUTE ON FUNCTION "
        "public.find_user_id_by_email(text) FROM anon, PUBLIC;"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION "
        "public.find_user_id_by_email(text) TO authenticated;"
    )
```

- [ ] **Step 2: Apply locally**

```bash
cd backend && uv run alembic upgrade head
```

Expected: migration succeeds.

- [ ] **Step 3: Verify function signature**

```bash
psql "$DATABASE_URL" -c "\df public.find_user_id_by_email"
```

Expected: one row, argument list `p_email text, p_project_id uuid`.

---

## Task 3: Frontend RPC update + types regen

**Files:**
- Modify: `frontend/components/project/settings/TeamMembersSection.tsx:64-66`
- Modify: `frontend/integrations/supabase/types.ts` (generated)

- [ ] **Step 1: Update the RPC call**

Replace the call in `TeamMembersSection.tsx:64-66`:

```typescript
const {data: userId, error: rpcError} = await supabase.rpc('find_user_id_by_email', {
    p_email: email,
    p_project_id: projectId,
});
```

`projectId` is already a prop on the component.

- [ ] **Step 2: Map the forbidden error to a translation key**

Inside the `if (rpcError)` branch (currently lines 67-71), surface the
manager-only restriction with a clearer toast when Postgres returns
`42501` (insufficient_privilege):

```typescript
if (rpcError) {
    console.error('Error finding user:', rpcError);
    if (rpcError.code === '42501') {
        toast.error(t('project', 'teamErrorOnlyManagersInvite'));
    } else {
        toast.error(t('project', 'teamErrorFindingUser'));
    }
    return;
}
```

Add the new translation key in `frontend/lib/copy/sections/project.ts`
under the `team*` group with text "Only project managers can invite
members." (English) / "Apenas managers do projeto podem convidar
membros." (Portuguese), following the existing pattern in that file.

- [ ] **Step 3: Regenerate Supabase types**

```bash
cd frontend && npx supabase gen types typescript \
  --project-id gdfslcfeobjdxihqtcsk \
  --schema public \
  > integrations/supabase/types.ts
```

If the user does not have a logged-in Supabase CLI, fall back to manual
edit of `types.ts` line ~2052:

```typescript
find_user_id_by_email: {
  Args: { p_email: string; p_project_id: string };
  Returns: string;
};
```

- [ ] **Step 4: Lint + typecheck**

```bash
cd frontend && npm run lint && npx tsc --noEmit
```

Expected: zero errors.

---

## Task 4: Local validation

- [ ] **Step 1: Full backend test suite**

```bash
make test-backend
```

Expected: green. No HITL or membership test regressions.

- [ ] **Step 2: Backend lint**

```bash
make lint-backend
```

Expected: ruff format clean, ruff check clean.

- [ ] **Step 3: Frontend tests**

```bash
cd frontend && npm test
```

Expected: green.

---

## Task 5: Apply migrations to Supabase production

Use the Supabase MCP to push the two migrations to the live project
(`gdfslcfeobjdxihqtcsk`). This is in addition to Alembic upgrading on
Render at deploy time — the MCP path is the source of truth that the
advisor lints scan.

- [ ] **Step 1: Apply 0018 via MCP**

Call `mcp__supabase__apply_migration`:
- name: `0018_lock_article_authors_and_alembic_version`
- query: the SQL body of `def upgrade()` from Task 1, with no Python.

- [ ] **Step 2: Apply 0019 via MCP**

Call `mcp__supabase__apply_migration`:
- name: `0019_gate_find_user_id_by_email`
- query: the SQL body of `def upgrade()` from Task 2.

- [ ] **Step 3: Re-run advisors**

Call `mcp__supabase__get_advisors` with `type=security`. Confirm:
- `rls_policy_always_true` for `article_authors` is **gone**.
- `rls_disabled_in_public` for `alembic_version` is **gone**.
- `authenticated_security_definer_function_executable` for
  `find_user_id_by_email` may still show (the function is still
  callable by authenticated, by design — but the actual enumeration
  is now gated by the manager check, documented in the migration).

---

## Task 6: Commit, push, merge, deploy

- [ ] **Step 1: Stage + commit**

```bash
git add backend/alembic/versions/0018_*.py \
        backend/alembic/versions/0019_*.py \
        frontend/components/project/settings/TeamMembersSection.tsx \
        frontend/integrations/supabase/types.ts \
        frontend/lib/copy/sections/project.ts \
        docs/superpowers/plans/2026-05-21-security-hardening-wave.md
git commit -m "$(cat <<'EOF'
fix(security): lock article_authors INSERT + gate find_user_id_by_email + enable RLS on alembic_version

Closes three Supabase advisor findings:

- BOLA-like RLS policy article_authors_insert (WITH CHECK true) → drop
  the policy; the backend is the only writer via service role.
- find_user_id_by_email enumerated user UUIDs by email for any
  authenticated caller → new signature requires p_project_id and rejects
  non-managers; matching frontend RPC call updated.
- alembic_version was publicly readable (ERROR-level rls_disabled_in_public)
  → ALTER TABLE … ENABLE ROW LEVEL SECURITY (no policies = deny-all for
  non-bypassing roles; service-role Alembic runner unaffected).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Push to dev, wait for CI**

```bash
git push origin dev
gh run watch
```

Expected: CI green.

- [ ] **Step 3: Merge to main**

```bash
git checkout main && git pull
git merge --no-ff dev -m "Merge dev: security hardening (article_authors, find_user_id_by_email, alembic_version)"
git push origin main
```

- [ ] **Step 4: Watch Render deploy**

```bash
gh run watch  # CI on main
# Then in Render dashboard, confirm review-hub-backend deploy succeeds and /health returns 200.
curl -fsS https://review-hub-backend.onrender.com/health
```

Expected: `{"status":"ok"}` (or whatever the health endpoint returns).

- [ ] **Step 5: Sanity-check the invite flow in prod**

Open `https://<frontend>`, go to a project settings → team → invite a
member. Confirm: success path works for a real email, "forbidden"
toast appears for a non-manager (best confirmed via the existing
project_members row, no second account needed).

- [ ] **Step 6: Switch back to dev**

```bash
git checkout dev
```

---

## Task 7: Document the leaked_password_protection step

Once everything above is deployed, point the user at:
`https://supabase.com/dashboard/project/gdfslcfeobjdxihqtcsk/auth/providers`
→ Email provider → toggle "Prevent the use of compromised passwords"
ON → Save. Then re-run advisors to confirm `auth_leaked_password_protection`
is gone.

---

## Self-review checklist

- [x] Both migrations follow the monotonic numbering convention (`0018_`,
  `0019_` extending the current head `0017_`).
- [x] No new endpoint surface; frontend change is one prop + one new
  translation key.
- [x] The downgrade of each migration is reversible.
- [x] No silent prod data mutation — the only data touched is policy /
  function definitions.
- [x] Render worker/Redis is out of scope (already in blueprint, awaiting
  user approval).
- [x] BOLA test CI seed validated as already in production.
