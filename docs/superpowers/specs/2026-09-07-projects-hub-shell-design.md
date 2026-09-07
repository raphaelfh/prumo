---
status: in_progress
last_reviewed: 2026-09-07
owner: '@raphaelfh'
---

# Projects hub and the unified app shell — design

> The entry route `/` renders a different chrome from the rest of the app: no
> sidebar, no account menu, no theme toggle, no way to reach `/settings`. This
> design gives every authenticated route one shell, and turns `/` into the
> surface where projects are actually managed.

## 1. Problem

Three chromes exist today:

| Route | Layout | Sidebar | Footer (account/theme/feedback) |
|---|---|---|---|
| `/` | `AppLayout` | none | unreachable |
| `/projects/:id` | `ProjectLayout` | `ProjectSidebar` | present |
| `/settings` | neither | none | unreachable |

Consequences, all observable today:

- The account menu, theme toggle and feedback button live in
  `SidebarFooter`, which only mounts inside a project. A user on `/` cannot
  reach any of them without opening a project first.
- `/settings` renders its own `PageHeader` with a back arrow — a third
  navigation model.
- The project list offers exactly one action: create. There is no archive,
  search, sort or filter, so the list can only grow.
- Each row renders a green dot bound to `projects.is_active`. Nothing in the
  codebase ever writes that column, so the dot is always on and carries no
  information.
- The row's only metadata is a creation date, and empty descriptions render
  the literal string "No additional description".

## 2. Decisions

Settled with the user during brainstorming:

| Question | Decision |
|---|---|
| What is `/`? | A projects hub. No auto-redirect to the last project. |
| Shell structure | One shell, two states (rejected: icon rail; minimal patch). |
| Sidebar on `/` | Workspace nav only — **no** project list. |
| Hub row layout | Evolved list (rejected: table; grouped-by-pinned). |
| Management actions | Archive/restore, search, sort. |
| Pin / recent | **Deferred** — requires a migration the user chose to skip. |
| Rename, delete, duplicate | Out of scope. |

### 2.1 The deferred-pin tension

The user initially scoped in "Pin + search/sort", then chose "workspace nav
only, skip the migration". Pin is per-user state and its only correct home is
`project_members`, which needs two nullable columns. Storing pins in
`localStorage` was considered and rejected: it makes pinning a per-device lie
— a second machine shows different pins, and any "recent" sort silently
disagrees with itself.

Pin therefore ships in a **later slice**, together with `pinned_at` and
`last_opened_at`. Search, sort and archive need no schema change and ship now.

## 3. Architecture

### 3.1 One shell, derived from the URL

A new `AppShell` wraps every authenticated route (`/`, `/projects/:projectId`,
`/settings`) inside the existing `SidebarProvider`, which is already
global-safe (generic, `localStorage`-backed, cross-tab synced).

**`AppShell` must not consume `ProjectContext`.** `ProjectProvider` writes
`?tab=` to the URL in an effect on mount, and its own source comment warns
that mounting it around a component that redirects on mount clobbers the
redirect. It therefore stays exactly where it is, wrapping `ProjectView`
alone.

The shell instead derives its state from the URL:

- active project id — `matchPath('/projects/:projectId/*', location.pathname)`
- active section — the `?tab=` search param, read-only

Both work at any depth under `BrowserRouter`, with no provider dependency.

### 3.2 Navigation inverts to URL-driven

The sidebar navigates by writing the URL (`/projects/:id?tab=extraction`)
rather than calling a prop-drilled `onTabChange`. `ProjectContext` already
syncs `activeTab` *from* the URL during render, so it follows without change.

`MobileSidebar` and `useNavigationShortcuts` are rewired to the same
URL-driven path, which removes the `onTabChange` prop chain. This is a
refactor of code the change already touches, not an unrelated cleanup.

### 3.3 Out of scope

The full-screen run routes (`/projects/:id/extraction/:articleId`,
`.../quality-assessment/:templateId`) keep `RunWorkspaceShell` — a focus shell
with `persist: false`, collapsed by default. Folding those into `AppShell` is a
separate question and is **not** part of this design.

## 4. The sidebar

Two states, one chrome. All existing primitives are reused unchanged:
`ResizablePanel` at the documented 280 / 240 / 400 / 150, `SidebarSection`,
`SidebarNavItem`, `SidebarFooter`, `KbdBadge` with reveal-on-hover. No new
visual primitives and no deviation from
`docs/superpowers/design-system/sidebar-and-panels.md`.

**No project open** (`/`, `/settings`):

- Header: brand (`R` badge + "Prumo"), `h-12`.
- Section `WORKSPACE`: **Projects** (`G H`), **Settings** (`⌘,`).
- Footer: `SidebarFooter`, unchanged.

**Project open** (`/projects/:id`):

- Header: today's `SidebarHeader` project switcher (`G P`).
- Sections: today's `sidebarSections` — Project and Review — unchanged.
- Footer: identical.

The footer being constant across both states is what makes the account menu,
theme toggle and feedback button reachable from the hub.

### 4.1 Shortcuts

`G P` is already bound to the project switcher and `⌘,` already opens
`/settings` (`useGlobalShortcuts`). The hub therefore takes **`G H`**, which is
free. Workspace bindings are active on every route; project bindings only when
a project id matches.

## 5. The hub

