---
status: draft
last_reviewed: 2026-07-05
owner: '@raphaelfh'
---
# Minimum-one-manager guard — design

> **Status:** Draft · Date: 2026-07-05 · Deciders: @raphaelfh
> **Incident:** a real project reached zero managers and became
> permanently locked — nobody could add members, change roles, or
> delete it.
> **Review note:** this spec was adversarially reviewed against the
> live local Postgres; the trigger volatility and lock-then-count
> shapes below were empirically verified, not assumed.

## Context — what happened and why

Project membership is not mediated by FastAPI. The frontend writes
`project_members` and deletes `projects` directly against Supabase
(PostgREST), gated only by RLS:

- `updateMemberRole` / `removeProjectMember` / `deleteProject` live in
  `frontend/services/projectSettingsService.ts`.
- Every write policy on `project_members` and the DELETE policy on
  `projects` require `is_project_manager(project_id, auth.uid())`
  (`backend/alembic/versions/baseline_v1.sql`).

Nothing prevents the last manager from being removed or demoted. Once a
project has zero `role = 'manager'` rows, **every** recovery path is
itself manager-gated, so the project is bricked. No "last manager"
guard exists anywhere in the codebase today.

Schema facts that ground the design (verified against
`backend/app/models/project.py` and `baseline_v1.sql:1052-1063`):

- `projects.created_by_id` is `NOT NULL` with `ON DELETE RESTRICT` —
  every project has a guaranteed-present creator.
- The `project_members.invitation_*` columns are dead (no write path in
  backend or frontend), and `user_id` is `NOT NULL` — every
  `role = 'manager'` row is a real, actionable user. Counting
  `role = 'manager'` rows is therefore the correct invariant predicate.
- The deployed DDL has **server defaults** for `id`
  (`gen_random_uuid()`), `role` (`'reviewer'`), `permissions`
  (`'{"can_export": false}'`), `created_at` and `updated_at` (the ORM
  *additionally* carries client-side defaults, but raw SQL does not
  depend on them).

## Decision

Enforce the invariant in the database (the only layer all writers pass
through), heal existing violations in the same migration, and add a
frontend affordance so users normally never hit the DB error.

Alternatives rejected:

- **Frontend-only guard** — bypassable by any direct PostgREST call;
  would not have prevented the incident.
- **Move membership mutations behind FastAPI endpoints** — large rewrite
  of a working RLS path; disproportionate to the problem (YAGNI).

## Design

### 1. Database trigger (Alembic migration, raw `op.execute`)

A `BEFORE UPDATE OR DELETE` row trigger on `public.project_members`,
backed by a `SECURITY DEFINER` function with `SET search_path =
public`, so the manager count is not clipped by the caller's RLS
visibility.

**Volatility — deliberate deviation from the helpers.** The existing
`is_project_member` / `is_project_manager` helpers are declared
`STABLE`; this function must be **`VOLATILE`** (the plpgsql default —
declare no volatility keyword) because its body takes `FOR UPDATE` row
locks, which PostgreSQL rejects at runtime inside non-volatile
functions (`SELECT FOR UPDATE is not allowed in a non-volatile
function` — reproduced on the local database). Do not copy the
helpers' `STABLE` keyword.

Guard condition — the check runs only when the operation could reduce
the manager count of `OLD.project_id`:

- `TG_OP = 'DELETE'` and `OLD.role = 'manager'`, or
- `TG_OP = 'UPDATE'` and `OLD.role = 'manager'` and
  (`NEW.role <> 'manager'` or `NEW.project_id <> OLD.project_id`).

When the guard applies, the function:

1. **Cascade carve-out:** if the parent project row no longer exists
   (`SELECT 1 FROM public.projects WHERE id = OLD.project_id` finds
   nothing — the case during `projects` → `project_members` CASCADE
   delete), skip the check and allow the row to go.
2. **Lock-then-count.** `FOR UPDATE` cannot be combined with
   aggregates (`FOR UPDATE is not allowed with aggregate functions` —
   verified locally), so the locking and counting are layered:

   ```sql
   SELECT count(*) INTO v_survivors FROM (
     SELECT 1 FROM public.project_members
     WHERE project_id = OLD.project_id
       AND id <> OLD.id
       AND role = 'manager'
     FOR UPDATE
   ) s;
   ```

   The locked rows are exactly the counted rows, which is what makes
   the concurrency argument below hold.
3. If `v_survivors = 0`, raise with a **custom SQLSTATE** the frontend
   can match on (mirroring the existing `42501` handling):

   ```sql
   RAISE EXCEPTION 'a project must retain at least one manager'
     USING ERRCODE = 'PM001';
   ```

The trigger does not fire on INSERT (inserts cannot reduce the count).

### 2. Data heal (same migration, before the trigger is created)

For every project with zero `role = 'manager'` member rows, make its
creator a manager:

- If `created_by_id` already has a membership row → `UPDATE` it to
  `role = 'manager'`.