Header (`h-12`, sticky, reusing the current dashboard header chrome): title,
search input, an Active/Archived filter, a sort control, and the existing New
Project button.

Row anatomy stays as it is today, with three subtractions and one substitution:

- **The green dot is removed.** Once `is_active` means active-vs-archived, a
  dot on every visible row encodes nothing. Archived rows instead render muted
  with an `Archived` badge, and only when the filter shows them.
- **The "No additional description" filler is removed.** An empty line is
  quieter than a sentence announcing emptiness.
- **`CREATED <date>` becomes `Updated <relative>`**, sourced from
  `projects.updated_at`. See §6.2 — this column is trigger-maintained, so the
  value is real. It is deliberately *not* labelled "Opened": per-user open
  tracking does not exist until the deferred migration lands.
- **Row hover reveals a `⋯` menu** containing Archive / Restore only. No pin
  (deferred), no rename, no delete (out of scope).

Sort options: Name, Created, Updated. Default: Updated, descending.

Three distinct empty states, not one: no projects at all (today's "Start your
first project", kept), no search matches, and no archived projects.

## 6. Data

No migration. Both columns this design reads already exist.

### 6.1 Archive reuses `is_active`

`projects.is_active` is declared in `app/models/project.py`, defaults to
`true`, and is written by nothing in the stack. It becomes the archive flag:
`true` = active, `false` = archived. The hub filters to `is_active = true` by
default.

**The write must use `.select()`:**

```ts
supabase.from('projects').update({is_active: false}).eq('id', id).select()
```

A PostgREST update without `.select()` returns success having changed nothing
when RLS rejects the row. A zero-row result must surface as a failure, not a
silent success.

This is not hypothetical here. `backend/alembic/versions/baseline_v1.sql:2835` defines:

```sql
CREATE POLICY "project_update" ON "public"."projects"
  FOR UPDATE USING ("public"."is_project_manager"("id", "auth"."uid"()));
```

Archiving is therefore **already manager-only at the database level** — no new
guard is needed. But a reviewer or viewer who clicks Archive hits exactly the
silent-zero-row path. The UI must consequently:

1. only offer Archive/Restore to managers, and
2. still treat a zero-row update as an error, since (1) is a UI-side
   affordance and not the security boundary.

Determining the current user's role on the hub needs the member row embedded
in the existing list query (`project_members` already exists; no schema
change). This is permitted: `backend/alembic/versions/baseline_v1.sql:2821` defines
`project_members_select` as `is_project_member(project_id, auth.uid())`, so a
member may read membership rows for projects they belong to — including their
own role.

### 6.2 `updated_at` is trigger-maintained

`BaseModel.updated_at` carries a SQLAlchemy-side `onupdate`, which would not
fire for PostgREST writes. It does not need to: `backend/alembic/versions/baseline_v1.sql:1707` defines

```sql
CREATE OR REPLACE TRIGGER "trg_projects_updated_at" BEFORE UPDATE
  ON "public"."projects" FOR EACH ROW
  EXECUTE FUNCTION "public"."update_updated_at_column"();
```

so the column is maintained at the database level regardless of writer. Both
the `Updated <relative>` display and the default sort rest on this.

Reads stay on PostgREST, consistent with the rest of the app schema (ADR-0011
remains proposed; only extraction reads have moved).

## 7. Deferred slice

A later slice adds one Alembic migration with two nullable columns on
`project_members` — `pinned_at` and `last_opened_at` — and with them: pin/unpin
in the row menu, Pinned and Recent sections in the sidebar, sort by
recently-opened, and `Opened <relative>` replacing `Updated <relative>` in the
row. Nothing in this design blocks that; the row's metadata slot and the
sidebar's section list are the only two seams it touches.

## 8. Testing

- **Shell.** `AppShell` renders sidebar and footer on `/`, `/settings` and a
  project route. The no-project assertions must also assert their
  *precondition* — that the route match genuinely yielded no project id — so
  they cannot pass vacuously against a shell that silently rendered nothing.
- **URL-driven nav.** Clicking a project section writes `?tab=`, and
  `ProjectContext` follows. Asserts the inversion in §3.2 actually holds.
- **Archive mutation.** Asserts the call includes `.select()` and that a
  zero-row response surfaces as an error rather than a success toast.
- **Hub.** Search, sort and the Active/Archived filter; archived rows hidden by
  default; all three empty states.
- **E2E (Playwright).** Land on `/` → sidebar visible → open a project →
  sections appear → return via the switcher. Scoped pickers only — unscoped
  pickers in this suite have previously poisoned the backend test data.
- **Gates.** `knip` at zero in both modes; every new string added to
  `frontend/lib/copy/` or the copy-key fitness gate fails.

jsdom sees neither layout nor Tailwind, so density and visual fidelity are not
verified by unit tests. They go through the `design-review` screenshot loop
before this is called done.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Hoisting the shell disturbs `ProjectProvider`'s `?tab=` write | Shell never consumes `ProjectContext`; provider stays wrapping `ProjectView` (§3.1) |
| Archive appears to work for non-managers | `.select()` + zero-row-as-error, plus manager-gated affordance (§6.1) |
| Rewiring `onTabChange` regresses mobile nav or `G`-shortcuts | Both are rewired in the same change and covered by §8 |
| A two-item sidebar on `/` reads as unfinished | Accepted. The footer and the hub carry the screen; revisit if the deferred slice does not land |