- Otherwise → `INSERT INTO project_members (project_id, user_id, role)
  VALUES (…, …, 'manager')`. Server defaults cover `id`,
  `permissions`, `created_at` and `updated_at`
  (`baseline_v1.sql:1052-1063`); `created_by_id` is nullable and stays
  NULL for a system-initiated heal.

This is idempotent, runs automatically on deploy (Alembic runs on
Railway deploys), and unbricks the currently-stuck project with no
manual SQL. `downgrade()` drops the trigger and function only; the heal
is not reverted (restoring a broken state is not a rollback goal).

### 3. ORM coherence (`backend/app/models/project.py`, one line)

`Project.members` carries `cascade="all, delete-orphan"` **without**
`passive_deletes=True`. An ORM-level `session.delete(project)` would
therefore delete member rows first, *while the project row still
exists* — defeating the cascade carve-out and raising `PM001`. No
backend code deletes projects via the ORM today, but the combination
is now a loaded footgun. Add `passive_deletes=True` to
`Project.members` so SQLAlchemy defers to the DB-level `ON DELETE
CASCADE` (the path the carve-out is designed for). No migration —
ORM-side behavior only.

### 4. Frontend affordance (`TeamMembersSection.tsx`)

- Compute `managerCount` from the already-loaded `members` state.
- For a member who is the **sole** manager (`role === 'manager' &&
  managerCount === 1`), exactly this behavior:
  - the **Remove** button is disabled, wrapped in a shadcn `Tooltip`
    with a new copy key ("A project must keep at least one manager");
  - the role **Select stays openable**, but the three non-manager
    `SelectItem`s are disabled, with the same tooltip copy on the
    select trigger.
- **Error fallback.** The services return `ErrorResult` and never
  surface DB messages; the component already branches on
  `PgError.code === '42501'` (`TeamMembersSection.tsx:66`). Extend
  `handleSaveRole` and `handleRemoveMember` to match
  `PgError.code === 'PM001'` and toast the same dedicated copy key —
  covering stale-UI or concurrent-edit races that reach the trigger.
- All copy goes through `frontend/lib/copy/` (no hardcoded strings).

No new endpoints, no RLS policy change.

## Edge cases and consequences

- **Project deletion still works.** The cascade carve-out admits
  member-row deletes that are part of deleting the project itself
  (DB-level cascade: the project row is already gone when the member
  trigger runs).
- **Profile deletion is now blocked for sole managers.** `user_id` has
  `ON DELETE CASCADE` from `profiles`; deleting a profile that is the
  last manager of a live project will raise. This is intentional — it
  converts silent re-bricking into an explicit error that forces
  manager reassignment first. There is no account-deletion flow in the
  app, so no product path regresses.
- **Existing test fixtures comply.** All six integration fixtures that
  `DELETE FROM public.profiles` were audited: four delete *outsider*
  profiles with zero memberships
  (`test_membership_guards.py`, `test_run_resolution_endpoints.py`,
  `test_suggestion_read.py`, `test_article_text_blocks_endpoint.py`,
  `test_run_view_endpoint.py`), and `test_hitl_session.py` deletes the
  project before the profile. **Rule for future fixtures:** delete
  projects before their member profiles.
- **Concurrency (TOCTOU).** Two simultaneous "demote/remove the other
  manager" transactions each see the other as remaining under a naive
  count. Because the counted rows are the locked rows (step 2), the
  second transaction blocks on the first's lock, re-reads after it
  commits, sees zero survivors, and fails. A mutual demotion can
  deadlock; Postgres resolves it by aborting one transaction — the
  invariant holds either way.
- **Seeds.** `app.seed` and the integration SEED fixture only create
  members; the trigger constrains UPDATE/DELETE, so creation flows are
  unaffected.

## Testing

Backend (pytest, real local Supabase Postgres — triggers are invisible
to mocks):

- Deleting the last manager's membership row → raises `PM001`; with a
  second manager present → succeeds.
- Demoting the last manager (`UPDATE role`) → raises; with a second
  manager → succeeds.
- Moving the sole manager to another project (`UPDATE project_id`) →
  raises.
- Deleting a project with exactly one manager → succeeds (cascade
  carve-out).
- Deleting a profile that is the sole manager of a live project →
  raises; deleting an outsider profile → succeeds.
- TOCTOU: two raw connections concurrently demote the last two
  managers of one project → exactly one fails, ≥ 1 manager row
  remains.
- Heal: build a zero-manager project (direct SQL, pre-trigger state),
  run the heal statement, assert the creator's row is
  `role = 'manager'` — both variants (existing row promoted, missing
  row inserted) — and running the heal twice changes nothing
  (idempotent).

Frontend (vitest, component):

- Sole manager row: Remove disabled with tooltip; role select openable
  with non-manager options disabled.
- With two managers, both rows keep Remove/demote enabled.
- A `PgError` with code `PM001` from remove/save-role toasts the
  dedicated copy message.

## Non-goals

- No quorum/multi-manager policy (`reviewer_count` / consensus config
  stays display-only).
- No migration of membership CRUD into FastAPI.
- No revival of the dead `invitation_*` columns.
