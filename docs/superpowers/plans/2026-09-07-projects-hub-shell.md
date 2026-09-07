---
status: in_progress
last_reviewed: 2026-09-07
owner: '@raphaelfh'
---

# Projects hub and the unified app shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/`, `/projects/:projectId` and `/settings` one shell (sidebar +
route-derived breadcrumb bar + footer), and turn `/` into a projects hub with
search, status filter, sort and archive/restore.

**Architecture:** A new `AppShell` layout route derives its state from the URL
(`matchPath` for the project id, `?tab=` for the section) and never consumes
`ProjectContext` — `ProjectProvider` writes `?tab=` on mount and stays wrapping
`ProjectView` alone. `SidebarProvider` hoists above `Routes`. Navigation inverts
from a prop-drilled `onTabChange` to URL writes, copying the precedent already
in `RunWorkspaceShell`. The top bar becomes a breadcrumb bar. The hub reads one
shared, identity-scoped TanStack cache entry (`projectKeys.list({userId})`)
that the switcher, the breadcrumb and the list all resolve from, so an archive
invalidation reaches every surface. Archive/restore itself is a manager-gated
FastAPI endpoint called through the typed apiClient, not a browser write.

**Tech Stack:** TypeScript strict, React 19 + Vite, react-router 8, TanStack
Query 5, shadcn/Radix, Tailwind, in-house i18n at `frontend/lib/copy/`, Vitest +
Testing Library + MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-07-projects-hub-shell-design.md`
**Ledger (overrides the spec where they disagree):**
`.superpowers/sdd/2026-09-07-projects-hub-shell-design/progress.md`

## Global Constraints

- **The two-item sidebar on `/` is the intended end state, not an unfinished draft.**
  Spec §9 accepts this risk explicitly ("A two-item sidebar on `/` reads as
  unfinished | Accepted. The footer and the hub carry the screen; revisit if the
  deferred slice does not land"), and the spec's author has re-confirmed it to
  this run. On `/` the rail holds exactly Projects (`G H`) and Settings (`⌘,`),
  plus the footer. **Do not "fix" the sparseness by adding Pinned or Recent
  sections.** Those require `pinned_at` / `last_opened_at` on `project_members` —
  the migration the user deliberately deferred (§2.1). Reintroducing them would
  silently reverse a decision that has reasoning behind it. If the rail genuinely
  looks wrong once rendered, that is a finding to raise with the user, never
  something to resolve inside an implementation task.
- All user-facing text goes through `frontend/lib/copy/` — never hardcode strings in components (`.claude/rules/frontend.md`).
- `knip` at zero in BOTH modes: `npm run deadcode` and `npm run deadcode:production`.
- The copy-key fitness gate is a shrink-only ratchet on UNUSED keys (`scripts/fitness/check_copy_keys.py` + `.baseline`). It cannot catch a hardcoded string — that is on the implementer.
- Page gutter `px-4 py-3 lg:px-6`, never wider. Note that `Dashboard.tsx:18`'s `SHELL_PADDING_X = "px-4 sm:px-6 lg:px-8 2xl:px-12"` violates this today; converge it rather than propagating it.
- Commands: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npm run deadcode`, `npm run deadcode:production`, `npx playwright test --project=local-api --project=local-ui`, `bash scripts/fitness/run_all.sh`. Backend: `make test-backend`, `make lint-backend`.
- **No migration, no Alembic revision.** `projects.is_active` already exists
  (`backend/app/models/project.py:75`) and the archive endpoint only writes it.
  This run *is* full-stack, though: Task 9 adds a FastAPI endpoint, so
  `backend/` code and `backend/tests/` are in scope.
- Conventional commits; each task ends in its own commit.
- **Every commit is green under `npm run typecheck`** (and `ruff` for backend
  commits). The repo's pre-push gate (`make hooks`, `.githooks/`) runs
  ruff/tsc on the changed layers and refuses a push otherwise, so no task may
  end on a knowingly red typecheck — where a rename spans two tasks, the
  earlier task carries a shim rather than leaving the tree broken.

Additional constraints this plan carries:

- **Two slices, ONE branch (`claude/projects-hub-shell-design-046560`), ONE PR.**
  Tasks 1–8 are slice 1; tasks 9–14 are slice 2. Do not open a second PR.
- **Frontend tooling runs from the repo ROOT.** There is no
  `frontend/package.json`. Never `cd frontend && npm ...`.
- **This plan adds no new `supabase.from(...)` application-data call sites.**
  Constitution §VI and ADR-0007 (status: *accepted*) put every application-data
  read and write on the typed API client; `.claude/rules/frontend.md:31` says
  "do not add new `supabase.from(...)` reads outside the integration layer".
  The archive **write** is therefore a FastAPI endpoint called through
  `apiClient` (Task 9 + Task 12). The one PostgREST call this plan touches —
  `listProjectsForDashboard` — is an **existing, grandfathered read** that is
  merely widened with `updated_at` and a membership embed; it is not a second
  violation. ADR-0011 has not landed, and CLAUDE.md still records that
  app-schema reads other than extraction use PostgREST, so moving that read is
  out of scope. An earlier draft of this plan told the implementer to keep
  `supabase` and `.from(` on separate lines because
  `scripts/fitness/check_frontend_data_path.py` matches
  `\bsupabase\s*\.\s*from\s*\(` on a single line — that was an instruction to
  evade a gate, and it is deleted.
- **Data flow is `component → hook (TanStack) → service (apiClient) →
  backend`.** Services return `ErrorResult<T>` via `toResult` and never throw
  across the boundary and never toast. Query keys come from
  `frontend/lib/query-keys/` (CI-enforced).
- **The project-list cache entry carries the caller's identity.** The
  QueryClient is module-scope (`frontend/App.tsx:57`) and sign-out is a
  client-side navigate that clears no cache, so an identity-free key survives
  an in-tab account switch. Every read of the list keys on
  `projectKeys.list({userId})` and every invalidation targets that same key.
- **React Compiler runs with `panicThreshold: 'all_errors'`.** No `try/finally`
  and no `throw` inside a component or hook *body*; `throw` inside a query/
  mutation callback is the established in-repo pattern (`Dashboard.tsx:31`).
- **jsdom sees neither layout nor Tailwind.** Density, spacing, responsive
  tiers and visual fidelity are NOT asserted in unit tests — they go through
  the `design-review` screenshot loop (Task 14).
- **Playwright: scoped pickers only.** Unscoped pickers in this suite have
  previously poisoned backend test data (`frontend/e2e/flows/projects.e2e.ts:32`).

## Accepted — recorded, deliberately not engineered around

Three known properties of this design. They are written down so a reviewer
does not re-raise them as defects, and so nobody later mistakes them for
guarantees the code makes.

- **Archive is presentation-only. `is_active` restricts no read and no write.**
  No RLS policy on `projects` references it: `project_select` is a bare
  membership `EXISTS`, and `project_update` / `project_delete` are
  `is_project_manager` (`backend/alembic/versions/baseline_v1.sql:2829-2835`).
  Grepping `backend/app` for `is_active` finds only the column declaration
  (`app/models/project.py:75`) — no service filters on it. So an archived
  project stays fully reachable and mutable at `/projects/:id` and through
  every extraction/QA endpoint; and because Task 2 filters the switcher to
  active projects, a manager who archives the project they are *inside* keeps
  full write access while it disappears from navigation. Say this in the PR
  body too, so `is_active` is not later mistaken for an access-control flag.
- **Archiving or restoring reorders the list under the "Updated" sort.**
  `trg_projects_updated_at` (`backend/alembic/versions/baseline_v1.sql:1707`)
  is a `BEFORE UPDATE ... FOR EACH ROW` trigger that sets
  `NEW.updated_at = NOW()` on *every* update of the row — the archive write
  included. With `updated_at desc` as the default sort, an archived project
  jumps to the top of Archived and a restored one to the top of Active.
  Accepted: archived rows are hidden by default, and a restored project
  surfacing first is defensible rather than wrong. Reversible without a schema
  change if it turns out to annoy.
- **The widened PostgREST read's DB contract is still asserted against a fake
  query builder.** `readChain` in Task 10's service test is a hand-rolled
  object; it cannot prove that `project_members(user_id, role)` really embeds,
  nor that `project_members.user_id=eq.<uuid>` filters the embedded rows rather
  than the top-level ones. Two mitigations, and then it stops there: the
  *write* half moved to a FastAPI endpoint whose integration tests run against
  the real local Postgres with RLS on (Task 9), and `isProjectManager` verifies
  the membership row belongs to the caller rather than trusting the transport
  filter (Task 10), so a silently-unapplied embed filter degrades payload size,
  not the affordance. A real-PostgREST assertion on the read belongs to the
  ADR-0011 consolidation that moves it off PostgREST entirely.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `backend/app/schemas/project_archive.py` | `ProjectArchiveUpdate` (`archived`) + `ProjectArchiveRead` (`id`, `is_active`). |
| `backend/app/services/project_archive.py` | `set_project_archived(db, project_id, archived)` — one scoped `UPDATE … RETURNING`; raises `ProjectNotFoundError`. |
| `backend/app/api/v1/endpoints/project_archive.py` | `PATCH /{project_id}/archive`, `require_project_manager`, `ApiResponse` envelope. |
| `backend/tests/unit/test_project_archive_endpoints_unit.py` | Direct endpoint-coroutine tests (the ASGI diff-coverage blind spot). |
| `backend/tests/integration/test_project_archive_endpoints.py` | Real DB + RLS: manager round-trip, reviewer 403 (BOLA), outsider 403, unknown-id 403. |
| `frontend/hooks/useShellLocation.ts` | The one URL derivation: active project id (`matchPath`) + active section (`?tab=`). No provider dependency. |
| `frontend/hooks/useProjectsQuery.ts` | The one project-list read, under `projectKeys.list({userId})`, plus the exported `projectsListKey(userId)` every invalidator uses. |
| `frontend/hooks/useArchiveProject.ts` | Archive/restore mutation over the typed apiClient; invalidates `projectsListKey(userId)`. |
| `frontend/components/layout/AppShell.tsx` | The shell: Topbar + sidebar + mobile drawer + `<Outlet/>`. Owns `switcherOpen` and the nav shortcuts. |
| `frontend/components/layout/SidebarBrandHeader.tsx` | `BrandMark` (the `R` square) + the `h-12` brand header row for the no-project sidebar state. |
| `frontend/components/navigation/Breadcrumb.tsx` | Route-derived breadcrumb rendered in the Topbar's left region. |
| `frontend/components/project/ProjectRow.tsx` | One hub row: stretched link, metadata, hover `⋯` menu. |
| `frontend/lib/relative-time.ts` | `relativeTime(iso, now?)` — compact relative time over the existing `common.time*` copy keys. |
| `frontend/test/hooks/useShellLocation.test.tsx` | Derivation unit tests. |
| `frontend/components/layout/sidebarConfig.test.ts` | `deriveSidebarNav` — the sidebar's two states, resolved once. |
| `frontend/test/hooks/useProjectsQuery.test.tsx` | The switcher resolves from the shared cache, filtered to `is_active`; the cache entry is identity-scoped; the query waits for an identity; a failed read is a failure and an empty account is not. |
| `frontend/components/layout/SidebarHeader.test.tsx` | The switcher's four menu states — loading, failed (with a retry), empty account, resolved — asserted apart from one another. |
| `frontend/components/navigation/Breadcrumb.test.tsx` | The breadcrumb's four root states, and the guard that they render four different strings. |
| `frontend/test/hooks/useNavigationShortcuts.test.tsx` | Real keydowns: `G H` everywhere, project bindings gated on a project id, `G P`. |
| `frontend/test/appShell.routes.test.tsx` | App-level route tests for the shell (template: `legacyArticleRoutes.test.tsx`). |
| `frontend/components/layout/ProjectSidebar.test.tsx` | Sidebar's two states + URL-driven nav. |
| `frontend/test/projectSectionNav.test.tsx` | The other half of the inversion: after the sidebar writes `?tab=`, `ProjectContext` follows. |
| `frontend/test/UserSettings.test.tsx` | Tablist semantics, `?tab=` deep link and URL sync, no page title or back control. |
| `frontend/test/types/projectManager.test.ts` | The one manager predicate, proved against a full roster rather than a mocked call string. |
| `frontend/test/relativeTime.test.ts` | Formatter unit tests. |
| `frontend/test/hooks/useArchiveProject.test.tsx` | Success invalidates the identity-scoped list key; a contradicting response and an API error both surface as errors. |
| `frontend/test/Dashboard.hub.test.tsx` | Search, filter, sort, three empty states, row affordances. |

**Modified**

| File | Change |
|---|---|
| `backend/app/api/v1/router.py` | Registers `project_archive.router` under the existing `/projects` prefix. |
| `frontend/types/api/{openapi.json,schema.d.ts}` | **Generated** — `npm run generate:api-types` after the endpoint lands; never hand-edited. |
| `frontend/App.tsx` | `SidebarProvider` above `Routes`; a layout route renders `AppShell` around `/`, `/projects/:projectId`, `/settings`. |
| `frontend/components/layout/AppLayout.tsx` | Shimmed in Tasks 4–5 to keep the tree compiling, then **deleted** in Task 6 — both `AppLayout` and `ProjectLayout` are superseded by `AppShell`. |
| `frontend/components/layout/ProjectSidebar.tsx` | Gains a no-project state; `onTabChange` → `projectId` + internal URL navigation; renders `deriveSidebarNav`. |
| `frontend/components/layout/MobileSidebar.tsx` | Same inversion + no-project state, from the same `deriveSidebarNav`; the baselined `h-8` override is dropped. |
| `frontend/components/layout/SidebarNavItem.tsx` | `shortcut` becomes optional (no chip, no `aria-keyshortcuts`, when the item owns no `G`-sequence). |
| `frontend/components/layout/SidebarHeader.tsx` | Post-create refresh moves from `loadProjects()` to a `projectsListKey(userId)` invalidation; the menu gains four distinct states (loading / failed + retry / empty / resolved). |
| `frontend/components/layout/sidebarConfig.ts` | Adds `workspaceNavItems`, `workspaceSectionTitle` and `deriveSidebarNav()` — the one nav derivation both rails render. |
| `frontend/components/navigation/Topbar.tsx` | Breadcrumb bar; toggle on every shell route; `window.location` → `useShellLocation()`; brand block removed. |
| `frontend/components/navigation/SectionViewSwitcher.tsx` | Reads the URL instead of `ProjectContext` (it now renders above `ProjectProvider`). |
| `frontend/components/runs/RunWorkspaceShell.tsx` | Prop swap only: `onTabChange={goToTab}` → `projectId={projectId}`. |
| `frontend/hooks/useNavigationShortcuts.ts` | URL-driven; workspace bindings always, project bindings only with a project id; adds `G H`. |
| `frontend/hooks/useProjectsList.ts` | Migrated onto `useProjectsQuery`, filtered to `is_active`; exposes `isError` + `retry` so a failed read stays distinguishable from an empty account. |
| `frontend/hooks/useProjectMemberRole.ts` | Derives `isManager` from the shared `isManagerRole` predicate instead of its own `role === 'manager'`. |
| `frontend/pages/Dashboard.tsx` | De-chromed, gutter converged, hub toolbar + row extraction + empty states. |
| `frontend/pages/UserSettings.tsx` | Folds into the shell; title/back removed; rail restyled + mobile tier; copy keys wired. |
| `frontend/services/projectsService.ts` | `listProjects` deleted; `listProjectsForDashboard` widened (still PostgREST, grandfathered); `setProjectArchived` added **over `apiClient`**. |
| `frontend/types/project.ts` | `ProjectListItem` gains `updated_at` + the embedded `project_members` rows; adds `isManagerRole` and `isProjectManager`. |
| `frontend/lib/copy/{layout,navigation,pages}.ts` | New keys — including the switcher's empty-account line and the breadcrumb's failed / unknown-project roots; two dead `pages` keys deleted; the dead `layout.loadingProjects` becomes live (it labels the switcher's spinner) and leaves the copy baseline. |
| `frontend/test/{legacyArticleRoutes,RunWorkspaceShell}.test.tsx`, `frontend/test/services/projectsService.test.ts`, `frontend/components/layout/SidebarNavItem.test.tsx`, `frontend/components/navigation/SectionViewSwitcher.test.tsx` | Adapted to the new seams. |
| `frontend/e2e/flows/projects.e2e.ts` | Scoped pickers; shell flow. |
| `scripts/fitness/check_copy_keys.baseline`, `scripts/fitness/check_button_scale.baseline` | Tightened. |

---

# SLICE 1 — the unified shell

### Task 1: `useShellLocation` — the one URL derivation

**Files:**
- Create: `frontend/hooks/useShellLocation.ts`
- Test: `frontend/test/hooks/useShellLocation.test.tsx`

**Interfaces:**
- Consumes: `sidebarItems` from `frontend/components/layout/sidebarConfig.ts`
  (already exported: `SidebarNavItem[]` with `id: SidebarTabId`).
- Produces: `useShellLocation(): {projectId: string | null; activeSection: SidebarTabId | null}`
  and `DEFAULT_PROJECT_TAB: SidebarTabId`. Tasks 4–7 and 12 consume both.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/test/hooks/useShellLocation.test.tsx
/**
 * The shell derives its state from the URL, never from ProjectContext:
 * ProjectProvider writes `?tab=` in a mount effect and its own source comment
 * warns that wrapping a redirecting component clobbers the redirect (spec
 * §3.1). These are the derivation's only rules, so they are asserted directly
 * rather than through a rendered shell.
 */
import {renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {MemoryRouter} from 'react-router';
import {DEFAULT_PROJECT_TAB, useShellLocation} from '@/hooks/useShellLocation';

function at(path: string) {
  return renderHook(() => useShellLocation(), {
    wrapper: ({children}) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>,
  }).result.current;
}

describe('useShellLocation', () => {
  it('yields no project id on the hub', () => {
    expect(at('/')).toEqual({projectId: null, activeSection: null});
  });

  it('yields no project id on settings', () => {
    expect(at('/settings?tab=security')).toEqual({projectId: null, activeSection: null});
  });

  it('matches a bare project route', () => {
    expect(at('/projects/p1')).toEqual({projectId: 'p1', activeSection: DEFAULT_PROJECT_TAB});
  });

  it('reads the section from ?tab=', () => {
    expect(at('/projects/p1?tab=extraction')).toEqual({projectId: 'p1', activeSection: 'extraction'});
  });

  it('falls back to the default section for an unknown ?tab=', () => {
    expect(at('/projects/p1?tab=bogus')).toEqual({projectId: 'p1', activeSection: DEFAULT_PROJECT_TAB});
  });

  it('matches nested run routes at any depth', () => {
    expect(at('/projects/p1/extraction/a9')).toEqual({projectId: 'p1', activeSection: DEFAULT_PROJECT_TAB});
    expect(at('/projects/p1/articles/a9/quality-assessment/t3')).toMatchObject({projectId: 'p1'});
  });

  it('does not treat a settings ?tab= as a project section', () => {
    expect(at('/settings?tab=integrations').activeSection).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- frontend/test/hooks/useShellLocation.test.tsx`
Expected: FAIL — `Failed to resolve import "@/hooks/useShellLocation"`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/hooks/useShellLocation.ts
/**
 * The shell's single source of truth, derived from the URL.
 *
 * AppShell must NOT consume ProjectContext: ProjectProvider writes `?tab=` to
 * the URL in a mount effect, and its own source comment warns that mounting it
 * around a component that redirects on mount clobbers the redirect. The
 * provider therefore stays wrapping ProjectView alone, and everything above it
 * — shell, sidebar, breadcrumb, section-view switcher — reads the URL instead.
 * See docs/superpowers/specs/2026-09-07-projects-hub-shell-design.md §3.1.
 */
import {matchPath, useLocation, useSearchParams} from 'react-router';
import {sidebarItems, type SidebarTabId} from '@/components/layout/sidebarConfig';

/** Mirrors ProjectContext's own fallback, so the two never disagree. */
export const DEFAULT_PROJECT_TAB: SidebarTabId = 'articles';

const VALID_SECTIONS = new Set<string>(sidebarItems.map((item) => item.id));

export interface ShellLocation {
  /** Non-null on `/projects/:projectId` and anything nested under it. */
  projectId: string | null;
  /** Null whenever `projectId` is null — `?tab=` on `/settings` is unrelated. */
  activeSection: SidebarTabId | null;
}

export function useShellLocation(): ShellLocation {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // `end: false` is a prefix match, so `/projects/p1`, `/projects/p1?tab=x` and
  // `/projects/p1/extraction/a9` all resolve the same project id.
  const match = matchPath({path: '/projects/:projectId', end: false}, location.pathname);
  const projectId = match?.params.projectId ?? null;

  if (projectId === null) {
    return {projectId: null, activeSection: null};
  }

  const tab = searchParams.get('tab');
  const activeSection = tab !== null && VALID_SECTIONS.has(tab)
    ? (tab as SidebarTabId)
    : DEFAULT_PROJECT_TAB;

  return {projectId, activeSection};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- frontend/test/hooks/useShellLocation.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/hooks/useShellLocation.ts frontend/test/hooks/useShellLocation.test.tsx
git commit -m "feat(shell): derive the active project and section from the URL"
```

---

### Task 2: one identity-scoped project-list cache for hub, switcher and shell

Ledger ruling 2026-09-07T14:33Z. The switcher's list is today a second,
uncached, unfiltered `select('*')` read that no invalidation reaches
(discrepancy I). Once the hub and the switcher share a screen, archiving a
project would refresh one and not the other. This task is scheduled in slice 1
because `AppShell` (Task 6) needs the same cache entry to resolve the
breadcrumb's project name.

The entry is keyed by the caller from birth, not later: the QueryClient is
module-scope (`frontend/App.tsx:57`, `gcTime` 10 min) and `AuthProvider.signOut`
(`frontend/contexts/AuthContext.tsx:142-145`) is a client-side `navigate` with
no `queryClient.clear()`, so an identity-free key over RLS-scoped rows serves
user A's projects to user B after an in-tab account switch. Slice 2 makes the
read explicitly caller-scoped (`project_members(user_id, role)`), which turns
that from stale names into a wrong Archive affordance — so the key is fixed
here, before anything depends on it. Clearing the cache on sign-out is the
deeper fix and is out of scope (ledger 15:45Z, follow-up).

**Files:**
- Create: `frontend/hooks/useProjectsQuery.ts`
- Create: `frontend/test/hooks/useProjectsQuery.test.tsx`
- Create: `frontend/components/layout/SidebarHeader.test.tsx`
- Modify: `frontend/hooks/useProjectsList.ts` (whole file)
- Modify: `frontend/services/projectsService.ts:16-25` (delete `listProjects`)
- Modify: `frontend/components/layout/SidebarHeader.tsx:30-53, 78-116`
- Modify: `frontend/pages/Dashboard.tsx:1-35`
- Modify: `frontend/lib/copy/layout.ts` (one new key; `loadingProjects` becomes live)
- Modify: `scripts/fitness/check_copy_keys.baseline` (drop the now-live `loadingProjects`)
- Test: `frontend/test/services/projectsService.test.ts` (retarget)

**Interfaces:**
- Consumes: `listProjectsForDashboard` (`projectsService`), `projectKeys.list`
  (`@/lib/query-keys`), `useAuth` (`@/contexts/AuthContext`), `ProjectListItem`
  (`@/types/project`).
- Produces:
  - `projectsListKey(userId: string): ReturnType<typeof projectKeys.list>` —
    the ONE key every reader and every invalidator uses (Tasks 6, 7, 12, 13).
  - `useProjectsQuery(): UseQueryResult<ProjectListItem[], Error>` — consumed
    by Tasks 6, 7, 13.
  - `useProjectsList(): {projects, loading, isError, retry, switchProject}` —
    `loadProjects` is gone; `isError` and `retry` are new. They are the
    replacement for the toast this hook used to fire, not an extra: a toast
    cannot move onto a shared query (it would fire once per mounted consumer),
    but simply deleting it would leave a FAILED read returning `projects: []`
    — byte for byte what an account with no projects returns — and the
    switcher would render the failure as an empty menu on every route the
    sidebar is mounted on. Error swallowing is a named recurring incident
    class in this repo (`code-review` checklist), so the two states stay
    distinguishable at the hook boundary.

- [ ] **Step 1: Write the two failing tests**

This is the task's red step, and it is two files: the cache entry itself, and
the switcher that renders it. The archive mutation's own test (Task 12) proves
an invalidation is *issued*; only a subscribed reader proves it *arrives*, and
that reader — `useProjectsList` — has no test today at any layer.

```tsx
// frontend/test/hooks/useProjectsQuery.test.tsx
/**
 * The ONE project-list cache entry, and the switcher's view of it.
 *
 * Six properties nothing else in the suite covers:
 *
 * 1. `useProjectsList` really resolves from the shared entry. That is the half
 *    of the stale-cache defect (ledger discrepancy I) an invalidation test
 *    cannot see: `invalidateQueries` was always being called, and nothing was
 *    subscribed to the key it named.
 * 2. The entry is keyed by the caller, so an in-tab account switch cannot
 *    serve user A's rows to user B out of a module-scope QueryClient that
 *    nothing clears on sign-out.
 * 3. The query waits for an identity instead of fetching under an empty one —
 *    otherwise a disabled query and an empty account look identical downstream.
 * 4. A FAILED read is reported as a failure, not as an empty list. `projects`
 *    is `[]` in both cases, so the array alone cannot tell them apart and any
 *    consumer branching on it is wrong.
 * 5. An account with genuinely no projects is NOT reported as a failure.
 * 6. `retry` re-runs the read, so the switcher's error state is actionable
 *    rather than terminal.
 */
import type {ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const listProjectsForDashboard = vi.fn();
vi.mock('@/services/projectsService', () => ({
  listProjectsForDashboard: () => listProjectsForDashboard(),
}));

let currentUser: {id: string} | null = {id: 'u1'};
vi.mock('@/contexts/AuthContext', () => ({useAuth: () => ({user: currentUser})}));

import {projectsListKey, useProjectsQuery} from '@/hooks/useProjectsQuery';
import {useProjectsList} from '@/hooks/useProjectsList';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Alpha',
    description: null,
    created_at: '2026-01-01T00:00:00.000Z',
    is_active: true,
    review_title: null,
    ...over,
  };
}

function harness() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return {queryClient, wrapper};
}

describe('useProjectsQuery / useProjectsList', () => {
  beforeEach(() => {
    currentUser = {id: 'u1'};
    vi.clearAllMocks();
    listProjectsForDashboard.mockResolvedValue({ok: true, data: []});
  });

  it('the switcher resolves from the shared cache entry, not a second read', async () => {
    const {queryClient, wrapper} = harness();
    queryClient.setQueryData(projectsListKey('u1'), [row(), row({id: 'p2', name: 'Beta'})]);

    const {result} = renderHook(() => useProjectsList(), {wrapper});

    await waitFor(() => expect(result.current.projects).toHaveLength(2));
    expect(listProjectsForDashboard).not.toHaveBeenCalled();
  });

  it('an archived project leaves the switcher', async () => {
    const {queryClient, wrapper} = harness();
    queryClient.setQueryData(projectsListKey('u1'), [
      row(),
      row({id: 'p2', name: 'Beta', is_active: false}),
    ]);

    const {result} = renderHook(() => useProjectsList(), {wrapper});

    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.projects[0].name).toBe('Alpha');
  });

  it('does not serve one user\'s cached list to the next user in the same tab', async () => {
    const {queryClient, wrapper} = harness();
    queryClient.setQueryData(projectsListKey('u1'), [row({name: 'A-only'})]);
    currentUser = {id: 'u2'};
    listProjectsForDashboard.mockResolvedValue({ok: true, data: [row({id: 'p9', name: 'B-only'})]});

    const {result} = renderHook(() => useProjectsQuery(), {wrapper});

    // Nothing is served synchronously: A's entry is a different key.
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data?.[0]?.name).toBe('B-only'));
  });

  it('waits for an identity instead of fetching under an empty one', () => {
    currentUser = null;
    const {wrapper} = harness();

    const {result} = renderHook(() => useProjectsQuery(), {wrapper});

    // `idle` — not `fetching` and not `success`: a disabled query must be
    // distinguishable from an account with no projects.
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(listProjectsForDashboard).not.toHaveBeenCalled();
  });

  it('reports a failed read as a failure, not as an empty project list', async () => {
    const {wrapper} = harness();
    listProjectsForDashboard.mockResolvedValue({ok: false, error: new Error('permission denied')});

    const {result} = renderHook(() => useProjectsList(), {wrapper});

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.loading).toBe(false);
    // The discriminator. `projects` is [] here AND in the test below, so the
    // flag is the only thing that separates "the read failed" from "you have
    // no projects" — which is exactly what the deleted toast used to say.
    expect(result.current.projects).toEqual([]);
  });

  it('an account with no projects is not a failure', async () => {
    const {wrapper} = harness();
    listProjectsForDashboard.mockResolvedValue({ok: true, data: []});

    const {result} = renderHook(() => useProjectsList(), {wrapper});

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.projects).toEqual([]);
  });

  it('retry re-runs a failed read', async () => {
    const {wrapper} = harness();
    listProjectsForDashboard.mockResolvedValue({ok: false, error: new Error('permission denied')});

    const {result} = renderHook(() => useProjectsList(), {wrapper});
    await waitFor(() => expect(result.current.isError).toBe(true));

    listProjectsForDashboard.mockResolvedValue({ok: true, data: [row()]});
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.isError).toBe(false);
  });
});
```

And the switcher that renders those states:

```tsx
// frontend/components/layout/SidebarHeader.test.tsx
/**
 * The project switcher's FOUR states, kept distinct.
 *
 * Migrating the list onto the shared query deletes the hook's toast — the
 * read's only error surface today (`useProjectsList.ts:24`). With nothing in
 * its place a failed read renders as an empty menu, indistinguishable from an
 * account with no projects, on every route the sidebar is mounted on. On
 * `/projects/:id` the hub's own ErrorState is not mounted either, so nothing
 * anywhere would say the read failed.
 *
 * `open` is a controlled prop, so the menu is rendered without depending on
 * Radix pointer behaviour in jsdom.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router';

// SidebarHeader reaches the Supabase client through projectsService
// (createProject), and that client throws at import time without a URL.
// CI runs vitest with no .env.
vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({user: {id: 'u1'}, session: null, loading: false, signOut: vi.fn()}),
}));

const retry = vi.fn();
let listState: {projects: Array<{id: string; name: string}>; loading: boolean; isError: boolean};
vi.mock('@/hooks/useProjectsList', () => ({
  useProjectsList: () => ({...listState, retry, switchProject: vi.fn()}),
}));

import {SidebarHeader} from '@/components/layout/SidebarHeader';

const ALPHA = {id: 'p1', name: 'Alpha'};

function renderSwitcher(state: typeof listState) {
  listState = state;
  // The component calls `useQueryClient()` for its post-create invalidation,
  // which throws outside a provider even though nothing here creates a project.
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SidebarHeader open onOpenChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole('menu');
}

describe('SidebarHeader project switcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolved — lists the projects, and claims neither failure nor emptiness', () => {
    const menu = renderSwitcher({projects: [ALPHA], loading: false, isError: false});

    expect(within(menu).getByText('Alpha')).toBeInTheDocument();
    expect(within(menu).queryByRole('alert')).toBeNull();
    expect(within(menu).queryByText('No projects yet')).toBeNull();
  });

  it('loading — names the wait instead of showing an unlabelled spinner', () => {
    const menu = renderSwitcher({projects: [], loading: true, isError: false});

    expect(within(menu).getByText('Loading projects…')).toBeInTheDocument();
    expect(within(menu).queryByRole('alert')).toBeNull();
    expect(within(menu).queryByText('No projects yet')).toBeNull();
  });

  it('failed — says so, offers a retry, and does not read as an empty account', async () => {
    const menu = renderSwitcher({projects: [], loading: false, isError: true});

    expect(within(menu).getByRole('alert')).toHaveTextContent('Could not load projects.');
    expect(within(menu).queryByText('No projects yet')).toBeNull();

    await userEvent.click(within(menu).getByRole('menuitem', {name: 'Try again'}));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('empty — says the account has no projects, and does not read as a failure', () => {
    const menu = renderSwitcher({projects: [], loading: false, isError: false});

    expect(within(menu).getByText('No projects yet')).toBeInTheDocument();
    expect(within(menu).queryByRole('alert')).toBeNull();
    expect(within(menu).queryByRole('menuitem', {name: 'Try again'})).toBeNull();
  });

  it('keeps Create and Back reachable while the read is failing', () => {
    const menu = renderSwitcher({projects: [], loading: false, isError: true});

    expect(within(menu).getByRole('menuitem', {name: 'Create new project'})).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', {name: 'Back to projects'})).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:run -- frontend/test/hooks/useProjectsQuery.test.tsx frontend/components/layout/SidebarHeader.test.tsx`
Expected: both FAIL — the first on `Failed to resolve import
"@/hooks/useProjectsQuery"`; the second because today's menu is
`loading ? spinner : projects.map(...)` (`SidebarHeader.tsx:79-115`) and has no
error, empty or loading text anywhere in it.

- [ ] **Step 3: Retarget the service test to the surviving reader**

`listProjects` is being deleted, so its test must move to the function that
replaces it. Replace the whole of `frontend/test/services/projectsService.test.ts`:

```ts
// frontend/test/services/projectsService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({supabase: {from: vi.fn()}}));

import {supabase} from '@/integrations/supabase/client';
import {listProjectsForDashboard} from '@/services/projectsService';

function chain(payload: {data: unknown; error?: {message: string} | null}) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.order = vi.fn(async () => ({data: payload.data, error: payload.error ?? null}));
  return c;
}

describe('projectsService.listProjectsForDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects the list projection and orders by created_at desc', async () => {
    const rows = [{id: 'p1'}, {id: 'p2'}];
    const c = chain({data: rows});
    vi.mocked(supabase.from).mockReturnValue(c as never);

    const result = await listProjectsForDashboard();

    expect(supabase.from).toHaveBeenCalledWith('projects');
    expect(c.select).toHaveBeenCalledWith(
      'id, name, description, created_at, is_active, review_title',
    );
    expect(c.order).toHaveBeenCalledWith('created_at', {ascending: false});
    expect(result).toEqual({ok: true, data: rows});
  });

  it('returns ok with [] when data is null', async () => {
    vi.mocked(supabase.from).mockReturnValue(chain({data: null}) as never);
    expect(await listProjectsForDashboard()).toEqual({ok: true, data: []});
  });

  it('returns ok:false (never throws) on a supabase error', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      chain({data: null, error: {message: 'permission denied'}}) as never,
    );
    const result = await listProjectsForDashboard();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('permission denied');
  });
});
```

- [ ] **Step 4: Run the service test — it is a guard rail, not a red step**

Run: `npm run test:run -- frontend/test/services/projectsService.test.ts`
Expected: PASS already. The `select` assertion matches today's string verbatim
(`frontend/services/projectsService.ts:137`), which is the point: it is the
guard rail for Task 10, which widens that string, so a silent widening cannot
slip through. The task's red step is Step 1, not this one.

- [ ] **Step 5: Delete the second read path**

Delete `listProjects` and its now-unused `ProjectListItem` import stays (still
used by `listProjectsForDashboard`). Remove lines 16–25 of
`frontend/services/projectsService.ts`:

```ts
export function listProjects(): Promise<ErrorResult<ProjectListItem[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('projects')
      .select('*')
      .order('created_at', {ascending: false});
    if (error) throw error;
    return data ?? [];
  }, 'projectsService.listProjects');
}
```

- [ ] **Step 6: Add the shared query hook**

```ts
// frontend/hooks/useProjectsQuery.ts
/**
 * The ONE project-list read.
 *
 * The hub, the sidebar project switcher and the shell breadcrumb all resolve
 * from this single cache entry, so a mutation that invalidates it refreshes
 * every one of them. Before this hook the switcher held a second, uncached
 * `select('*')` read that no invalidation reached — archiving a project would
 * refresh the hub and leave the switcher listing it (ledger 2026-09-07T14:33Z).
 *
 * The key carries the caller's id. The rows are RLS-scoped to whoever fetched
 * them, the QueryClient is module-scope (App.tsx:57) and sign-out clears no
 * cache, so an identity-free key would hand user A's projects to user B after
 * an in-tab account switch. `projectsListKey` is exported because every
 * invalidator must name the same entry — `projectKeys.all` would work by
 * prefix but would also mark members, templates, HITL config, LLM endpoints
 * and AI context stale for every project in the app.
 */
import {useQuery, type UseQueryResult} from '@tanstack/react-query';
import {listProjectsForDashboard} from '@/services/projectsService';
import {projectKeys} from '@/lib/query-keys';
import {useAuth} from '@/contexts/AuthContext';
import type {ProjectListItem} from '@/types/project';

/** The one project-list cache entry, scoped to the caller. */
export function projectsListKey(userId: string): ReturnType<typeof projectKeys.list> {
  return projectKeys.list({userId});
}

export function useProjectsQuery(): UseQueryResult<ProjectListItem[], Error> {
  const {user} = useAuth();
  const userId = user?.id ?? '';

  return useQuery<ProjectListItem[], Error>({
    queryKey: projectsListKey(userId),
    queryFn: async () => {
      const result = await listProjectsForDashboard();
      if (!result.ok) throw result.error;
      return result.data;
    },
    // Never fetch — and never cache — under an empty identity.
    enabled: userId !== '',
    staleTime: 30_000,
  });
}
```

- [ ] **Step 7: Migrate the switcher's list onto it**

Replace the whole of `frontend/hooks/useProjectsList.ts`:

```ts
/**
 * The project switcher's list: the ONE shared, identity-scoped project-list
 * cache entry, filtered to active projects. Archived projects are reachable
 * from the hub's Archived filter, never from the switcher.
 *
 * The error surface CHANGES SHAPE here, it is not dropped. The toast this hook
 * used to fire cannot move onto a shared query — it would fire once per
 * mounted consumer of the same entry — but deleting it outright would leave a
 * failed read returning `projects: []`, which is byte for byte what an account
 * with no projects returns. The switcher would then render a failure as an
 * empty menu, and on `/projects/:id` the hub's ErrorState is not mounted to
 * say otherwise. `isError` and `retry` keep the two apart, and the caller
 * renders them (`SidebarHeader`). Error swallowing is a named recurring
 * incident class in this repo (`code-review` checklist).
 */
import {useNavigate} from 'react-router';
import {useProjectsQuery} from './useProjectsQuery';
import type {ProjectListItem} from '@/types/project';

interface UseProjectsListReturn {
  /** Active projects only. `[]` for BOTH a failed read and an empty account. */
  projects: ProjectListItem[];
  loading: boolean;
  /** True only for a FAILED read. An empty account is `false` with `projects: []`. */
  isError: boolean;
  retry: () => void;
  switchProject: (projectId: string) => void;
}

export const useProjectsList = (): UseProjectsListReturn => {
  const navigate = useNavigate();
  const {data, isLoading, isError, refetch} = useProjectsQuery();
  const projects = (data ?? []).filter((project) => project.is_active);

  const switchProject = (projectId: string) => {
    navigate(`/projects/${projectId}`);
  };

  return {
    projects,
    loading: isLoading,
    isError,
    // `void` — the switcher's retry is fire-and-forget; the query's own state
    // drives the re-render.
    retry: () => void refetch(),
    switchProject,
  };
};
```

- [ ] **Step 8: Point the switcher at the cache, and give its menu four states**

First, one new key in `frontend/lib/copy/layout.ts`, next to `loadingProjects`:

```ts
    switcherNoProjects: 'No projects yet',
```

`loadingProjects: 'Loading projects…'` already exists and is currently DEAD
(it is in `scripts/fitness/check_copy_keys.baseline`). It is the exact string
the unlabelled spinner below has always needed, so it is reused rather than
duplicated — Step 10 tightens its baseline line.

Then in `frontend/components/layout/SidebarHeader.tsx`, add the imports and
replace the destructure and the create handler's refresh. `user` is already
destructured from `useAuth()` at the top of the component and the handler's
first statement is `if (!user?.id) { … return; }`, so `user.id` is narrowed by
the time the invalidation runs.

```tsx
import {useQueryClient} from '@tanstack/react-query';
import {projectsListKey} from '@/hooks/useProjectsQuery';
```

Extend the existing lucide import to `{ChevronDown, Folder, Loader2, Plus, RefreshCw}`.

```tsx
  const {projects, loading, isError, retry, switchProject} = useProjectsList();
  const queryClient = useQueryClient();
```

```tsx
    toast.success(t('pages', 'dashboardProjectCreated'));
    setShowAddDialog(false);
    await queryClient.invalidateQueries({queryKey: projectsListKey(user.id)});
    switchProject(result.data.projectId);
```

Then replace the whole menu body (`SidebarHeader.tsx:79-115`, the
`{loading ? … }` expression inside `DropdownMenuContent`) with the four-state
version. Every surviving class name is byte-identical to today's:

```tsx
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-4">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />
              {/* The spinner had no accessible name at all. sr-only, never
                  `hidden` — `hidden` strips it from the a11y tree
                  (.claude/rules/frontend.md). */}
              <span className="sr-only">{t('layout', 'loadingProjects')}</span>
            </div>
          ) : (
            <>
              {isError ? (
                // A failed read must never render as an empty list: without
                // this branch the menu is byte-identical to "you have no
                // projects", on every route the sidebar is mounted on, and on
                // `/projects/:id` the hub's ErrorState is not mounted to say
                // otherwise. This is the switcher's replacement for the toast
                // that `useProjectsList` used to fire.
                <>
                  <div role="alert" className="px-2 py-1.5 text-[13px] text-muted-foreground">
                    {t('pages', 'dashboardCouldNotLoadProjects')}
                  </div>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      // Keep the menu open — the retry resolves in place.
                      event.preventDefault();
                      retry();
                    }}
                    className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                    <span>{t('patterns', 'errorTryAgain')}</span>
                  </DropdownMenuItem>
                </>
              ) : projects.length === 0 ? (
                <div className="px-2 py-1.5 text-[13px] text-muted-foreground">
                  {t('layout', 'switcherNoProjects')}
                </div>
              ) : (
                projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => switchProject(project.id)}
                    className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60"
                  >
                    <div className="h-4 w-4 rounded bg-primary/10 flex items-center justify-center shrink-0 border border-primary/15 mr-2">
                      <span className="text-[9px] font-semibold text-primary leading-none">
                        {project.name[0].toUpperCase()}
                      </span>
                    </div>
                    <span className="truncate">{project.name}</span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator className="bg-border/30" />
              <DropdownMenuItem
                onClick={() => setShowAddDialog(true)}
                className="px-2 py-1.5 rounded-md text-[13px] text-primary focus:bg-primary/5 focus:text-primary"
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                <span>{t('layout', 'createNewProject')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate('/')}
                className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60"
              >
                <Folder className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                <span>{t('layout', 'backToProjects')}</span>
              </DropdownMenuItem>
            </>
          )}
```

- [ ] **Step 9: Point the Dashboard at the shared hook**

In `frontend/pages/Dashboard.tsx`, delete the inline `useQuery` block
(lines 27–35) and its `listProjectsForDashboard` / `useQuery` / `ProjectListItem`
/ `projectKeys` imports, and read from the hook instead:

```tsx
import {projectsListKey, useProjectsQuery} from "@/hooks/useProjectsQuery";
```

```tsx
  const {data: projects = [], isLoading, isError, refetch} = useProjectsQuery();
```

and point the create handler's invalidation at the same entry (`user.id` is
narrowed by the handler's own `if (!user?.id)` early return):

```tsx
    await queryClient.invalidateQueries({queryKey: projectsListKey(user.id)});
```

`useQueryClient` and `createProject` stay.

- [ ] **Step 10: Run the tests and the dead-code gates**

Run: `npm run test:run -- frontend/test/hooks/useProjectsQuery.test.tsx frontend/components/layout/SidebarHeader.test.tsx frontend/test/services/projectsService.test.ts frontend/test/RunWorkspaceShell.test.tsx`
Expected: PASS (7 + 5 + 3 + 2 tests).

Run: `npm run typecheck && npm run lint && npm run deadcode && npm run deadcode:production`
Expected: exit 0 on all four (`listProjects` is gone, so nothing is orphaned).

Run: `python3 scripts/fitness/check_copy_keys.py`
Expected: exit 0, with `frontend/lib/copy/layout.ts:loadingProjects` reported
as **tightenable** — the spinner now names itself. Delete that ONE line from
`scripts/fitness/check_copy_keys.baseline` by hand. Do **not** run
`--update-baseline` here: Task 8 owns that sweep and its expected count
(7 lines removed, 0 added) assumes this line is already gone.

Run: `git diff --stat scripts/fitness/check_copy_keys.baseline`
Expected: 1 line removed, 0 added.

- [ ] **Step 11: Commit**

```bash
git add frontend/hooks/useProjectsQuery.ts frontend/hooks/useProjectsList.ts \
        frontend/test/hooks/useProjectsQuery.test.tsx \
        frontend/components/layout/SidebarHeader.test.tsx \
        frontend/services/projectsService.ts frontend/components/layout/SidebarHeader.tsx \
        frontend/pages/Dashboard.tsx frontend/test/services/projectsService.test.ts \
        frontend/lib/copy/layout.ts scripts/fitness/check_copy_keys.baseline
git commit -m "refactor(projects): one identity-scoped project-list cache for hub, switcher and shell"
```

---

### Task 3: sidebar primitives — one nav derivation, plus the brand header

Two YAGNI corrections the panel raised and the ledger accepted, both applied
here rather than in Task 4:

- **No chord generalization of `SidebarNavItem`.** An earlier draft widened
  `shortcut: string` to `shortcutKeys: string[] + shortcutVariant`, added an
  `ariaKeyshortcuts()` helper and rewrote every call site — all to render a
  `⌘,` chip for a binding this component does not own (`useGlobalShortcuts`
  does, app-wide, and it already works). The Settings item simply carries no
  chip; `shortcut` becomes optional, which is the whole change.
- **The nav list is derived once.** `deriveSidebarNav()` returns the groups
  both rails render, so the project/workspace ternary and the two different
  `active` derivations exist in exactly one place instead of four.

**Files:**
- Create: `frontend/components/layout/SidebarBrandHeader.tsx`
- Create: `frontend/components/layout/sidebarConfig.test.ts`
- Modify: `frontend/components/layout/SidebarNavItem.tsx`
- Modify: `frontend/components/layout/SidebarNavItem.test.tsx`
- Modify: `frontend/components/layout/sidebarConfig.ts`
- Modify: `frontend/lib/copy/layout.ts`

**Interfaces:**
- Produces:
  - `SidebarNavItem` props become `{icon, label, shortcut?: string, active, onClick}` —
    when `shortcut` is absent the item renders no `KbdBadge` and no `aria-keyshortcuts`.
  - `BrandMark: React.FC<{className?: string}>` and `SidebarBrandHeader: React.FC` from `SidebarBrandHeader.tsx`.
  - From `sidebarConfig.ts`: `workspaceSectionTitle: string`,
    `workspaceNavItems: WorkspaceNavItem[]` where
    `WorkspaceNavItem = {id: 'hub' | 'settings'; label: string; icon: LucideIcon; path: string; shortcut?: string}`,
    and
    `deriveSidebarNav(args: {projectId: string | null; activeTab: string; pathname: string}): SidebarNavGroup[]`
    where `SidebarNavGroup = {title: string; items: SidebarNavEntry[]}` and
    `SidebarNavEntry = {id: string; label: string; icon: LucideIcon; shortcut?: string; path: string; active: boolean}`.
- Consumed by Task 4 (`ProjectSidebar`, `MobileSidebar`).

- [ ] **Step 1: Write the failing derivation test**

```ts
// frontend/components/layout/sidebarConfig.test.ts
/**
 * `deriveSidebarNav` is the sidebar's whole branching logic, extracted so the
 * desktop rail and the mobile drawer cannot drift: they render the same groups
 * and differ only in chrome. Testing it here is what lets Task 4's component
 * tests stay small.
 */
import {describe, expect, it} from 'vitest';
import {deriveSidebarNav, sidebarItems, workspaceSectionTitle} from './sidebarConfig';

describe('deriveSidebarNav', () => {
  it('yields one WORKSPACE group when no project is open', () => {
    const groups = deriveSidebarNav({projectId: null, activeTab: '', pathname: '/'});

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe(workspaceSectionTitle);
    expect(groups[0].items.map((i) => i.id)).toEqual(['hub', 'settings']);
    expect(groups[0].items.map((i) => i.path)).toEqual(['/', '/settings']);
  });

  it('marks the workspace destination that matches the pathname', () => {
    const onSettings = deriveSidebarNav({projectId: null, activeTab: '', pathname: '/settings'});

    expect(onSettings[0].items.find((i) => i.id === 'settings')?.active).toBe(true);
    expect(onSettings[0].items.find((i) => i.id === 'hub')?.active).toBe(false);
  });

  it('gives the hub a G-sequence letter and Settings none', () => {
    const groups = deriveSidebarNav({projectId: null, activeTab: '', pathname: '/'});

    expect(groups[0].items.find((i) => i.id === 'hub')?.shortcut).toBe('H');
    // `⌘,` is owned by useGlobalShortcuts, not by this rail — no chip.
    expect(groups[0].items.find((i) => i.id === 'settings')?.shortcut).toBeUndefined();
  });

  it('yields the project sections, with `?tab=` paths, when a project is open', () => {
    const groups = deriveSidebarNav({projectId: 'p1', activeTab: 'extraction', pathname: '/projects/p1'});

    const items = groups.flatMap((g) => g.items);
    expect(items).toHaveLength(sidebarItems.length);
    expect(items.find((i) => i.id === 'extraction')?.path).toBe('/projects/p1?tab=extraction');
    expect(items.find((i) => i.id === 'extraction')?.active).toBe(true);
    expect(items.find((i) => i.id === 'articles')?.active).toBe(false);
    // Precondition: the workspace group is genuinely absent, not merely last.
    expect(groups.some((g) => g.title === workspaceSectionTitle)).toBe(false);
  });

  it('keeps every project item on the G prefix', () => {
    const groups = deriveSidebarNav({projectId: 'p1', activeTab: 'articles', pathname: '/projects/p1'});

    expect(groups.flatMap((g) => g.items).every((i) => typeof i.shortcut === 'string')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- frontend/components/layout/sidebarConfig.test.ts`
Expected: FAIL — `deriveSidebarNav` and `workspaceSectionTitle` are not exported.

- [ ] **Step 3: Make `SidebarNavItem`'s shortcut optional**

Only the prop and the two places that read it change; the classes stay
byte-identical.

```tsx
// frontend/components/layout/SidebarNavItem.tsx
/**
 * Sidebar nav item: icon + label + optional shortcut badge.
 * See docs/superpowers/design-system/sidebar-and-panels.md §4.
 *
 * `shortcut` is the letter pressed AFTER the `G` prefix. It is optional
 * because the workspace rail's Settings item has no `G`-sequence: `⌘,` is
 * bound app-wide by `useGlobalShortcuts`, and a chip here would advertise a
 * binding this component neither registers nor owns.
 */
import React from 'react';
import type {LucideIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {cn} from '@/lib/utils';

interface SidebarNavItemProps {
  icon: LucideIcon;
  label: string;
  /** Letter pressed after `G`. Omit for an item with no sequence binding. */
  shortcut?: string;
  active: boolean;
  onClick: () => void;
}

export const SidebarNavItem: React.FC<SidebarNavItemProps> = ({
  icon: Icon,
  label,
  shortcut,
  active,
  onClick,
}) => (
  <Button
    variant="ghost"
    aria-current={active ? 'page' : undefined}
    aria-keyshortcuts={shortcut === undefined ? undefined : `G ${shortcut}`}
    onClick={onClick}
    className={cn(
      'w-full justify-start gap-2.5 h-7 px-2.5 rounded-md transition-colors duration-75 group',
      active
        ? 'bg-muted text-foreground font-medium'
        : 'text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground',
    )}
  >
    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-foreground' : 'group-hover:text-foreground/80')} strokeWidth={1.5} />
    <span className="text-[13px] flex-1 text-left truncate">{label}</span>
    {shortcut !== undefined && (
      <KbdBadge
        keys={['G', shortcut]}
        variant="sequence"
        className="opacity-0 transition-opacity duration-75 group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    )}
  </Button>
);
```

- [ ] **Step 4: Cover the new no-shortcut branch**

Append two cases to `frontend/components/layout/SidebarNavItem.test.tsx`
(the five existing cases already pass `shortcut="A"` and stay exactly as they
are — `shortcut` only became optional, not renamed):

```tsx
  it('renders no chip and no aria-keyshortcuts when the item owns no sequence', () => {
    render(<SidebarNavItem icon={Settings} label="Settings" active={false} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-keyshortcuts');
    expect(screen.queryByText('G')).toBeNull();
  });

  it('still marks a shortcut-less item as current', () => {
    render(<SidebarNavItem icon={Settings} label="Settings" active onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'page');
  });
```

and add `Settings` to that file's `lucide-react` import
(`import {FileText, Settings} from 'lucide-react';`).

- [ ] **Step 5: Add the workspace config and the one nav derivation**

Append to `frontend/components/layout/sidebarConfig.ts` (and add `Folder` to
the existing `lucide-react` import):

```ts
/** Workspace-level destinations, shown when no project is open. */
export interface WorkspaceNavItem {
    id: 'hub' | 'settings';
    label: string;
    icon: LucideIcon;
    path: string;
    /** Letter pressed after `G`. Absent when the item owns no sequence. */
    shortcut?: string;
}

export const workspaceSectionTitle = t('layout', 'sectionWorkspace');

/**
 * `G H` is free — project shortcuts use O/C/A/T/E/Q/R. Settings deliberately
 * has none: `⌘,` is bound app-wide by `useGlobalShortcuts`, and this rail
 * neither registers nor owns it.
 */
export const workspaceNavItems: WorkspaceNavItem[] = [
    {id: 'hub', label: t('layout', 'projects'), icon: Folder, path: '/', shortcut: 'H'},
    {id: 'settings', label: t('layout', 'settings'), icon: Settings, path: '/settings'},
];

/** One rendered nav item, already resolved to a destination and a state. */
export interface SidebarNavEntry {
    id: string;
    label: string;
    icon: LucideIcon;
    /** Letter pressed after `G`; absent when the item owns no sequence. */
    shortcut?: string;
    /** Where a click navigates. Navigation is a URL write, never a callback. */
    path: string;
    active: boolean;
}

export interface SidebarNavGroup {
    title: string;
    items: SidebarNavEntry[];
}

/**
 * The sidebar's two states, derived ONCE.
 *
 * The desktop rail and the mobile drawer render the same groups and differ
 * only in chrome (badge vs none, `h-7` vs the drawer's touch target, and the
 * drawer closing itself after navigating). Writing the ternary out in both
 * files is how the two drifted before; this is the single source.
 *
 * `active` is derived differently in each state on purpose: project sections
 * are selected by `?tab=` (which the full-screen run routes do not carry, so
 * the caller passes `activeTab` explicitly), workspace destinations by the
 * pathname.
 */
export function deriveSidebarNav({
    projectId,
    activeTab,
    pathname,
}: {
    projectId: string | null;
    activeTab: string;
    pathname: string;
}): SidebarNavGroup[] {
    if (projectId === null) {
        return [
            {
                title: workspaceSectionTitle,
                items: workspaceNavItems.map((item) => ({
                    id: item.id,
                    label: item.label,
                    icon: item.icon,
                    shortcut: item.shortcut,
                    path: item.path,
                    active: pathname === item.path,
                })),
            },
        ];
    }

    return sidebarSections.map((section) => ({
        title: section.title,
        items: section.items.map((item) => ({
            id: item.id,
            label: item.label,
            icon: item.icon,
            shortcut: item.shortcut,
            path: `/projects/${projectId}?tab=${item.id}`,
            active: activeTab === item.id,
        })),
    }));
}
```

- [ ] **Step 6: Add the one new copy key**

In `frontend/lib/copy/layout.ts`, add below `sectionReview`:

```ts
    sectionWorkspace: 'Workspace',
```

- [ ] **Step 7: Add the brand header**

```tsx
// frontend/components/layout/SidebarBrandHeader.tsx
/**
 * Brand identity for the sidebar's no-project state. The Topbar used to own
 * the `R` + "Prumo" block on `/`; with the breadcrumb bar naming the page, the
 * sidebar header owns brand instead (ledger 2026-09-07T14:50Z).
 * Height matches SidebarHeader's `h-12` so the two states do not jump.
 */
import React from 'react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

export const BrandMark: React.FC<{className?: string}> = ({className}) => (
  <div className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary', className)}>
    <span className="text-[10px] font-bold leading-none text-primary-foreground">R</span>
  </div>
);

export const SidebarBrandHeader: React.FC = () => (
  <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/40 px-3">
    <BrandMark />
    <span className="truncate text-[13px] font-medium tracking-tight text-foreground">
      {t('navigation', 'topbarBrandFull')}
    </span>
  </div>
);
```

- [ ] **Step 8: Run the tests, typecheck and lint**

No existing call site changes: `ProjectSidebar` already passes
`shortcut={item.shortcut}`, and `MobileSidebar` renders raw `Button`s rather
than `SidebarNavItem`. Making a required prop optional is source-compatible, so
the tree stays green without a shim.

Run: `npm run test:run -- frontend/components/layout/SidebarNavItem.test.tsx frontend/components/layout/sidebarConfig.test.ts`
Expected: PASS (7 + 5 tests).

Run: `npm run typecheck && npm run lint`
Expected: exit 0 on both.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/layout/SidebarNavItem.tsx frontend/components/layout/SidebarNavItem.test.tsx \
        frontend/components/layout/SidebarBrandHeader.tsx frontend/components/layout/sidebarConfig.ts \
        frontend/components/layout/sidebarConfig.test.ts frontend/lib/copy/layout.ts
git commit -m "feat(sidebar): derive the nav once, add the workspace config and the brand header"
```

---

### Task 4: the sidebar's two states, navigating by URL

**Files:**
- Modify: `frontend/components/layout/ProjectSidebar.tsx` (whole file)
- Modify: `frontend/components/layout/MobileSidebar.tsx` (whole file)
- Modify: `frontend/components/layout/AppLayout.tsx:37-72` (prop shim; deleted in Task 6)
- Modify: `frontend/components/runs/RunWorkspaceShell.tsx:25-50`
- Modify: `frontend/test/RunWorkspaceShell.test.tsx:10-15`
- Modify: `scripts/fitness/check_button_scale.baseline`
- Test: `frontend/components/layout/ProjectSidebar.test.tsx`
- Test: `frontend/test/projectSectionNav.test.tsx`

**Interfaces:**
- Consumes: `deriveSidebarNav`, `SidebarBrandHeader`, `BrandMark` (Task 3).
- Produces: `ProjectSidebar` and `MobileSidebar` props become
  `{projectId: string | null; activeTab: string; projectName?: string; ...}` —
  `onTabChange` is gone. Consumed by Task 6 (`AppShell`) and by
  `RunWorkspaceShell`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/layout/ProjectSidebar.test.tsx
/**
 * One chrome, two states (spec §4). The no-project assertions also assert
 * their PRECONDITION — that `projectId` really was null — via the positive
 * control below: the same render path with a project id must produce the
 * project rail, so an empty render cannot pass either group vacuously.
 */
import {describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router';
import {SidebarProvider} from '@/contexts/SidebarContext';
import {ProjectSidebar} from './ProjectSidebar';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
// The footer pulls in the authed user menu; not under test here.
vi.mock('./SidebarFooter', () => ({SidebarFooter: () => <div data-testid="sidebar-footer" />}));
vi.mock('./SidebarHeader', () => ({
  SidebarHeader: ({projectName}: {projectName?: string}) => (
    <div data-testid="project-switcher">{projectName}</div>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="url">{`${location.pathname}${location.search}`}</output>;
}

function renderSidebar(projectId: string | null, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <ProjectSidebar projectId={projectId} activeTab="articles" projectName="Alpha" />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('ProjectSidebar', () => {
  it('positive control — with a project id it renders the project rail', () => {
    renderSidebar('p1', '/projects/p1');
    expect(screen.getByTestId('project-switcher')).toHaveTextContent('Alpha');
    expect(screen.getByRole('button', {name: 'navArticles'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'projects'})).toBeNull();
  });

  it('with no project id it renders brand + WORKSPACE, not the switcher', () => {
    renderSidebar(null, '/');
    expect(screen.queryByTestId('project-switcher')).toBeNull();
    expect(screen.getByText('topbarBrandFull')).toBeInTheDocument();
    expect(screen.getByText('sectionWorkspace')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'projects'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'settings'})).toBeInTheDocument();
    // Project nav is genuinely absent, not merely unrendered chrome.
    expect(screen.queryByRole('button', {name: 'navArticles'})).toBeNull();
  });

  it('keeps the footer in both states', () => {
    renderSidebar(null, '/');
    expect(screen.getByTestId('sidebar-footer')).toBeInTheDocument();
  });

  it('marks the current workspace destination', () => {
    renderSidebar(null, '/settings');
    expect(screen.getByRole('button', {name: 'settings'})).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', {name: 'projects'})).not.toHaveAttribute('aria-current');
  });

  it('navigates a project section by writing the URL', async () => {
    renderSidebar('p1', '/projects/p1?tab=articles');
    await userEvent.click(screen.getByRole('button', {name: 'navDataExtraction'}));
    expect(screen.getByTestId('url')).toHaveTextContent('/projects/p1?tab=extraction');
  });

  it('navigates a workspace destination by writing the URL', async () => {
    renderSidebar(null, '/');
    await userEvent.click(screen.getByRole('button', {name: 'settings'}));
    expect(screen.getByTestId('url')).toHaveTextContent('/settings');
  });
});
```

- [ ] **Step 2: Write the other half of the inversion's test**

The test above proves the sidebar WRITES `?tab=`. Spec §8 requires both
clauses — "Clicking a project section writes `?tab=`, **and `ProjectContext`
follows**" — and the second one is the assumption the whole inversion rests on:
`ProjectView` still picks the rendered section from `useProject().activeTab`
(`frontend/pages/ProjectView.tsx:29`), and `ProjectProvider` both syncs from
the URL during render (`ProjectContext.tsx:42-48`) and writes `activeTab` back
to the URL in an effect (`:55-59`). Nothing in the suite mounts the provider
today, so if the write-back ever won, the sidebar would silently stop working.

```tsx
// frontend/test/projectSectionNav.test.tsx
/**
 * The sidebar writes the URL; ProjectContext follows (spec §3.2 / §8).
 *
 * The harness mirrors AppShell exactly minus chrome: the sidebar is a sibling
 * of ProjectProvider, not a child, because the shell renders above the
 * provider — so this also pins that the provider's mount-time `?tab=` write
 * does not clobber a section the sidebar just pushed.
 */
import {describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, Route, Routes} from 'react-router';
import {SidebarProvider} from '@/contexts/SidebarContext';
import {ProjectProvider, useProject} from '@/contexts/ProjectContext';
import {ProjectSidebar} from '@/components/layout/ProjectSidebar';
import {useShellLocation} from '@/hooks/useShellLocation';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/components/layout/SidebarFooter', () => ({SidebarFooter: () => null}));
vi.mock('@/components/layout/SidebarHeader', () => ({SidebarHeader: () => null}));

function SectionProbe() {
  const {activeTab} = useProject();
  return <output data-testid="section">{activeTab}</output>;
}

function ShellLike() {
  const {projectId, activeSection} = useShellLocation();
  return (
    <>
      <ProjectSidebar projectId={projectId} activeTab={activeSection ?? ''} />
      <ProjectProvider>
        <SectionProbe />
      </ProjectProvider>
    </>
  );
}

function renderProjectRoute() {
  return render(
    <MemoryRouter initialEntries={['/projects/p1?tab=articles']}>
      <SidebarProvider>
        <Routes>
          <Route path="/projects/:projectId" element={<ShellLike />} />
        </Routes>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('sidebar navigation reaches ProjectContext', () => {
  it('starts on the section the URL names', () => {
    renderProjectRoute();
    // Precondition for the next test: the probe is live and reads 'articles',
    // so a later 'extraction' cannot be a coincidence of an empty render.
    expect(screen.getByTestId('section')).toHaveTextContent('articles');
  });

  it('a section click changes the section ProjectContext reports', async () => {
    renderProjectRoute();

    await userEvent.click(screen.getByRole('button', {name: 'navDataExtraction'}));

    expect(await screen.findByTestId('section')).toHaveTextContent('extraction');
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npm run test:run -- frontend/components/layout/ProjectSidebar.test.tsx frontend/test/projectSectionNav.test.tsx`
Expected: FAIL in both — `projectId` is not a prop of `ProjectSidebar` and the
required `onTabChange` is missing.

- [ ] **Step 4: Rewrite `ProjectSidebar`**

```tsx
// frontend/components/layout/ProjectSidebar.tsx
/**
 * The app sidebar: one ResizablePanel, two states.
 *
 * - project open  → project switcher header + today's project sections
 * - no project    → brand header + a WORKSPACE section
 *
 * Both states keep SidebarFooter, which is what makes the account menu, theme
 * toggle and feedback button reachable from the hub (spec §4).
 *
 * The two states' item lists come from `deriveSidebarNav`, shared with
 * MobileSidebar — this file owns chrome, not branching.
 *
 * Navigation writes the URL rather than calling a prop-drilled `onTabChange`;
 * ProjectContext already syncs `activeTab` FROM the URL during render, so it
 * follows without change (spec §3.2, asserted in
 * `frontend/test/projectSectionNav.test.tsx`). `activeTab` stays a prop
 * because the full-screen run routes have no `?tab=` to derive it from.
 *
 * See docs/superpowers/design-system/sidebar-and-panels.md (§2 sizing:
 * 280 / 240 / 400 / 150).
 */
import React from 'react';
import {useLocation, useNavigate} from 'react-router';
import {ResizablePanel} from '@/components/ui/resizable-panel';
import {SidebarHeader} from './SidebarHeader';
import {SidebarBrandHeader} from './SidebarBrandHeader';
import {SidebarSection} from './SidebarSection';
import {SidebarNavItem} from './SidebarNavItem';
import {SidebarFooter} from './SidebarFooter';
import {deriveSidebarNav} from './sidebarConfig';
import {useSidebar} from '@/contexts/SidebarContext';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface ProjectSidebarProps {
  /** Null on `/` and `/settings`: the sidebar renders its workspace state. */
  projectId: string | null;
  activeTab: string;
  projectName?: string;
  switcherOpen?: boolean;
  onSwitcherOpenChange?: (open: boolean) => void;
  className?: string;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  projectId,
  activeTab,
  projectName,
  switcherOpen,
  onSwitcherOpenChange,
  className,
}) => {
  const {sidebarCollapsed, toggleSidebar} = useSidebar();
  const navigate = useNavigate();
  const {pathname} = useLocation();
  const groups = deriveSidebarNav({projectId, activeTab, pathname});

  return (
    <ResizablePanel
      id="sidebar"
      side="right"
      defaultWidth={280}
      minWidth={240}
      maxWidth={400}
      snapCollapseAt={150}
      collapsed={sidebarCollapsed}
      onCollapse={toggleSidebar}
      tooltipLabel={t('layout', 'resizeHandleTooltip')}
      shortcut={['mod', 'B']}
      className={cn(
        'bg-[#fafafa] dark:bg-[#0c0c0c] border-r border-border/40 hidden lg:block',
        className,
      )}
    >
      <div className="flex flex-col h-full">
        {projectId !== null ? (
          <SidebarHeader projectName={projectName} open={switcherOpen} onOpenChange={onSwitcherOpenChange} />
        ) : (
          <SidebarBrandHeader />
        )}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {groups.map((group) => (
            <SidebarSection key={group.title} title={group.title}>
              {group.items.map((item) => (
                <SidebarNavItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  shortcut={item.shortcut}
                  active={item.active}
                  onClick={() => navigate(item.path)}
                />
              ))}
            </SidebarSection>
          ))}
        </nav>
        <SidebarFooter />
      </div>
    </ResizablePanel>
  );
};
```

- [ ] **Step 5: Rewrite `MobileSidebar` to match**

```tsx
// frontend/components/layout/MobileSidebar.tsx
/**
 * Mobile sidebar (Sheet): the same two states as ProjectSidebar, from the same
 * `deriveSidebarNav`, with no badges and no resize. Navigation writes the URL
 * and closes the drawer.
 *
 * No `h-8` here: the Button scale owns height, and its `sm` tier already
 * carries `[@media(pointer:coarse)]:h-11`, so the drawer gets a 44px touch
 * target on exactly the devices it exists for — better than the fixed 32px it
 * used to hardcode. That override was the file's one entry in
 * `check_button_scale.baseline`, and this rewrite is what lets the baseline
 * shrink (Step 9) rather than hiding the override behind a helper the gate's
 * tag walk cannot see.
 */
import React from 'react';
import {useLocation, useNavigate} from 'react-router';
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {Button} from '@/components/ui/button';
import {SidebarSection} from './SidebarSection';
import {SidebarFooter} from './SidebarFooter';
import {BrandMark} from './SidebarBrandHeader';
import {deriveSidebarNav} from './sidebarConfig';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface MobileSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null on `/` and `/settings`: the drawer renders its workspace state. */
  projectId: string | null;
  activeTab: string;
  projectName?: string;
}

export const MobileSidebar: React.FC<MobileSidebarProps> = ({open, onOpenChange, projectId, activeTab, projectName}) => {
  const navigate = useNavigate();
  const {pathname} = useLocation();
  const groups = deriveSidebarNav({projectId, activeTab, pathname});

  const go = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[280px] max-w-[85vw] p-0">
        <div className="flex flex-col h-full">
          <SheetHeader className="px-3 py-3 pr-12 border-b border-border/40 shrink-0">
            <div className="flex items-center gap-2.5">
              {projectId !== null ? (
                <div className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center shrink-0 border border-primary/15">
                  <span className="text-[10px] font-semibold text-primary leading-none">
                    {(projectName || 'P')[0].toUpperCase()}
                  </span>
                </div>
              ) : (
                <BrandMark />
              )}
              <SheetTitle className="flex-1 text-left text-[13px] font-medium truncate text-foreground">
                {projectId !== null
                  ? projectName || t('layout', 'defaultProjectName')
                  : t('navigation', 'topbarBrandFull')}
              </SheetTitle>
            </div>
          </SheetHeader>

          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            {groups.map((group) => (
              <SidebarSection key={group.title} title={group.title}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Button
                      key={item.id}
                      variant="ghost"
                      onClick={() => go(item.path)}
                      aria-current={item.active ? 'page' : undefined}
                      className={cn(
                        'w-full justify-start gap-2.5 px-2.5 rounded-md transition-colors duration-75',
                        item.active
                          ? 'bg-muted text-foreground font-medium'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', item.active && 'text-foreground')} strokeWidth={1.5} />
                      <span className="text-[13px]">{item.label}</span>
                    </Button>
                  );
                })}
              </SidebarSection>
            ))}
          </nav>

          <SidebarFooter />
        </div>
      </SheetContent>
    </Sheet>
  );
};
```

- [ ] **Step 6: Shim `AppLayout` so the tree stays green**

`ProjectLayout` is the third caller of both sidebars and is deleted in Task 6.
Leaving it broken for one commit would push a knowingly red `tsc` past the
repo's own pre-push gate, so it carries the new props for one task instead. In
`frontend/components/layout/AppLayout.tsx`, add `useParams` to the react-router
import and change `ProjectLayout`'s two sidebar usages:

```tsx
import {Outlet, useParams} from 'react-router';
```

```tsx
  const {project, activeTab, changeTab} = useProject();
  const {projectId} = useParams<{projectId: string}>();
```

```tsx
      <MobileSidebar
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        projectId={projectId ?? null}
        activeTab={activeTab}
        projectName={project?.name}
      />
```

```tsx
        <ProjectSidebar
          projectId={projectId ?? null}
          activeTab={activeTab}
          projectName={project?.name}
          switcherOpen={switcherOpen}
          onSwitcherOpenChange={setSwitcherOpen}
        />
```

`changeTab` stays in the destructure — `handleNavigate` still uses it until
Task 5 rewrites the shortcut hook.

- [ ] **Step 7: Adapt `RunWorkspaceShell` to the new props**

This is a prop swap only — `goToTab` did exactly what the sidebar now does
internally. Nothing else in the focus shell changes (spec §3.3). In
`frontend/components/runs/RunWorkspaceShell.tsx`, delete `goToTab` and its
comment block and replace both sidebar usages:

```tsx
        <ProjectSidebar
          projectId={projectId}
          activeTab={activeTab}
          switcherOpen={switcherOpen}
          onSwitcherOpenChange={setSwitcherOpen}
        />
        {/* Below `lg` the ProjectSidebar is display:none; this overlay is how
            phone/tablet users in focus mode reach project navigation. Opened by
            the RunHeader.MobileNav hamburger via shared SidebarContext state. */}
        <MobileSidebar
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          projectId={projectId}
          activeTab={activeTab}
        />
```

`useNavigate` becomes unused in that file — delete the import and the
`const navigate = useNavigate();` line.

- [ ] **Step 8: Update the `RunWorkspaceShell` test's sidebar mock**

In `frontend/test/RunWorkspaceShell.test.tsx`, replace the `useProjectsList`
mock (the hook no longer exposes `loadProjects` and is not reached anyway) and
keep the sidebar mock signature honest:

```tsx
vi.mock('@/components/layout/ProjectSidebar', () => ({
  ProjectSidebar: ({ activeTab }: { activeTab: string }) => <aside data-testid="project-sidebar">{activeTab}</aside>,
}));
// The footer pulls in the authed user menu; not under test here.
vi.mock('@/components/layout/SidebarFooter', () => ({ SidebarFooter: () => null }));
vi.mock('@/hooks/useProjectsList', () => ({
  useProjectsList: () => ({ projects: [], loading: false, switchProject: vi.fn() }),
}));
```

- [ ] **Step 9: Run the tests**

Run: `npm run test:run -- frontend/components/layout/ProjectSidebar.test.tsx frontend/test/projectSectionNav.test.tsx frontend/test/RunWorkspaceShell.test.tsx`
Expected: PASS (6 + 2 + 2 tests). `RunWorkspaceShell.test.tsx` leaves
`MobileSidebar` unmocked and opens the drawer, so its second test is also the
regression guard for the rewritten drawer's project branch.

- [ ] **Step 10: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: exit 0 on both. `AppLayout` was shimmed in Step 6, so nothing is
knowingly broken at this commit.

- [ ] **Step 11: Tighten the button-scale baseline**

Run: `python3 scripts/fitness/check_button_scale.py --update-baseline`
Then: `git diff scripts/fitness/check_button_scale.baseline`
Expected: exactly one line removed —
`frontend/components/layout/MobileSidebar.tsx:1` — and none added. If a line is
ADDED, a height override slipped into the rewrite; remove it rather than
baselining it.

- [ ] **Step 12: Commit**

```bash
git add frontend/components/layout/ProjectSidebar.tsx frontend/components/layout/ProjectSidebar.test.tsx \
        frontend/components/layout/MobileSidebar.tsx frontend/components/layout/AppLayout.tsx \
        frontend/components/runs/RunWorkspaceShell.tsx \
        frontend/test/RunWorkspaceShell.test.tsx frontend/test/projectSectionNav.test.tsx \
        scripts/fitness/check_button_scale.baseline
git commit -m "feat(sidebar): add the no-project state and invert navigation to the URL"
```

---

### Task 5: URL-driven navigation shortcuts, with `G H` for the hub

Ledger discrepancy D: `G P`'s handler closes over `useState` in `ProjectLayout`,
which never mounts on `/`, so **no** `G`-chord fires there today. Lifting the
registration into the shell fixes the whole family at once.

**Files:**
- Modify: `frontend/hooks/useNavigationShortcuts.ts` (whole file)
- Modify: `frontend/components/layout/AppLayout.tsx:37-49` (shim; deleted in Task 6)
- Test: `frontend/test/hooks/useNavigationShortcuts.test.tsx`

**Interfaces:**
- Produces: `useNavigationShortcuts({projectId, onToggleSidebar, onOpenProjectSwitcher}): void`.
  Consumed by Task 6 (`AppShell`).

- [ ] **Step 1: Write the failing test**

The defect this task fixes is one only a keystroke can catch: a binding
registered against state that never mounts type-checks, lints, renders and
fails in total silence. The hook has no test at any layer today
(`grep -rn "useNavigationShortcuts" frontend` finds only `AppLayout.tsx`, a
comment in `sidebarConfig.ts` and the hook itself), so a rewrite with no test
would ship spec §4.1 unverified. The harness shape is the repo's own, from
`frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx`.

```tsx
// frontend/test/hooks/useNavigationShortcuts.test.tsx
/**
 * Real keydowns against the real hook.
 *
 * Ledger discrepancy D: `G P`'s handler closed over `useState` in
 * `ProjectLayout`, which never mounts on `/`, so NO `G`-chord fired there and
 * nothing anywhere failed. That is why the assertions below press keys instead
 * of inspecting the bindings array, and why the negative cases carry a
 * positive control in the same render — "nothing happened" must mean the gate
 * held, not that the listener was dead.
 */
import {describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, useLocation} from 'react-router';
import {modifierKey} from '@/lib/platform';
import {useNavigationShortcuts} from '@/hooks/useNavigationShortcuts';

/** Whichever modifier this machine's platform helper actually binds. */
const MOD = modifierKey() === 'metaKey' ? 'Meta' : 'Control';

interface HarnessProps {
  projectId: string | null;
  onToggleSidebar: () => void;
  onOpenProjectSwitcher: () => void;
}

function Harness({projectId, onToggleSidebar, onOpenProjectSwitcher}: HarnessProps) {
  useNavigationShortcuts({projectId, onToggleSidebar, onOpenProjectSwitcher});
  const location = useLocation();
  return <output data-testid="url">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(path: string, projectId: string | null) {
  const onToggleSidebar = vi.fn();
  const onOpenProjectSwitcher = vi.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Harness
        projectId={projectId}
        onToggleSidebar={onToggleSidebar}
        onOpenProjectSwitcher={onOpenProjectSwitcher}
      />
    </MemoryRouter>,
  );
  return {
    onToggleSidebar,
    onOpenProjectSwitcher,
    url: () => screen.getByTestId('url').textContent,
  };
}

describe('useNavigationShortcuts', () => {
  it('G H reaches the hub from a route with no project', async () => {
    const nav = renderAt('/settings', null);

    await userEvent.keyboard('gh');

    expect(nav.url()).toBe('/');
  });

  it('the sidebar chord is registered where no project matched', async () => {
    // Discrepancy D in one line: this used to be registered only inside a
    // layout that never mounted on `/`.
    const nav = renderAt('/', null);

    await userEvent.keyboard(`{${MOD}>}b{/${MOD}}`);

    expect(nav.onToggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('G <letter> opens the matching project section when a project id matched', async () => {
    const nav = renderAt('/projects/p1?tab=articles', 'p1');

    await userEvent.keyboard('ge');

    expect(nav.url()).toBe('/projects/p1?tab=extraction');
  });

  it('G <letter> is not bound without a project id — and the listener is live', async () => {
    const nav = renderAt('/settings', null);

    await userEvent.keyboard('ge');
    expect(nav.url()).toBe('/settings');

    // Positive control: the same listener still serves the workspace binding,
    // so the silence above is the projectId gate, not a dead hook.
    await userEvent.keyboard('gh');
    expect(nav.url()).toBe('/');
  });

  it('G P opens the project switcher when a project id matched', async () => {
    const nav = renderAt('/projects/p1', 'p1');

    await userEvent.keyboard('gp');

    expect(nav.onOpenProjectSwitcher).toHaveBeenCalledTimes(1);
  });

  it('G P is not bound without a project id', async () => {
    const nav = renderAt('/', null);

    await userEvent.keyboard('gp');
    expect(nav.onOpenProjectSwitcher).not.toHaveBeenCalled();

    await userEvent.keyboard(`{${MOD}>}b{/${MOD}}`);
    expect(nav.onToggleSidebar).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- frontend/test/hooks/useNavigationShortcuts.test.tsx`
Expected: FAIL — the hook's current options are
`{enabled, onNavigate, onToggleSidebar, onOpenProjectSwitcher}`, so `projectId`
is not a prop, no binding navigates, and `G H` does not exist.

- [ ] **Step 3: Rewrite the hook**

```ts
// frontend/hooks/useNavigationShortcuts.ts
/**
 * Shell shortcuts.
 *
 * Workspace bindings (`⌘B`, `G H`) are active on every shell route; project
 * bindings (`G <letter>` per section, `G P` for the switcher) only when a
 * project id matched (spec §4.1). Navigation writes the URL — the sidebar and
 * these bindings now share one code path.
 *
 * `⌘,` (settings) and `⌘⇧Q` (sign out) stay in useGlobalShortcuts, which is
 * mounted outside Routes and already works everywhere.
 */
import {useNavigate} from 'react-router';
import {useKeyboardShortcuts, type Binding} from './useKeyboardShortcuts';
import {sidebarItems} from '@/components/layout/sidebarConfig';

interface UseNavigationShortcutsOptions {
  /** Null on `/` and `/settings`: project bindings are not registered. */
  projectId: string | null;
  onToggleSidebar: () => void;
  onOpenProjectSwitcher: () => void;
}

export function useNavigationShortcuts({
  projectId,
  onToggleSidebar,
  onOpenProjectSwitcher,
}: UseNavigationShortcutsOptions): void {
  const navigate = useNavigate();

  const workspaceBindings: Binding[] = [
    {type: 'chord', key: 'b', mod: true, handler: onToggleSidebar},
    {type: 'sequence', prefix: 'g', key: 'h', handler: () => navigate('/')},
  ];

  const projectBindings: Binding[] = projectId === null
    ? []
    : [
        ...sidebarItems.map((item): Binding => ({
          type: 'sequence',
          prefix: 'g',
          key: item.shortcut.toLowerCase(),
          handler: () => navigate(`/projects/${projectId}?tab=${item.id}`),
        })),
        {type: 'sequence', prefix: 'g', key: 'p', handler: onOpenProjectSwitcher},
      ];

  useKeyboardShortcuts({bindings: [...workspaceBindings, ...projectBindings], enabled: true});
}
```

- [ ] **Step 4: Shim `AppLayout` onto the new signature**

`ProjectLayout` is the hook's only caller until Task 6 deletes it, and the
options object just changed shape. In `frontend/components/layout/AppLayout.tsx`,
drop `handleNavigate`, the now-unused `SidebarTabId` import and `changeTab` from
the destructure, and pass the project id instead:

```tsx
  const {project, activeTab} = useProject();
  const {projectId} = useParams<{projectId: string}>();
```

```tsx
  useNavigationShortcuts({
    projectId: projectId ?? null,
    onToggleSidebar: toggleSidebar,
    onOpenProjectSwitcher: () => setSwitcherOpen(true),
  });
```

- [ ] **Step 5: Verify the letters do not collide**

Run: `grep -n "shortcut:" frontend/components/layout/sidebarConfig.ts`
Expected: `O`, `C`, `A`, `T`, `E`, `Q`, `R` for the project sections and `H`
for the hub — `P` is claimed by the switcher and by nothing else.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `npm run test:run -- frontend/test/hooks/useNavigationShortcuts.test.tsx frontend/test/RunWorkspaceShell.test.tsx`
Expected: PASS (6 + 2 tests). `RunWorkspaceShell` registers its own `⌘B`
through `useKeyboardShortcuts` directly and never imports this hook, so it is a
blast-radius check, not coverage — the coverage is the first file.

Run: `npm run typecheck && npm run lint`
Expected: exit 0 on both.

- [ ] **Step 7: Commit**

```bash
git add frontend/hooks/useNavigationShortcuts.ts frontend/test/hooks/useNavigationShortcuts.test.tsx \
        frontend/components/layout/AppLayout.tsx
git commit -m "feat(shortcuts): register nav bindings from the shell and add G H for the hub"
```

---

### Task 6: `AppShell` — one shell for `/`, `/projects/:projectId` and `/settings`

**Files:**
- Create: `frontend/components/layout/AppShell.tsx`
- Delete: `frontend/components/layout/AppLayout.tsx`
- Modify: `frontend/App.tsx`
- Modify: `frontend/pages/Dashboard.tsx`
- Modify: `frontend/test/legacyArticleRoutes.test.tsx:29-31`
- Test: `frontend/test/appShell.routes.test.tsx`

**Interfaces:**
- Consumes: `useShellLocation` (Task 1), `useProjectsQuery` (Task 2),
  `ProjectSidebar` / `MobileSidebar` (Task 4), `useNavigationShortcuts` (Task 5).
- Produces: `AppShell: React.FC` rendering `<Outlet/>`. The shell root carries
  `data-testid="app-shell"` and `data-project-id`, which Task 7's tests also use.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/test/appShell.routes.test.tsx
/**
 * One shell wraps `/`, `/settings` and `/projects/:projectId` (spec §3).
 *
 * The no-project assertions carry their PRECONDITION: `data-project-id` is the
 * shell's own derivation rendered into the DOM, so "the sidebar showed the
 * workspace state" cannot pass against a shell that matched a project id and
 * simply failed to render its rail — and the positive control on a project
 * route proves the same render path does produce the project state.
 */
import {render, screen, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The App module graph statically reaches the Supabase client, which throws at
// import time without a URL. CI runs vitest with no .env.
vi.hoisted(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');
});

vi.mock('@/contexts/AuthContext', () => ({
    AuthProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
    useAuth: () => ({user: {id: 'u1'}, session: null, loading: false, signOut: vi.fn()}),
}));

// Page bodies are not under test; the shell around them is.
vi.mock('@/pages/Dashboard', () => ({default: () => <div>hub page</div>}));
vi.mock('@/pages/ProjectView', () => ({default: () => <div>project view</div>}));
vi.mock('@/pages/UserSettings', () => ({default: () => <div>settings page</div>}));
// The footer pulls in the authed user menu and the feedback dialog.
vi.mock('@/components/layout/SidebarFooter', () => ({
    SidebarFooter: () => <div data-testid="sidebar-footer" />,
}));
vi.mock('@/hooks/useProjectsQuery', () => ({
    useProjectsQuery: () => ({
        data: [{id: 'p1', name: 'Alpha', description: null, created_at: '2026-01-01T00:00:00Z', is_active: true, review_title: null}],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
    }),
}));

import App from '@/App';

function renderAt(path: string) {
    window.history.pushState({}, '', path);
    render(<App/>);
}

describe('AppShell', () => {
    beforeEach(() => {
        window.history.pushState({}, '', '/');
    });

    it('positive control — a project route yields a project id and the project rail', async () => {
        renderAt('/projects/p1?tab=articles');

        const shell = await screen.findByTestId('app-shell');
        expect(shell).toHaveAttribute('data-project-id', 'p1');
        expect(within(shell).getByRole('button', {name: 'Articles'})).toBeInTheDocument();
        expect(await screen.findByText('project view')).toBeInTheDocument();
    });

    it('renders the workspace shell on / — and the route match yielded no project id', async () => {
        renderAt('/');

        const shell = await screen.findByTestId('app-shell');
        expect(shell).toHaveAttribute('data-project-id', '');
        expect(within(shell).getByRole('button', {name: 'Projects'})).toBeInTheDocument();
        expect(within(shell).getByRole('button', {name: 'Settings'})).toBeInTheDocument();
        expect(within(shell).queryByRole('button', {name: 'Articles'})).toBeNull();
        expect(screen.getByTestId('sidebar-footer')).toBeInTheDocument();
        expect(await screen.findByText('hub page')).toBeInTheDocument();
    });

    it('renders the workspace shell on /settings — and the route match yielded no project id', async () => {
        renderAt('/settings');

        const shell = await screen.findByTestId('app-shell');
        expect(shell).toHaveAttribute('data-project-id', '');
        expect(screen.getByTestId('sidebar-footer')).toBeInTheDocument();
        expect(await screen.findByText('settings page')).toBeInTheDocument();
    });

    it('does not wrap the full-screen run routes', async () => {
        renderAt('/projects/p1/extraction/a9');

        expect(await screen.findByTestId('sidebar-footer')).toBeInTheDocument();
        // RunWorkspaceShell, not AppShell: no Topbar, hence no app-shell root.
        expect(screen.queryByTestId('app-shell')).toBeNull();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- frontend/test/appShell.routes.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="app-shell"]`.

- [ ] **Step 3: Write `AppShell`**

```tsx
// frontend/components/layout/AppShell.tsx
/**
 * The one authenticated shell: Topbar + sidebar + mobile drawer around every
 * shell route (`/`, `/projects/:projectId`, `/settings`).
 *
 * It derives everything from the URL and deliberately does NOT consume
 * ProjectContext — ProjectProvider writes `?tab=` in a mount effect and stays
 * wrapping ProjectView alone (spec §3.1). It owns `switcherOpen` so `G P` no
 * longer closes over state that only exists inside a project route (ledger
 * discrepancy D).
 *
 * `data-project-id` renders the derivation so route tests can assert their
 * precondition rather than inferring it from absent markup.
 */
import React, {useState} from 'react';
import {Outlet} from 'react-router';
import {Topbar} from '@/components/navigation';
import {ProjectSidebar} from './ProjectSidebar';
import {MobileSidebar} from './MobileSidebar';
import {useSidebar} from '@/contexts/SidebarContext';
import {useShellLocation} from '@/hooks/useShellLocation';
import {useProjectsQuery} from '@/hooks/useProjectsQuery';
import {useNavigationShortcuts} from '@/hooks/useNavigationShortcuts';

export const AppShell: React.FC = () => {
  const {projectId, activeSection} = useShellLocation();
  const {toggleSidebar, mobileOpen, setMobileOpen} = useSidebar();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const {data: projects} = useProjectsQuery();

  useNavigationShortcuts({
    projectId,
    onToggleSidebar: toggleSidebar,
    onOpenProjectSwitcher: () => setSwitcherOpen(true),
  });

  // The project name comes from the shared list cache, not ProjectContext, and
  // not a second read: the switcher mounts the same query.
  const projectName = projectId === null
    ? undefined
    : projects?.find((project) => project.id === projectId)?.name;

  return (
    <div
      data-testid="app-shell"
      data-project-id={projectId ?? ''}
      className="flex h-screen flex-col overflow-hidden bg-background"
    >
      <div className="shrink-0">
        <Topbar />
      </div>

      <MobileSidebar
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        projectId={projectId}
        activeTab={activeSection ?? ''}
        projectName={projectName}
      />

      <div className="flex flex-1 overflow-hidden">
        <ProjectSidebar
          projectId={projectId}
          activeTab={activeSection ?? ''}
          projectName={projectName}
          switcherOpen={switcherOpen}
          onSwitcherOpenChange={setSwitcherOpen}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Restructure the router**

Delete `frontend/components/layout/AppLayout.tsx`. In `frontend/App.tsx`:
replace the `ProjectLayout` import with `AppShell`, wrap `<Routes>` in
`<SidebarProvider>`, and collapse the three shell routes into one layout route.

```tsx
import {AppShell} from "./components/layout/AppShell";
```

```tsx
                    <GlobalShortcuts>
                    <SidebarProvider>
                    <Routes>
                  <Route path="/auth" element={<Auth />} />
                        <Route path={RESET_PASSWORD_PATH} element={<ResetPassword/>}/>
                  <Route
                    element={
                      <ProtectedRoute>
                        <AppShell />
                      </ProtectedRoute>
                    }
                  >
                    <Route
                      path="/"
                      element={
                        <ErrorBoundary context={t('common', 'errorContextDashboard')}>
                          <Dashboard />
                        </ErrorBoundary>
                      }
                    />
                    <Route
                      path="/projects/:projectId"
                      element={
                        <ErrorBoundary context={t('common', 'errorContextProjectView')}>
                          <ProjectProvider>
                            <ProjectView />
                          </ProjectProvider>
                        </ErrorBoundary>
                      }
                    />
                    <Route
                      path="/settings"
                      element={
                        <ErrorBoundary context={t('common', 'errorContextUserSettings')}>
                          <UserSettings />
                        </ErrorBoundary>
                      }
                    />
                  </Route>
```

The two full-screen run routes and the `*` catch-all stay exactly where they
are, outside the layout route. Close the new provider after `</Routes>`:

```tsx
                    </Routes>
                    </SidebarProvider>
                    </GlobalShortcuts>
```

`SidebarProvider` is no longer imported per-route inside the project element —
keep the top-level import.

- [ ] **Step 5: De-chrome the hub page**

`Dashboard` no longer opens its own layout. In `frontend/pages/Dashboard.tsx`:

1. Delete the `AppLayout` import and every `<AppLayout>` / `</AppLayout>` wrapper
   in the three return branches.
2. Delete `SHELL_PADDING_X` (line 18) and the `cn` import if it becomes unused.
3. Delete the `<h1>` title from `header` — the breadcrumb names the page
   (ledger 2026-09-07T14:50Z) — and delete the `dashboardMyProjects` key from
   `frontend/lib/copy/pages.ts`.
4. Because the shell is `h-screen overflow-hidden`, the hub must scroll itself.

The page's outer shape becomes:

```tsx
  const header = (
    <div className="@container/hubbar sticky top-0 z-10 shrink-0 border-b border-border/40 bg-background/80 px-4 backdrop-blur-md lg:px-6">
      <div className="flex h-12 items-center justify-end gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => setAddDialogOpen(true)}
          disabled={creating}
          className="gap-1.5 rounded-md text-[12px] font-medium shadow-xs transition-all motion-reduce:transition-none"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true"/>
          {t('pages', 'dashboardNewProject')}
        </Button>
      </div>
    </div>
  );
```

and each branch becomes `<>{header}<div className="min-h-0 flex-1 overflow-y-auto">…</div></>`.
Replace every remaining `SHELL_PADDING_X` occurrence with the literal
`"px-4 lg:px-6"` (rows and empty state), and the skeleton/error blocks keep
`py-3` / `py-6` as they are.

- [ ] **Step 6: Repoint the legacy-route test's layout mock**

`frontend/test/legacyArticleRoutes.test.tsx` mocks a module that no longer
exists. Replace lines 29–31 with:

```tsx
vi.mock('@/components/layout/AppShell', () => ({
    AppShell: () => <Outlet/>,
}));
```

and add `import {Outlet} from 'react-router';` at the top of that file (after
the testing-library import).

- [ ] **Step 7: Run both route test files**

Run: `npm run test:run -- frontend/test/appShell.routes.test.tsx frontend/test/legacyArticleRoutes.test.tsx`
Expected: PASS (4 + 3 tests).

Note: at this point the Topbar still computes `isProjectPage` from
`window.location` and still consumes `ProjectContext`, which is now above it —
so the section title and `SectionViewSwitcher` are temporarily inert on project
routes. Task 7 fixes both. The tests above deliberately assert nothing about
either.

- [ ] **Step 8: Typecheck, lint and dead code**

Run: `npm run typecheck && npm run lint && npm run deadcode && npm run deadcode:production`
Expected: exit 0 on all four.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/layout/AppShell.tsx frontend/App.tsx frontend/pages/Dashboard.tsx \
        frontend/test/appShell.routes.test.tsx frontend/test/legacyArticleRoutes.test.tsx \
        frontend/lib/copy/pages.ts
git rm frontend/components/layout/AppLayout.tsx
git commit -m "feat(shell): wrap the hub, project and settings routes in one AppShell"
```

---

### Task 7: the top bar becomes a route-derived breadcrumb bar

Resolved design, ledger 2026-09-07T14:50Z. `HeaderShell` is kept verbatim —
`h-12`, sticky, `frosted-header`, `z-header`, and the `@container/headerbar`
declaration, which three descendants key off and which must not be dropped.

**Files:**
- Create: `frontend/components/navigation/Breadcrumb.tsx`
- Create: `frontend/components/navigation/Breadcrumb.test.tsx`
- Modify: `frontend/components/navigation/Topbar.tsx` (whole file)
- Modify: `frontend/components/navigation/SectionViewSwitcher.tsx:1-31`
- Modify: `frontend/components/navigation/SectionViewSwitcher.test.tsx:1-32`
- Modify: `frontend/lib/copy/navigation.ts`
- Modify: `frontend/test/appShell.routes.test.tsx` (extend)

**Interfaces:**
- Consumes: `useShellLocation` (Task 1), `useProjectsQuery` (Task 2),
  `tabIdToLabel` + `sectionDescriptionKey` (existing).
- Produces: `AppBreadcrumb: React.FC` from `Breadcrumb.tsx`.

- [ ] **Step 1: Write the failing assertions**

Append to `frontend/test/appShell.routes.test.tsx`, inside the same `describe`:

```tsx
    it('names the page in a breadcrumb on every shell route', async () => {
        renderAt('/');
        const crumbs = await screen.findByRole('navigation', {name: 'Breadcrumb'});
        expect(within(crumbs).getByText('Projects')).toBeInTheDocument();
    });

    it('shows project › section on a project route', async () => {
        renderAt('/projects/p1?tab=extraction');
        const crumbs = await screen.findByRole('navigation', {name: 'Breadcrumb'});
        expect(within(crumbs).getByText('Alpha')).toBeInTheDocument();
        expect(within(crumbs).getByText('Data extraction')).toBeInTheDocument();
    });

    it('shows Settings on /settings', async () => {
        renderAt('/settings');
        const crumbs = await screen.findByRole('navigation', {name: 'Breadcrumb'});
        expect(within(crumbs).getByText('Settings')).toBeInTheDocument();
    });

    it('offers the sidebar toggle on every shell route, not just project routes', async () => {
        renderAt('/');
        expect(await screen.findByRole('button', {name: 'Toggle sidebar'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Open menu'})).toBeInTheDocument();
    });

    it('drops the Topbar brand block — the sidebar header owns brand now', async () => {
        renderAt('/');
        const shell = await screen.findByTestId('app-shell');
        // Exactly one "Prumo" in the shell: the sidebar brand header.
        expect(within(shell).getAllByText('Prumo')).toHaveLength(1);
    });

    it('keeps the QA view-switcher testid on a quality route', async () => {
        renderAt('/projects/p1?tab=quality');
        expect(await screen.findByTestId('hitl-quality_assessment-tab-assessment')).toBeInTheDocument();
    });
```

The last assertion needs the member-role hook stubbed; add near the other mocks
at the top of the file:

```tsx
vi.mock('@/hooks/useProjectMemberRole', () => ({
    useProjectMemberRole: () => ({role: 'reviewer', isManager: false, loading: false}),
}));
```

Those cover the resolved case through the real app. The breadcrumb's other
three cases need the query driven state by state, which the app-level harness
(one module-scope `useProjectsQuery` mock) cannot do — so they get their own
file rather than perturbing Task 6's harness:

```tsx
// frontend/components/navigation/Breadcrumb.test.tsx
/**
 * The breadcrumb's FOUR states on a project route.
 *
 * `nav[aria-label="Breadcrumb"]` is a landmark. Whatever the shared list read
 * did, it must never render as markup with no accessible content — and
 * `project?.name` being `undefined` covers three genuinely different outcomes:
 *
 *   - the read is still in flight;
 *   - the read FAILED (and on `/projects/:id` the hub's ErrorState is not
 *     mounted, so nothing else on screen would say so);
 *   - the read succeeded and this id is simply not in the caller's list — a
 *     stale bookmark, a revoked membership, or a project the filtered list
 *     does not carry. That is an ordinary outcome, NOT an error, and must not
 *     be dressed as one.
 *
 * The last state is reachable on demand, not hypothetical: Task 14's E2E
 * navigates to `/projects/00000000-0000-0000-0000-000000000000`.
 */
import {cleanup, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router';

let queryState: {data: unknown; isError: boolean};
vi.mock('@/hooks/useProjectsQuery', () => ({useProjectsQuery: () => queryState}));

import {AppBreadcrumb} from '@/components/navigation/Breadcrumb';

const ALPHA = {
    id: 'p1',
    name: 'Alpha',
    description: null,
    created_at: '2026-01-01T00:00:00.000Z',
    is_active: true,
    review_title: null,
};

const IN_FLIGHT = {data: undefined, isError: false};
const FAILED = {data: undefined, isError: true};
const RESOLVED = {data: [ALPHA], isError: false};
const NOT_IN_LIST = {data: [], isError: false};

function renderAt(path: string, state: {data: unknown; isError: boolean}) {
    queryState = state;
    render(
        <MemoryRouter initialEntries={[path]}>
            <AppBreadcrumb/>
        </MemoryRouter>,
    );
    return screen.getByRole('navigation', {name: 'Breadcrumb'});
}

describe('AppBreadcrumb', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolved — names the project', () => {
        expect(renderAt('/projects/p1', RESOLVED)).toHaveTextContent('Alpha');
    });

    it('in flight — the landmark carries text, not just an aria-hidden shimmer', () => {
        const crumbs = renderAt('/projects/p1', IN_FLIGHT);

        expect(crumbs).toHaveTextContent('Loading projects…');
        expect(crumbs.querySelector('.animate-pulse')).toHaveAttribute('aria-hidden', 'true');
    });

    it('failed — says the project could not be loaded, and stops shimmering', () => {
        const crumbs = renderAt('/projects/p1', FAILED);

        expect(crumbs).toHaveTextContent('Could not load project');
        expect(crumbs.querySelector('.animate-pulse')).toBeNull();
    });

    it('not in the caller\'s list — an unknown project, not a failure', () => {
        const crumbs = renderAt('/projects/p1', NOT_IN_LIST);

        expect(crumbs).toHaveTextContent('Unknown project');
        expect(crumbs).not.toHaveTextContent('Could not load project');
        expect(crumbs.querySelector('.animate-pulse')).toBeNull();
    });

    it('the four states render four different strings', () => {
        // The guard that makes the four assertions above non-vacuous: a
        // refactor folding two branches together would keep every one of them
        // green if both branches happened to render the same text. Same URL
        // throughout, so the section crumb is constant and the root is the
        // only thing that varies.
        const seen = new Set<string>();
        for (const state of [RESOLVED, IN_FLIGHT, FAILED, NOT_IN_LIST]) {
            seen.add(renderAt('/projects/p1', state).textContent ?? '');
            cleanup();
        }
        expect(seen.size).toBe(4);
    });

    it('names the hub and settings, where there is no project to resolve', () => {
        expect(renderAt('/', RESOLVED)).toHaveTextContent('Projects');
        cleanup();
        expect(renderAt('/settings', RESOLVED)).toHaveTextContent('Settings');
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:run -- frontend/test/appShell.routes.test.tsx frontend/components/navigation/Breadcrumb.test.tsx`
Expected: both FAIL — the first with no `navigation` landmark named
"Breadcrumb", two "Prumo" nodes and no toggle on `/`; the second on
`Failed to resolve import "@/components/navigation/Breadcrumb"`.

- [ ] **Step 3: Add the breadcrumb copy keys and delete the orphaned brand key**

In `frontend/lib/copy/navigation.ts`, add next to `topbarBrandFull`:

```ts
    breadcrumbAria: 'Breadcrumb',
    breadcrumbProjectLoadFailed: 'Could not load project',
    breadcrumbProjectNotFound: 'Unknown project',
```

The last two are the breadcrumb's failed and not-in-list roots. They are
deliberately two strings, not one: a failed read is retryable (the switcher
carries the retry) and an id the caller's list does not hold is not.

and **delete `topbarBrand: 'Prumo',`**. Its only reference is the Topbar's
`!user` early return, which goes with the brand block in Step 5. The copy-key
baseline is shrink-only — a newly dead key FAILS the gate, so it must be
deleted, not baselined. `topbarBrandFull` stays: `SidebarBrandHeader` and
`MobileSidebar` now read it (Task 3/4).

Confirm before moving on:

```bash
grep -rn "topbarBrand\b" frontend/ --include=*.tsx --include=*.ts
```

Expected: no hits outside `frontend/lib/copy/navigation.ts` before the delete,
and no hits at all after it.

- [ ] **Step 4: Write the breadcrumb**

```tsx
// frontend/components/navigation/Breadcrumb.tsx
/**
 * Route-derived breadcrumb for the shell's top bar.
 *
 *   /               → Projects
 *   /settings       → Settings
 *   /projects/:id   → <project name> › <section>   (section keeps its info tooltip)
 *
 * This replaces three ad-hoc title treatments — the Topbar brand block, the
 * Topbar section title and the `/settings` PageHeader title — with one
 * (ledger 2026-09-07T14:50Z). Reads the URL, never ProjectContext: the bar now
 * renders above ProjectProvider.
 *
 * The root has FOUR states, not two. `project?.name` being `undefined` covers
 * a read still in flight, a read that FAILED, and an id the caller's list does
 * not contain — and collapsing them into one `aria-hidden` shimmer leaves this
 * landmark permanently empty to a screen reader whenever the list read fails,
 * with the hub's ErrorState not mounted on `/projects/:id` to say otherwise.
 * The switcher (`SidebarHeader`) owns the retry; this bar only has to name
 * what happened.
 */
import React from 'react';
import {ChevronRight, Info} from 'lucide-react';
import {useLocation} from 'react-router';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {TruncatedText} from '@/components/runs/header/TruncatedText';
import {useShellLocation} from '@/hooks/useShellLocation';
import {useProjectsQuery} from '@/hooks/useProjectsQuery';
import {tabIdToLabel} from '@/components/layout/sidebarConfig';
import {sectionDescriptionKey} from '@/components/layout/sectionViews';
import {t} from '@/lib/copy';

type BreadcrumbRoot = {kind: 'loading'} | {kind: 'text'; text: string};

export const AppBreadcrumb: React.FC = () => {
  const {projectId, activeSection} = useShellLocation();
  const location = useLocation();
  const {data: projects, isError} = useProjectsQuery();

  const project = projectId === null ? undefined : projects?.find((p) => p.id === projectId);
  const descriptionKey = activeSection === null ? undefined : sectionDescriptionKey[activeSection];

  // Order matters, and the "still loading" test is `projects === undefined`
  // rather than `isLoading`: that also covers the query disabled under an
  // empty identity, which `isLoading` reports as false.
  let root: BreadcrumbRoot;
  if (projectId === null) {
    root = {
      kind: 'text',
      text: location.pathname === '/settings' ? t('layout', 'settings') : t('layout', 'projects'),
    };
  } else if (project !== undefined) {
    root = {kind: 'text', text: project.name};
  } else if (isError) {
    root = {kind: 'text', text: t('navigation', 'breadcrumbProjectLoadFailed')};
  } else if (projects === undefined) {
    root = {kind: 'loading'};
  } else {
    // Resolved, and this id is not in the caller's list: a stale bookmark, a
    // revoked membership, an id the filtered list does not carry. Ordinary,
    // not a failure — it must not borrow the error string.
    root = {kind: 'text', text: t('navigation', 'breadcrumbProjectNotFound')};
  }

  return (
    <nav
      aria-label={t('navigation', 'breadcrumbAria')}
      className="flex min-w-0 items-center gap-1.5 px-2"
    >
      {root.kind === 'loading' ? (
        // Project route whose name has not resolved yet: the same skeleton the
        // Topbar already uses for its loading state, so the bar does not jump
        // — plus a name, because an aria-hidden shimmer is not a breadcrumb.
        <>
          <span className="h-[13px] w-24 animate-pulse rounded bg-muted" aria-hidden="true" />
          <span className="sr-only">{t('layout', 'loadingProjects')}</span>
        </>
      ) : (
        <TruncatedText className="text-header-title font-medium text-foreground" text={root.text} />
      )}

      {projectId !== null && activeSection !== null && (
        <>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
          <TruncatedText
            className="text-header-title text-muted-foreground"
            text={tabIdToLabel[activeSection] ?? ''}
          />
          {descriptionKey !== undefined && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="hidden rounded text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 @[34rem]/headerbar:inline-flex"
                    aria-label={t('navigation', descriptionKey)}
                  >
                    <Info className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('navigation', descriptionKey)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </>
      )}
    </nav>
  );
};
```

- [ ] **Step 5: Rewrite the Topbar**

```tsx
// frontend/components/navigation/Topbar.tsx
/**
 * The shell's top bar: panel toggle / hamburger + breadcrumb (left),
 * SectionViewSwitcher (centre), NotificationCenter (right).
 *
 * `isProjectPage` used to be read from `window.location`, which never
 * re-rendered on client navigation. That survived only because `/` and
 * `/projects/:id` were separate route trees that remounted the bar; inside
 * AppShell the bar no longer remounts, so the read is now `useShellLocation()`
 * (ledger 2026-09-07T14:33Z — not optional).
 *
 * HeaderShell is kept verbatim: `h-12`, sticky, frosted, `z-header`, and the
 * `@container/headerbar` declaration that the breadcrumb's info button and
 * both SectionViewSwitcher tiers key off.
 */

import React from 'react';
import {Menu} from 'lucide-react';
import {HeaderIconButton} from '@/components/layout/HeaderIconButton';
import {useUserProfile} from '@/hooks/useNavigation';
import {useSidebar} from '@/contexts/SidebarContext';
import {HeaderShell} from '@/components/layout/HeaderShell';
import {PanelToggleButton} from '@/components/layout/PanelToggleButton';
import {useScrolled} from '@/components/layout/useScrolled';
import {NotificationCenter} from './NotificationCenter';
import {AppBreadcrumb} from './Breadcrumb';
import type {TopbarProps} from '@/types/navigation';
import {t} from '@/lib/copy';
import {SectionViewSwitcher} from '@/components/navigation/SectionViewSwitcher';

export const Topbar: React.FC<TopbarProps> = ({className}) => {
  const {isLoading} = useUserProfile();
  const scrolled = useScrolled();
  const {sidebarCollapsed, toggleSidebar, toggleMobile} = useSidebar();

  // Loading state: skeleton with final content dimensions to avoid layout
  // shift. Routed through HeaderShell so it shares the exact final chrome.
  if (isLoading) {
    return (
      <HeaderShell className={className}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="h-5 w-5 shrink-0 animate-pulse rounded bg-muted" />
          <div className="h-[13px] w-28 shrink-0 animate-pulse rounded bg-muted" />
        </div>
      </HeaderShell>
    );
  }

  return (
    <HeaderShell lifted={scrolled} className={className}>
      {/* Left — toggles + breadcrumb (min-w-0 so the crumbs can truncate) */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <HeaderIconButton
          onClick={toggleMobile}
          aria-label={t('navigation', 'ariaOpenMenu')}
          className="lg:hidden"
        >
          <Menu strokeWidth={1.5} aria-hidden="true" />
        </HeaderIconButton>
        <span className="hidden lg:flex">
          <PanelToggleButton
            side="left"
            pressed={!sidebarCollapsed}
            onToggle={toggleSidebar}
            ariaLabel={t('layout', 'sidebarToggleAriaLabel')}
          />
        </span>
        <AppBreadcrumb />
      </div>

      {/* Centre — view switcher (yields width so the crumbs can truncate) */}
      <div className="flex shrink-0 items-center justify-center">
        <SectionViewSwitcher />
      </div>

      {/* Right — notifications */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <NotificationCenter />
      </div>
    </HeaderShell>
  );
};
```

Note: the old `!user` early return is gone with the brand block. `useSidebar()`
is safe here because `SidebarProvider` now sits above `Routes`, so the Topbar
can never render outside it.

- [ ] **Step 6: Take `SectionViewSwitcher` off `ProjectContext`**

It renders above `ProjectProvider` now, so `useContext(ProjectContext)` would
be `undefined` and the switcher — including the load-bearing
`hitl-quality_assessment-tab-*` testid — would silently vanish. Replace the
first 31 lines' context read with the same URL derivation. Only the head of the
file changes; every class name, both tiers and the `data-testid` stay byte-identical.

```tsx
import {useSearchParams} from 'react-router';
import {Check, ChevronDown} from 'lucide-react';
import {useShellLocation} from '@/hooks/useShellLocation';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';
import {getSectionViews} from '@/components/layout/sectionViews';
```

```tsx
export function SectionViewSwitcher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {projectId, activeSection} = useShellLocation();
  const section = activeSection ?? '';
  const hasViews = section === 'extraction' || section === 'quality';
  const {isManager} = useProjectMemberRole(hasViews ? (projectId ?? '') : '');

  const views = getSectionViews(section).filter((v) => !v.managerOnly || isManager);
  if (views.length === 0) return null;

  const urlParam = views[0].urlParam;
  const fromUrl = searchParams.get(urlParam);
  const active = views.some((v) => v.value === fromUrl) ? (fromUrl as string) : views[0].value;
  const activeLabel = views.find((v) => v.value === active)?.label ?? views[0].label;

  const select = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(urlParam, value);
    setSearchParams(next, {replace: true});
  };

  const ariaLabel =
    section === 'quality'
      ? t('navigation', 'viewsQualityAria')
      : t('navigation', 'viewsExtractionAria');
```

In the JSX body, replace the two remaining `activeSection === 'quality'`
occurrences with `section === 'quality'` (the `data-testid` expression and
nothing else).

- [ ] **Step 7: Update the switcher's test harness**

`frontend/components/navigation/SectionViewSwitcher.test.tsx` — replace the
`ProjectContext` wrapper with a URL, since the URL is now the input:

```tsx
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

const roleMock = vi.fn();
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => roleMock(),
}));

import {SectionViewSwitcher} from '@/components/navigation/SectionViewSwitcher';

function renderWith(activeTab: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/p1?tab=${activeTab}`]}>
      <SectionViewSwitcher />
    </MemoryRouter>,
  );
}
```

Then drop the second argument from the two `renderWith('quality', [...])` calls
(the URL now carries the tab), leaving `renderWith('quality')`. Every
`expect(...)` in the file stays as it is.

- [ ] **Step 8: Run the tests**

Run: `npm run test:run -- frontend/test/appShell.routes.test.tsx frontend/components/navigation/Breadcrumb.test.tsx frontend/components/navigation/SectionViewSwitcher.test.tsx`
Expected: PASS (10 + 6 + 5 tests).

- [ ] **Step 9: Full suite, typecheck, lint, dead code**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run deadcode && npm run deadcode:production`
Expected: exit 0 on all five.

- [ ] **Step 10: Commit**

```bash
git add frontend/components/navigation/Breadcrumb.tsx frontend/components/navigation/Breadcrumb.test.tsx \
        frontend/components/navigation/Topbar.tsx \
        frontend/components/navigation/SectionViewSwitcher.tsx \
        frontend/components/navigation/SectionViewSwitcher.test.tsx \
        frontend/lib/copy/navigation.ts frontend/test/appShell.routes.test.tsx
git commit -m "feat(shell): turn the top bar into a route-derived breadcrumb bar"
```

---

### Task 8: `/settings` folds into the shell

**Files:**
- Modify: `frontend/pages/UserSettings.tsx` (whole file)
- Modify: `scripts/fitness/check_copy_keys.baseline`
- Test: `frontend/test/UserSettings.test.tsx`

**Interfaces:**
- Consumes: nothing new. Uses the seven already-defined-but-baselined `user.*`
  keys (`tabProfile`, `tabProfileDesc`, `tabSecurity`, `tabSecurityDesc`,
  `tabIntegrations`, `tabIntegrationsDesc`, `settingsAriaSections`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

This is a whole-page rewrite that introduces a `role="tablist"` structure, keeps
a render-phase URL→tab sync and deletes the title and back control — and both
places `/settings` is otherwise exercised (`frontend/test/appShell.routes.test.tsx`
and Task 7's breadcrumb assertions) mock the page away. Without this file, a
leftover duplicate title or a broken `?tab=integrations` deep link passes every
gate.

```tsx
// frontend/test/UserSettings.test.tsx
/**
 * `/settings` inside the shell.
 *
 * Spec §1's defect was that this page carried its own title and back arrow —
 * "a third navigation model". The breadcrumb names the page now and the
 * sidebar is the way back, so the page must offer neither; that absence is
 * asserted positively (an empty page-header apart from the description, and no
 * buttons at all beside the tabs) rather than by hoping a string is missing.
 */
import {describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter, useLocation} from 'react-router';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/components/user/ProfileSection', () => ({ProfileSection: () => <div>profile section</div>}));
vi.mock('@/components/user/SecuritySection', () => ({SecuritySection: () => <div>security section</div>}));
vi.mock('@/components/user/IntegrationsSection', () => ({IntegrationsSection: () => <div>integrations section</div>}));

import UserSettings from '@/pages/UserSettings';

function UrlProbe() {
  const location = useLocation();
  return <output data-testid="url">{`${location.pathname}${location.search}`}</output>;
}

function renderSettings(path = '/settings') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <UserSettings />
      <UrlProbe />
    </MemoryRouter>,
  );
}

describe('UserSettings', () => {
  it('opens on Profile and marks it selected', () => {
    renderSettings();

    expect(screen.getByRole('tab', {name: 'tabProfile'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', {name: 'tabSecurity'})).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('profile section')).toBeInTheDocument();
  });

  it('names its tablist for assistive tech', () => {
    renderSettings();

    expect(screen.getByRole('tablist', {name: 'settingsAriaSections'})).toBeInTheDocument();
  });

  it('honours a deep link to a tab', () => {
    renderSettings('/settings?tab=integrations');

    expect(screen.getByRole('tab', {name: 'tabIntegrations'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('integrations section')).toBeInTheDocument();
  });

  it('falls back to Profile for an unknown tab', () => {
    renderSettings('/settings?tab=bogus');

    expect(screen.getByRole('tab', {name: 'tabProfile'})).toHaveAttribute('aria-selected', 'true');
  });

  it('switching a tab swaps the panel and writes ?tab=', async () => {
    renderSettings();

    await userEvent.click(screen.getByRole('tab', {name: 'tabSecurity'}));

    expect(screen.getByText('security section')).toBeInTheDocument();
    expect(screen.queryByText('profile section')).toBeNull();
    expect(screen.getByTestId('url')).toHaveTextContent('/settings?tab=security');
  });

  it('shows the active tab description and no page title beside it', () => {
    const {container} = renderSettings();

    const header = container.querySelector('[data-slot="page-header"]') as HTMLElement;
    // Exactly the description — the breadcrumb owns the page name now.
    expect(header.textContent).toBe('tabProfileDesc');
  });

  it('offers no back control — the sidebar is the way back', () => {
    renderSettings();

    // The three tabs are role="tab", so a surviving back arrow would be the
    // only role="button" on the page.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- frontend/test/UserSettings.test.tsx`
Expected: FAIL — today's page renders hardcoded English labels (`Profile`,
`Security`, …) on plain `<button>`s with no `role="tab"` and no
`aria-selected`, plus a `PageHeader` title and an `ArrowLeft` back button.

- [ ] **Step 3: Rewrite the page**

The title and the back button go (the breadcrumb names the page — ledger
2026-09-07T14:50Z); the `PageHeader` keeps only the per-tab description. The
224 px aside stays vertical as page sub-navigation but stops cloning the
sidebar: no `bg-[#fafafa] dark:bg-[#0c0c0c]`, no panel border, inset into the
content area, and it gets the mobile tier it has never had (today it eats 60 %
of a 375 px viewport).

```tsx
/**
 * User settings.
 *
 * Renders inside AppShell, so it owns neither chrome nor a back affordance —
 * the breadcrumb names the page and the sidebar is the way back. The 224px
 * rail is page sub-navigation, not a second sidebar: no panel background, no
 * panel border, and below `md` it becomes a horizontal scrolling tab strip.
 */

import {useState} from 'react';
import {useSearchParams} from 'react-router';
import {cn} from '@/lib/utils';
import {PageHeader} from '@/components/patterns/PageHeader';
import {Plug, Shield, User} from 'lucide-react';
import {ProfileSection} from '@/components/user/ProfileSection';
import {SecuritySection} from '@/components/user/SecuritySection';
import {IntegrationsSection} from '@/components/user/IntegrationsSection';
import {t} from '@/lib/copy';

type TabId = 'profile' | 'security' | 'integrations';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ElementType;
  description: string;
}

const TABS: Tab[] = [
  {id: 'profile', label: t('user', 'tabProfile'), icon: User, description: t('user', 'tabProfileDesc')},
  {id: 'security', label: t('user', 'tabSecurity'), icon: Shield, description: t('user', 'tabSecurityDesc')},
  {id: 'integrations', label: t('user', 'tabIntegrations'), icon: Plug, description: t('user', 'tabIntegrationsDesc')},
];

const VALID_TAB_IDS: TabId[] = ['profile', 'security', 'integrations'];

export default function UserSettings() {
    const [searchParams, setSearchParams] = useSearchParams();
    const tabFromUrl = searchParams.get('tab');
    const initialTab: TabId =
        tabFromUrl && VALID_TAB_IDS.includes(tabFromUrl as TabId)
            ? (tabFromUrl as TabId)
            : 'profile';
    const [activeTab, setActiveTab] = useState<TabId>(initialTab);

    // Sync tab when URL changes (e.g. direct link to ?tab=integrations) —
    // adjusted during render instead of via effect to avoid a cascading render.
    const [prevSearchParams, setPrevSearchParams] = useState(searchParams);
    if (searchParams !== prevSearchParams) {
        setPrevSearchParams(searchParams);
        const tab = searchParams.get('tab');
        if (tab && VALID_TAB_IDS.includes(tab as TabId) && tab !== activeTab) {
            setActiveTab(tab as TabId);
        }
    }

    const handleTabChange = (tabId: TabId) => {
        setActiveTab(tabId);
        setSearchParams({tab: tabId}, {replace: true});
    };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'profile':
        return <ProfileSection />;
      case 'security':
        return <SecuritySection />;
      case 'integrations':
        return <IntegrationsSection />;
    }
  };

  const activeTabMeta = TABS.find((tab) => tab.id === activeTab)!;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
        <PageHeader description={activeTabMeta.description} className="px-4 lg:px-6" />

        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden md:flex-row">
            <nav
                role="tablist"
                aria-label={t('user', 'settingsAriaSections')}
                className={cn(
                    'flex shrink-0 gap-1 overflow-x-auto border-b border-border/40 px-4 py-2',
                    'md:w-56 md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:px-2 md:py-3 lg:px-3',
                )}
            >
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => handleTabChange(tab.id)}
                    type="button"
                    className={cn(
                        'flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors duration-75',
                        'hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-1',
                        'md:w-full',
                        isActive ? 'bg-muted text-foreground' : 'text-muted-foreground',
                    )}
                  >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5}/>
                      {tab.label}
                  </button>
                );
              })}
            </nav>

            <main className="min-w-0 flex-1 overflow-y-auto px-4 py-3 lg:px-6">
                <div className="w-full max-w-3xl lg:max-w-4xl">
                    {renderTabContent()}
                </div>
            </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- frontend/test/UserSettings.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Confirm the copy gate now reports seven tightenable keys**

Run: `python3 scripts/fitness/check_copy_keys.py`
Expected: exit 0, with `tabProfile`, `tabProfileDesc`, `tabSecurity`,
`tabSecurityDesc`, `tabIntegrations`, `tabIntegrationsDesc` and
`settingsAriaSections` listed as tightenable baseline entries.

- [ ] **Step 6: Tighten the baseline**

Run: `python3 scripts/fitness/check_copy_keys.py --update-baseline`
Then: `git diff --stat scripts/fitness/check_copy_keys.baseline`
Expected: 7 lines removed, 0 added. If any line is ADDED, stop — a key went
dead and must be deleted from its namespace instead of baselined.

- [ ] **Step 7: Run the suite and the gates**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: exit 0 on all three.

- [ ] **Step 8: Commit**

```bash
git add frontend/pages/UserSettings.tsx frontend/test/UserSettings.test.tsx \
        scripts/fitness/check_copy_keys.baseline
git commit -m "feat(settings): fold /settings into the shell and restyle its rail as inset sub-nav"
```

---

# SLICE 2 — hub management

### Task 9: the archive write is a manager-gated backend endpoint

Spec §6.1 prescribes a direct PostgREST `update({is_active})` from the browser.
That cannot ship: ADR-0007 is **accepted** ("All frontend reads and writes for
application data go through the typed API client") and constitution §VI revokes
the "simple table operations" allowance by name, calling it "the documented
root cause of the dual-read-path incident class". A spec does not amend the
constitution — §Governance has a procedure and it was not used. Ledger ruling
2026-09-07T15:45Z (BLO1).

The precedent is exact and one module wide: `PUT /api/v1/projects/:id/ai-context`
was routed off PostgREST for this same reason
(`frontend/services/projectSettingsService.ts:205-214`,
`backend/app/api/v1/endpoints/ai_context.py:56-63`, mounted at
`backend/app/api/v1/router.py:114-115` under the `/projects` prefix eight
modules already share). This task copies that shape.

**One route, not two.** `PATCH /{project_id}/archive` with `{"archived": bool}`
rather than `POST …/archive` + `POST …/restore`: archive and restore are one
state transition on one column, so a single route means one ownership guard,
one rate limit and one place the transition is tested — two routes would be two
copies of the same `require_project_manager` binding, which is the shape
`.claude/rules/backend.md` § Ownership guards exists to prevent. `PATCH`
because it is a partial update of an existing project.

**Where the ownership predicate lives.** In the `Depends(require_project_manager)`
gate, which calls `public.is_project_manager` — the same SQL function the
`project_update` RLS policy calls (`baseline_v1.sql:2835`), so the API and the
database cannot drift. The service body never touches `project_members`; its
`UPDATE … WHERE id = :project_id` is scoped in the WHERE clause and returns the
written value, so "missing" and "foreign" are indistinguishable (both 403) and
the route is not an existence oracle.

**Files:**
- Create: `backend/app/schemas/project_archive.py`
- Create: `backend/app/services/project_archive.py`
- Create: `backend/app/api/v1/endpoints/project_archive.py`
- Create: `backend/tests/unit/test_project_archive_endpoints_unit.py`
- Create: `backend/tests/integration/test_project_archive_endpoints.py`
- Modify: `backend/app/api/v1/router.py`
- Modify (generated): `frontend/types/api/openapi.json`, `frontend/types/api/schema.d.ts`

**Interfaces:**
- Produces:
  - `ProjectArchiveUpdate{archived: bool}` and `ProjectArchiveRead{id: UUID, is_active: bool}`
    (`app.schemas.project_archive`).
  - `set_project_archived(db, project_id: UUID, *, archived: bool) -> dict[str, Any]`
    and `ProjectNotFoundError` (`app.services.project_archive`).
  - `PATCH /api/v1/projects/{project_id}/archive` →
    `ApiResponse[ProjectArchiveRead]`.
  - `components['schemas']['ProjectArchiveRead' | 'ProjectArchiveUpdate']` in
    `frontend/types/api/schema.d.ts`, consumed by Task 12.

- [ ] **Step 1: Write the failing unit tests**

The ASGI transport's handler frames do not register on coverage (the diff-cover
blind spot), so the coroutines are called directly with the service patched in
the endpoint module's namespace. `@limiter.limit` wraps the handler;
`getattr(fn, "__wrapped__", fn)` reaches the pristine coroutine.

```python
# backend/tests/unit/test_project_archive_endpoints_unit.py
"""Direct endpoint-coroutine unit tests for the archive endpoint.

The auth gate is a ``Depends(...)`` — resolved by FastAPI, never called in the
handler body — so role enforcement is asserted in the integration suite
(manager writes, reviewer 403, outsider 403, unknown project 403).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.project_archive import set_archived
from app.schemas.project_archive import ProjectArchiveUpdate
from app.services.project_archive import ProjectNotFoundError

_EP = "app.api.v1.endpoints.project_archive"

_patch = getattr(set_archived, "__wrapped__", set_archived)


def _request() -> MagicMock:
    request = MagicMock()
    request.state.trace_id = "trace-archive"
    return request


@pytest.mark.asyncio
async def test_archiving_forwards_the_flag_and_commits() -> None:
    db = AsyncMock()
    pid = uuid4()

    with patch(
        f"{_EP}.set_project_archived",
        AsyncMock(return_value={"id": pid, "is_active": False}),
    ) as svc:
        res = await _patch(
            project_id=pid,
            body=ProjectArchiveUpdate(archived=True),
            request=_request(),
            db=db,
        )

    assert svc.await_args.args[1] == pid
    # Named kwarg, so a future reorder cannot silently invert the transition.
    assert svc.await_args.kwargs["archived"] is True
    db.commit.assert_awaited_once()
    assert res.ok is True
    assert res.trace_id == "trace-archive"
    assert res.data.is_active is False


@pytest.mark.asyncio
async def test_restoring_forwards_the_opposite_flag() -> None:
    with patch(
        f"{_EP}.set_project_archived",
        AsyncMock(return_value={"id": (pid := uuid4()), "is_active": True}),
    ) as svc:
        res = await _patch(
            project_id=pid,
            body=ProjectArchiveUpdate(archived=False),
            request=_request(),
            db=AsyncMock(),
        )

    assert svc.await_args.kwargs["archived"] is False
    assert res.data.is_active is True


@pytest.mark.asyncio
async def test_a_missing_project_is_404_and_does_not_commit() -> None:
    db = AsyncMock()

    with (
        patch(
            f"{_EP}.set_project_archived",
            AsyncMock(side_effect=ProjectNotFoundError("gone")),
        ),
        pytest.raises(HTTPException) as exc,
    ):
        await _patch(
            project_id=uuid4(),
            body=ProjectArchiveUpdate(archived=True),
            request=_request(),
            db=db,
        )

    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()
```

- [ ] **Step 2: Write the failing integration tests**

These are the ownership tests `.claude/rules/backend.md` requires: they run
against the real local Supabase Postgres with RLS on, and the reviewer case is
the BOLA case — a project member who is not a manager must be refused.

```python
# backend/tests/integration/test_project_archive_endpoints.py
"""PATCH /api/v1/projects/{id}/archive — auth, round-trip, and the flag.

The auth assertions are the point of this file. The column behind this route is
governed by the manager-only ``project_update`` RLS policy
(``backend/alembic/versions/baseline_v1.sql:2835``) and the API must not be
looser than it. The guard answers 403 for a non-member AND for a project that
does not exist, so the route is not an existence oracle.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_archive import ProjectNotFoundError, set_project_archived
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

# Re-bound at module level (the repo's idiom for borrowing fixtures) so pytest
# collects them here; a ``from ... import`` would be shadowed by the test
# parameters and trip F811.
client_as_manager = engine_setup.client_as_manager
client_as_outsider = engine_setup.client_as_outsider
client_as_reviewer = engine_setup.client_as_reviewer

_URL = "/api/v1/projects/{pid}/archive"


async def _is_active(db: AsyncSession, project_id: UUID) -> bool:
    return bool(
        (
            await db.execute(
                text("SELECT is_active FROM public.projects WHERE id = :pid"),
                {"pid": str(project_id)},
            )
        ).scalar_one()
    )


@pytest.mark.asyncio
async def test_a_manager_archives_and_restores(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    archived = await client_as_manager.patch(
        _URL.format(pid=SEED.primary_project), json={"archived": True}
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["data"]["is_active"] is False

    restored = await client_as_manager.patch(
        _URL.format(pid=SEED.primary_project), json={"archived": False}
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["data"]["is_active"] is True
    await db_session.rollback()


@pytest.mark.asyncio
async def test_a_reviewer_is_refused_and_the_row_is_untouched(
    db_session: AsyncSession, client_as_reviewer: AsyncClient
) -> None:
    """The BOLA case: a real member of this project, without the role."""
    before = await _is_active(db_session, SEED.primary_project)

    res = await client_as_reviewer.patch(
        _URL.format(pid=SEED.primary_project), json={"archived": True}
    )

    assert res.status_code == 403, res.text
    # Refused, not merely un-echoed: assert the row, not the response.
    assert await _is_active(db_session, SEED.primary_project) is before
    await db_session.rollback()


@pytest.mark.asyncio
async def test_an_outsider_is_refused_on_a_real_project(
    client_as_outsider: AsyncClient,
) -> None:
    """A REAL project id, so this proves membership is checked — not just id validity."""
    res = await client_as_outsider.patch(
        _URL.format(pid=SEED.primary_project), json={"archived": True}
    )
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_a_nonexistent_project_answers_exactly_like_a_foreign_one(
    client_as_manager: AsyncClient,
) -> None:
    """403 for both, so the route is not an existence oracle."""
    res = await client_as_manager.patch(_URL.format(pid=uuid4()), json={"archived": True})
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_the_service_called_directly(db_session: AsyncSession) -> None:
    """Exercises the service WITHOUT the HTTP layer.

    The endpoint tests above drive it through httpx's ASGI transport, whose
    frames coverage does not register — so the service's own branches would be
    reported uncovered despite being exercised.
    """
    written = await set_project_archived(db_session, SEED.primary_project, archived=True)
    assert written["is_active"] is False
    assert written["id"] == SEED.primary_project
    assert await _is_active(db_session, SEED.primary_project) is False

    with pytest.raises(ProjectNotFoundError):
        await set_project_archived(db_session, uuid4(), archived=True)
    await db_session.rollback()
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_project_archive_endpoints_unit.py -q`
Expected: FAIL — `ModuleNotFoundError: app.api.v1.endpoints.project_archive`.

- [ ] **Step 4: Write the schema**

```python
# backend/app/schemas/project_archive.py
"""Wire shapes for archiving and restoring a project.

One route carries both directions because they are one state transition on one
column: a boolean body cannot get out of step with itself the way a
``/archive`` + ``/restore`` pair can.

Read model is deliberately the stored value, not an echo of the request: the
caller renders the row's new state from what the database actually holds.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class ProjectArchiveUpdate(BaseModel):
    """``true`` archives (``is_active = false``); ``false`` restores."""

    archived: bool


class ProjectArchiveRead(BaseModel):
    """The row as written."""

    id: UUID
    is_active: bool
```

- [ ] **Step 5: Write the service**

```python
# backend/app/services/project_archive.py
"""Archive / restore a project — the one write behind ``PATCH …/archive``.

``is_active`` is presentation state, not access control: no RLS policy on
``projects`` references it, and no service filters on it, so an archived
project stays fully reachable and mutable. The column exists so the hub can
hide finished reviews; do not build authorization on it.

Ownership is NOT checked here. The endpoint's ``require_project_manager``
dependency evaluates ``public.is_project_manager`` — the same SQL function the
``project_update`` RLS policy calls — before this coroutine runs, which is why
this module never touches ``project_members``. The ``WHERE id`` below is the
row scope; a caller who reached it has already been bound to the project.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project


class ProjectNotFoundError(Exception):
    """No ``projects`` row with that id."""


async def set_project_archived(
    db: AsyncSession, project_id: UUID, *, archived: bool
) -> dict[str, Any]:
    """Write ``is_active`` and return the row as stored.

    ``RETURNING`` rather than a read-back: one statement, and a zero-row result
    is the ONLY signal that the id matched nothing — the same reason the
    PostgREST writes in this repo carry ``.select()``.

    NOTE: ``trg_projects_updated_at`` fires on this UPDATE, so archiving or
    restoring also bumps ``updated_at`` and therefore reorders the hub's
    default "Updated" sort. That is accepted, not accidental (see the plan's
    "Accepted" section).
    """
    row = (
        await db.execute(
            update(Project)
            .where(Project.id == project_id)
            .values(is_active=not archived)
            .returning(Project.id, Project.is_active)
        )
    ).one_or_none()

    if row is None:
        raise ProjectNotFoundError(f"Project {project_id} not found")

    await db.flush()
    return {"id": row.id, "is_active": row.is_active}
```

- [ ] **Step 6: Write the endpoint**

```python
# backend/app/api/v1/endpoints/project_archive.py
"""Archive / restore a project.

Auth + error mapping + envelope, nothing else — the write lives in
``app.services.project_archive``.

``require_project_manager`` matches the manager-only ``project_update`` RLS
policy that governs the column, and answers 403 both for a non-manager and for
a project that does not exist, so the route is not an existence oracle. The
404 branch below is therefore unreachable through HTTP today; it is kept
because the service is also called directly (tests, and any future caller that
is already scoped), and swallowing a missing row would return a success
envelope describing a write that did not happen.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.project_archive import ProjectArchiveRead, ProjectArchiveUpdate
from app.services.project_archive import ProjectNotFoundError, set_project_archived
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.patch("/{project_id}/archive", response_model=ApiResponse[ProjectArchiveRead])
@limiter.limit("30/minute")
async def set_archived(
    project_id: UUID,
    body: ProjectArchiveUpdate,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[ProjectArchiveRead]:
    """Archive (`archived=true`) or restore, returning the row as stored."""
    trace_id = getattr(request.state, "trace_id", None)
    try:
        data = await set_project_archived(db, project_id, archived=body.archived)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(ProjectArchiveRead(**data), trace_id=trace_id)
```

- [ ] **Step 7: Register the router**

In `backend/app/api/v1/router.py`, add `project_archive` to the endpoints
import list and register it beside its siblings under the existing prefix:

```python
api_router.include_router(
    project_archive.router,
    prefix="/projects",
    tags=["projects"],
)
```

- [ ] **Step 8: Run the backend tests and lint**

Run: `cd backend && uv run pytest tests/unit/test_project_archive_endpoints_unit.py -q`
Expected: PASS (3 tests).

Run: `make test-backend` (needs the local Supabase Docker stack)
Expected: exit 0, including the 5 new integration tests.

Run: `make lint-backend`
Expected: exit 0.

- [ ] **Step 9: Regenerate the API contract types**

CI's `api-contract` job fails any PR whose committed output does not match the
backend, and the generated files are never hand-edited
(`.claude/rules/frontend.md`).

Run: `npm run generate:api-types`
Then: `git diff --stat frontend/types/api/`
Expected: `openapi.json` and `schema.d.ts` both change, adding
`ProjectArchiveRead` / `ProjectArchiveUpdate` and the new path. If anything
*else* changes, an unrelated backend drift is being swept in — stop and check.

- [ ] **Step 10: Commit**

```bash
git add backend/app/schemas/project_archive.py backend/app/services/project_archive.py \
        backend/app/api/v1/endpoints/project_archive.py backend/app/api/v1/router.py \
        backend/tests/unit/test_project_archive_endpoints_unit.py \
        backend/tests/integration/test_project_archive_endpoints.py \
        frontend/types/api/openapi.json frontend/types/api/schema.d.ts
git commit -m "feat(projects): add a manager-gated archive/restore endpoint"
```

---

### Task 10: widen the list read — `updated_at`, the caller's role, one predicate

The read stays on PostgREST: it is an existing, grandfathered call site, and
ADR-0011 has not landed. Only the projection and the sort change.

**Files:**
- Modify: `frontend/types/project.ts:86-89`
- Modify: `frontend/hooks/useProjectMemberRole.ts:41`
- Modify: `frontend/services/projectsService.ts` (list select + sort)
- Modify: `frontend/hooks/useProjectsQuery.ts`
- Test: `frontend/test/services/projectsService.test.ts`
- Test: `frontend/test/types/projectManager.test.ts`

**Interfaces:**
- Produces:
  - `ProjectListItem` gains `updated_at: string` and
    `project_members: {user_id: string; role: MemberRole}[]`.
  - `isManagerRole(role: MemberRole | null | undefined): boolean` and
    `isProjectManager(project: ProjectListItem, userId: string): boolean`
    from `@/types/project`.
  - `listProjectsForDashboard(userId: string): Promise<ErrorResult<ProjectListItem[]>>`.
- Consumed by Tasks 12 and 13.

- [ ] **Step 1: Rewrite the service test for the widened read**

Replace `frontend/test/services/projectsService.test.ts` with:

```ts
// frontend/test/services/projectsService.test.ts
/**
 * The list read's shape. This is a hand-rolled chain stub, so it pins the
 * projection and the sort, NOT PostgREST's behaviour — see the plan's
 * "Accepted" section. What the affordance actually depends on is proved in
 * `frontend/test/types/projectManager.test.ts`, which does not trust the
 * transport filter at all.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({supabase: {from: vi.fn()}}));

import {supabase} from '@/integrations/supabase/client';
import {listProjectsForDashboard} from '@/services/projectsService';

function readChain(payload: {data: unknown; error?: {message: string} | null}) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.order = vi.fn(async () => ({data: payload.data, error: payload.error ?? null}));
  return c;
}

describe('projectsService.listProjectsForDashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('selects updated_at and the membership rows, newest update first', async () => {
    const rows = [{id: 'p1', project_members: [{user_id: 'u1', role: 'manager'}]}];
    const c = readChain({data: rows});
    vi.mocked(supabase.from).mockReturnValue(c as never);

    const result = await listProjectsForDashboard('u1');

    expect(supabase.from).toHaveBeenCalledWith('projects');
    expect(c.select).toHaveBeenCalledWith(
      'id, name, description, created_at, updated_at, is_active, review_title, project_members(user_id, role)',
    );
    // Transport narrowing only — the affordance re-checks the row's owner.
    expect(c.eq).toHaveBeenCalledWith('project_members.user_id', 'u1');
    expect(c.order).toHaveBeenCalledWith('updated_at', {ascending: false});
    expect(result).toEqual({ok: true, data: rows});
  });

  it('returns ok with [] when data is null', async () => {
    vi.mocked(supabase.from).mockReturnValue(readChain({data: null}) as never);
    expect(await listProjectsForDashboard('u1')).toEqual({ok: true, data: []});
  });

  it('returns ok:false (never throws) on a supabase error', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      readChain({data: null, error: {message: 'permission denied'}}) as never,
    );
    const result = await listProjectsForDashboard('u1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('permission denied');
  });
});
```

- [ ] **Step 2: Write the manager-predicate test**

This replaces the earlier draft's "assert `.eq` was called on a mock" with a
behavioural test. `project_members_select` is
`is_project_member(project_id, auth.uid())`
(`backend/alembic/versions/baseline_v1.sql:2821`), so a member may read *every*
member row of their projects — if the embedded filter ever silently failed to
apply, a predicate of the form "some member is a manager" would be true for
essentially every project and would offer Archive to reviewers and viewers.
Binding the predicate to the caller's own row removes that failure mode rather
than testing for it.

```ts
// frontend/test/types/projectManager.test.ts
/**
 * "Does the caller manage this project?" — one predicate, and it does not
 * trust the transport.
 *
 * The list read narrows the embed with `.eq('project_members.user_id', …)`,
 * but that narrowing is asserted only against a chain stub. So the predicate
 * re-checks the row's owner: even handed the whole roster it must answer for
 * the caller alone.
 */
import {describe, expect, it} from 'vitest';
import {isManagerRole, isProjectManager, type ProjectListItem} from '@/types/project';

function project(members: {user_id: string; role: string}[]): ProjectListItem {
  return {
    id: 'p1',
    name: 'Alpha',
    description: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    is_active: true,
    review_title: null,
    project_members: members,
  } as ProjectListItem;
}

describe('isManagerRole', () => {
  it('is true only for manager', () => {
    expect(isManagerRole('manager')).toBe(true);
    expect(isManagerRole('reviewer')).toBe(false);
    expect(isManagerRole('viewer')).toBe(false);
    expect(isManagerRole('consensus')).toBe(false);
    expect(isManagerRole(null)).toBe(false);
  });
});

describe('isProjectManager', () => {
  it('is true when the caller\'s own row is a manager row', () => {
    expect(isProjectManager(project([{user_id: 'u1', role: 'manager'}]), 'u1')).toBe(true);
  });

  it('is false for the caller\'s own non-manager row', () => {
    expect(isProjectManager(project([{user_id: 'u1', role: 'reviewer'}]), 'u1')).toBe(false);
  });

  it('ignores OTHER members\' manager rows if the whole roster arrives', () => {
    // The failure mode this exists for: an unapplied embed filter would hand
    // back every member, and "some member is a manager" is true of nearly
    // every project.
    const roster = project([
      {user_id: 'someone-else', role: 'manager'},
      {user_id: 'u1', role: 'viewer'},
    ]);
    expect(isProjectManager(roster, 'u1')).toBe(false);
  });

  it('is false when the caller has no row at all', () => {
    expect(isProjectManager(project([]), 'u1')).toBe(false);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npm run test:run -- frontend/test/services/projectsService.test.ts frontend/test/types/projectManager.test.ts`
Expected: FAIL — `isManagerRole` / `isProjectManager` are not exported, and the
`select` string assertion does not match today's narrower projection.

- [ ] **Step 4: Widen the type and add the one role predicate**

In `frontend/types/project.ts`, replace the `ProjectListItem` block:

```ts
/**
 * Lean type for project lists.
 *
 * `project_members` carries membership rows for this project.
 * `listProjectsForDashboard` narrows the embed to the caller with
 * `.eq('project_members.user_id', …)`, but `isProjectManager` re-checks
 * `user_id` anyway: the RLS policy `project_members_select` lets any member
 * read every member row, so a predicate that trusted the transport would say
 * "manager" for any project that has one.
 *
 * None of this is the security boundary. The archive write is
 * `PATCH /api/v1/projects/{id}/archive`, gated by `require_project_manager`
 * against the same `public.is_project_manager` the `project_update` RLS policy
 * calls. This only decides whether the menu item is offered.
 */
export type ProjectListItem = Pick<
    Project,
    'id' | 'name' | 'description' | 'created_at' | 'updated_at' | 'is_active' | 'review_title'
> & {
    project_members: { user_id: string; role: MemberRole }[];
};

/**
 * The ONE client-side answer to "does this role mean manager?".
 *
 * `useProjectMemberRole` derived the same `role === 'manager'` inline; both
 * now call this, so the hub and a project route cannot disagree within one
 * session. (`extractionFieldService.checkProjectPermissions` is a separate
 * *read* of `project_members`, not a second role predicate — consolidating
 * that read belongs to the ADR-0011 data-path work, not here.)
 */
export function isManagerRole(role: MemberRole | null | undefined): boolean {
    return role === 'manager';
}

/** True when `userId`'s OWN membership row on this project is a manager row. */
export function isProjectManager(project: ProjectListItem, userId: string): boolean {
    return project.project_members.some(
        (member) => member.user_id === userId && isManagerRole(member.role),
    );
}
```

- [ ] **Step 5: Point `useProjectMemberRole` at the shared predicate**

In `frontend/hooks/useProjectMemberRole.ts`, import it and replace the inline
comparison:

```ts
import {isManagerRole} from '@/types/project';
```

```ts
    return {
        role,
        isManager: isManagerRole(role),
        loading,
    };
```

- [ ] **Step 6: Widen the read**

In `frontend/services/projectsService.ts`, replace `listProjectsForDashboard`.
No new `supabase.from(...)` call site is introduced — this is the existing,
grandfathered read.

```ts
// ---------------------------------------------------------------------------
// Hub: list projects (typed columns + the caller's membership row)
// ---------------------------------------------------------------------------

const PROJECT_LIST_SELECT =
  'id, name, description, created_at, updated_at, is_active, review_title, project_members(user_id, role)';

/**
 * `updated_at` is maintained by the `trg_projects_updated_at` BEFORE UPDATE
 * trigger, so it is real for every writer — the `Updated <relative>` row
 * metadata and the default sort both rest on that (spec §6.2).
 *
 * The embed is narrowed to the caller to keep the payload small; correctness
 * does not depend on it (`isProjectManager` re-checks `user_id`).
 */
export function listProjectsForDashboard(
  userId: string,
): Promise<ErrorResult<ProjectListItem[]>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('projects')
      .select(PROJECT_LIST_SELECT)
      .eq('project_members.user_id', userId)
      .order('updated_at', {ascending: false});
    if (error) throw error;
    // ONE assertion, on the embed only. `as unknown as ProjectListItem[]`
    // would switch off the check that ties this hand-written select string to
    // the generated row types for EVERY column — the same shape as the
    // recorded incident where PostgREST kept reading a dropped column past a
    // migration (constitution §V).
    return (data ?? []).map((row) => ({
      ...row,
      project_members: row.project_members as {user_id: string; role: MemberRole}[],
    }));
  }, 'projectsService.listProjectsForDashboard');
}
```

Add `MemberRole` to the file's existing `@/types/project` type import.
`npm run typecheck` is the arbiter here: if the generated types cannot resolve
the embed at all, narrow with a single named alias rather than reaching for
`as unknown as` —
`type ProjectListRow = Omit<ProjectListItem, 'project_members'> & {project_members: {user_id: string; role: string}[]}`
— and assert once, on that.

- [ ] **Step 7: Thread the user id through the query hook**

`useProjectsQuery` already reads `useAuth()` and keys on `projectsListKey(userId)`
(Task 2). Only the call gains an argument:

```ts
      const result = await listProjectsForDashboard(userId);
```

- [ ] **Step 8: Run the tests**

Run: `npm run test:run -- frontend/test/services/projectsService.test.ts frontend/test/types/projectManager.test.ts frontend/test/hooks/useProjectsQuery.test.tsx`
Expected: PASS (3 + 5 + 4 tests).

- [ ] **Step 9: Full suite and gates**

Run: `npm run test:run && npm run typecheck && npm run lint && python3 scripts/fitness/check_frontend_data_path.py`
Expected: exit 0. The data-path check must report the **same** found/grandfathered
counts as on `dev` — this task adds no call site, it edits one.

- [ ] **Step 10: Commit**

```bash
git add frontend/types/project.ts frontend/hooks/useProjectMemberRole.ts \
        frontend/services/projectsService.ts frontend/hooks/useProjectsQuery.ts \
        frontend/test/services/projectsService.test.ts frontend/test/types/projectManager.test.ts
git commit -m "feat(projects): carry updated_at and the caller's membership row on the list read"
```

---

### Task 11: relative time

There is no relative-time formatter in the repo and no `date-fns`. The four
`common.time*` keys already exist and are currently baselined as dead; this
task makes them live and tightens the baseline.

**Files:**
- Create: `frontend/lib/relative-time.ts`
- Create: `frontend/test/relativeTime.test.ts`
- Modify: `scripts/fitness/check_copy_keys.baseline`

**Interfaces:**
- Produces: `relativeTime(iso: string, now?: number): string`. Consumed by Task 12.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/test/relativeTime.test.ts
/**
 * `now` is injected so the boundaries are asserted exactly rather than raced
 * against the wall clock.
 *
 * The >30-day branch is the one that cannot be a hardcoded string: the
 * implementation formats with `toLocaleDateString`, which renders in the
 * MACHINE's zone, so `'8/8/2026'` is right at UTC and wrong at UTC+12 — green
 * on CI and red for a developer in Auckland. It is asserted as "the absolute
 * date of that instant, and no longer a relative phrase" instead, which is the
 * property that actually matters and holds in every zone.
 */
import {describe, expect, it} from 'vitest';
import {relativeTime} from '@/lib/relative-time';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('reads "just now" under a minute', () => {
    expect(relativeTime(iso(0), NOW)).toBe('just now');
    expect(relativeTime(iso(MINUTE - 1), NOW)).toBe('just now');
  });

  it('counts whole minutes up to an hour', () => {
    expect(relativeTime(iso(MINUTE), NOW)).toBe('1 min ago');
    expect(relativeTime(iso(59 * MINUTE), NOW)).toBe('59 min ago');
  });

  it('counts whole hours up to a day', () => {
    expect(relativeTime(iso(HOUR), NOW)).toBe('1h ago');
    expect(relativeTime(iso(23 * HOUR), NOW)).toBe('23h ago');
  });

  it('counts whole days up to thirty', () => {
    expect(relativeTime(iso(DAY), NOW)).toBe('1d ago');
    expect(relativeTime(iso(29 * DAY), NOW)).toBe('29d ago');
  });

  it('falls back to an absolute date past thirty days', () => {
    const result = relativeTime(iso(30 * DAY), NOW);

    // Zone-independent: whatever this machine calls that instant's date.
    expect(result).toBe(new Date(NOW - 30 * DAY).toLocaleDateString('en-US'));
    // …and not vacuous: the branch really switched away from a day count.
    expect(result).not.toMatch(/ago$/);
    expect(result).not.toBe(relativeTime(iso(29 * DAY), NOW));
  });

  it('clamps a future timestamp instead of rendering a negative count', () => {
    expect(relativeTime(new Date(NOW + HOUR).toISOString(), NOW)).toBe('just now');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- frontend/test/relativeTime.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/relative-time"`.

- [ ] **Step 3: Write the formatter**

```ts
// frontend/lib/relative-time.ts
/**
 * Compact relative time for list metadata ("just now", "5 min ago", "3h ago",
 * "12d ago"), falling back to an absolute date past 30 days where a day count
 * stops being readable. Copy comes from the four existing `common.time*` keys.
 *
 * `now` is a parameter so callers' tests do not race the wall clock.
 */
import {t} from '@/lib/copy';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ABSOLUTE_AFTER = 30 * DAY;

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  // Clock skew between the database and the browser can put a fresh
  // `updated_at` slightly in the future; clamp rather than render "-1 min ago".
  const delta = Math.max(0, now - then);

  if (delta < MINUTE) return t('common', 'timeJustNow');
  if (delta < HOUR) return t('common', 'timeAgoMin').replace('{{n}}', String(Math.floor(delta / MINUTE)));
  if (delta < DAY) return t('common', 'timeAgoH').replace('{{n}}', String(Math.floor(delta / HOUR)));
  if (delta < ABSOLUTE_AFTER) return t('common', 'timeAgoD').replace('{{n}}', String(Math.floor(delta / DAY)));
  return new Date(then).toLocaleDateString('en-US');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- frontend/test/relativeTime.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Tighten the copy baseline**

Run: `python3 scripts/fitness/check_copy_keys.py --update-baseline`
Then: `git diff scripts/fitness/check_copy_keys.baseline`
Expected: exactly these four lines removed, none added:

```
frontend/lib/copy/common.ts:timeAgoD
frontend/lib/copy/common.ts:timeAgoH
frontend/lib/copy/common.ts:timeAgoMin
frontend/lib/copy/common.ts:timeJustNow
```

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/relative-time.ts frontend/test/relativeTime.test.ts \
        scripts/fitness/check_copy_keys.baseline
git commit -m "feat(lib): add a compact relative-time formatter over the existing time copy keys"
```

---

### Task 12: the hub row and the archive mutation

The write half of the archive feature on the client. It calls the endpoint from
Task 9 through the typed apiClient — no `supabase.from(...)`.

**Files:**
- Create: `frontend/components/project/ProjectRow.tsx`
- Create: `frontend/hooks/useArchiveProject.ts`
- Create: `frontend/test/hooks/useArchiveProject.test.tsx`
- Modify: `frontend/services/projectsService.ts` (append `setProjectArchived`)
- Modify: `frontend/lib/copy/pages.ts`

**Interfaces:**
- Consumes: `ProjectListItem` + `isProjectManager` (Task 10), `relativeTime`
  (Task 11), `projectsListKey` (Task 2),
  `components['schemas']['ProjectArchiveRead']` (Task 9).
- Produces:
  - `setProjectArchived(projectId: string, archived: boolean): Promise<ErrorResult<ProjectArchiveRead>>`
    from `@/services/projectsService`.
  - `useArchiveProject(): UseMutationResult<ProjectArchiveRead, Error, {projectId: string; archived: boolean}>`.
  - `ProjectRow: React.FC<{project: ProjectListItem; userId: string; onArchivedChange: (projectId: string, archived: boolean) => void}>`.
- Consumed by Task 13.

- [ ] **Step 1: Add the copy keys**

In `frontend/lib/copy/pages.ts`, add next to the other `dashboard*` keys
(`dashboardNoDescription` is deleted in Task 13, together with the inline row
that still reads it — deleting it here would leave `Dashboard.tsx` red at this
commit):

```ts
    dashboardUpdatedPrefix: 'Updated',
    dashboardArchivedBadge: 'Archived',
    dashboardRowActionsAria: 'Project actions',
    dashboardArchive: 'Archive',
    dashboardRestore: 'Restore',
    dashboardArchived: 'Project archived',
    dashboardRestored: 'Project restored',
    dashboardArchiveDenied: 'You do not have permission to change this project',
    dashboardArchiveFailed: 'Could not update the project',
```

- [ ] **Step 2: Write the failing mutation test**

```tsx
// frontend/test/hooks/useArchiveProject.test.tsx
/**
 * The write side of archive/restore.
 *
 * The endpoint (`PATCH /api/v1/projects/{id}/archive`) is manager-gated by
 * `require_project_manager`, so a reviewer's attempt comes back 403 rather
 * than as a silent zero-row success — that hazard belongs to PostgREST writes
 * and this write is not one. What still has to hold on the client: the
 * response must actually describe the transition that was asked for (a server
 * that answered about a different state would otherwise be rendered as
 * success), and success must invalidate the ONE identity-scoped list entry
 * the hub, the switcher and the breadcrumb all read.
 */
import type {ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const setProjectArchived = vi.fn();
vi.mock('@/services/projectsService', () => ({
  setProjectArchived: (projectId: string, archived: boolean) =>
    setProjectArchived(projectId, archived),
}));

vi.mock('@/contexts/AuthContext', () => ({useAuth: () => ({user: {id: 'u1'}})}));

import {useArchiveProject} from '@/hooks/useArchiveProject';
import {projectsListKey} from '@/hooks/useProjectsQuery';

function harness() {
  const queryClient = new QueryClient({defaultOptions: {mutations: {retry: false}}});
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const {result} = renderHook(() => useArchiveProject(), {
    wrapper: ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return {result, invalidate};
}

describe('useArchiveProject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('archives and invalidates the caller\'s list entry — and only that entry', async () => {
    setProjectArchived.mockResolvedValue({ok: true, data: {id: 'p1', is_active: false}});
    const {result, invalidate} = harness();

    result.current.mutate({projectId: 'p1', archived: true});

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(setProjectArchived).toHaveBeenCalledWith('p1', true);
    // Not `projectKeys.all`: that prefix also covers members, templates, HITL
    // config, LLM endpoints and AI context for every project in the app.
    expect(invalidate).toHaveBeenCalledWith({queryKey: projectsListKey('u1')});
  });

  it('restores by asking for is_active true', async () => {
    setProjectArchived.mockResolvedValue({ok: true, data: {id: 'p1', is_active: true}});
    const {result} = harness();

    result.current.mutate({projectId: 'p1', archived: false});

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(setProjectArchived).toHaveBeenCalledWith('p1', false);
  });

  it('treats a response that contradicts the request as an error', async () => {
    // Asked to archive, told the project is still active: never render that
    // as success — the row on screen would disagree with the database.
    setProjectArchived.mockResolvedValue({ok: true, data: {id: 'p1', is_active: true}});
    const {result, invalidate} = harness();

    result.current.mutate({projectId: 'p1', archived: true});

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Could not update the project');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('surfaces a service error (a 403 from the manager gate lands here)', async () => {
    setProjectArchived.mockResolvedValue({ok: false, error: new Error('boom')});
    const {result} = harness();

    result.current.mutate({projectId: 'p1', archived: false});

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('boom');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:run -- frontend/test/hooks/useArchiveProject.test.tsx`
Expected: FAIL — `Failed to resolve import "@/hooks/useArchiveProject"`.

- [ ] **Step 4: Add the service call over the typed client**

Append to `frontend/services/projectsService.ts`. This is an `apiClient` call,
not a PostgREST one: the write goes to the endpoint added in Task 9
(ADR-0007, constitution §VI). `aiContextService.ts` is the shape being copied.

```ts
// ---------------------------------------------------------------------------
// Hub: archive / restore (backend endpoint, manager-gated)
// ---------------------------------------------------------------------------

export type ProjectArchiveRead = components['schemas']['ProjectArchiveRead'];

/**
 * Archive (`archived = true`) or restore a project.
 *
 * `PATCH /api/v1/projects/{id}/archive` is gated by `require_project_manager`,
 * which evaluates the same `public.is_project_manager` the `project_update`
 * RLS policy calls — so a reviewer gets a 403, not the silent zero-row success
 * a direct PostgREST update would have returned. The response is the row as
 * STORED, so the caller can check that the write did what was asked.
 *
 * NOTE: toast messages are handled by the caller.
 */
export function setProjectArchived(
  projectId: string,
  archived: boolean,
): Promise<ErrorResult<ProjectArchiveRead>> {
  return toResult(
    () =>
      apiClient<ProjectArchiveRead>(`/api/v1/projects/${projectId}/archive`, {
        method: 'PATCH',
        body: {archived},
      }),
    'projectsService.setProjectArchived',
  );
}
```

Add the two imports the file does not have yet:

```ts
import {apiClient} from '@/integrations/api/client';
import type {components} from '@/types/api/schema';
```

- [ ] **Step 5: Write the mutation hook**

```ts
// frontend/hooks/useArchiveProject.ts
/**
 * Archive / restore a project.
 *
 * The authorization check is the endpoint's `require_project_manager`; the
 * manager-gated menu item is only an affordance. What this hook adds is the
 * refusal to render a write that did not happen: the endpoint returns the row
 * as stored, so a response whose `is_active` contradicts the request is an
 * error rather than a success toast over an unchanged row.
 *
 * On success exactly one cache entry is invalidated — the identity-scoped
 * project list the hub, the sidebar switcher and the shell breadcrumb all
 * read. `projectKeys.all` would work by prefix and would also mark members,
 * templates, HITL config, LLM endpoints and AI context stale for every project.
 */
import {useMutation, useQueryClient, type UseMutationResult} from '@tanstack/react-query';
import {setProjectArchived, type ProjectArchiveRead} from '@/services/projectsService';
import {useAuth} from '@/contexts/AuthContext';
import {projectsListKey} from './useProjectsQuery';
import {t} from '@/lib/copy';

export interface ArchiveProjectVariables {
  projectId: string;
  archived: boolean;
}

export function useArchiveProject(): UseMutationResult<
  ProjectArchiveRead,
  Error,
  ArchiveProjectVariables
> {
  const queryClient = useQueryClient();
  const {user} = useAuth();
  const userId = user?.id ?? '';

  return useMutation<ProjectArchiveRead, Error, ArchiveProjectVariables>({
    mutationFn: async ({projectId, archived}) => {
      const result = await setProjectArchived(projectId, archived);
      if (!result.ok) throw result.error;
      if (result.data.is_active === archived) {
        throw new Error(t('pages', 'dashboardArchiveFailed'));
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: projectsListKey(userId)});
    },
  });
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:run -- frontend/test/hooks/useArchiveProject.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 7: Extract the row**

`Dashboard.tsx:140-201` is inline JSX with a green `is_active` dot that nothing
in the stack ever writes, an `is_active` fragment baked into the row
`aria-label` at `:145`, and a "No additional description" filler. All three go.

The row also stops being a `role="button"` wrapper with a nested menu button —
that nesting is invalid. Instead the project name is a real `Link` stretched
over the row with `after:absolute after:inset-0`, and the `⋯` trigger sits
above it on `z-10`. One link, one button, keyboard navigation for free, and the
row's accessible name is exactly the project name.

```tsx
// frontend/components/project/ProjectRow.tsx
/**
 * One hub row.
 *
 * A stretched link (`after:absolute after:inset-0`) makes the whole row
 * clickable while keeping exactly one link and one button in the a11y tree —
 * the old `role="button"` div with a nested control could not have carried the
 * `⋯` menu. The row's accessible name is the project name and nothing else:
 * the `is_active` fragment that used to be appended to it encoded a column
 * nothing writes (spec §5).
 */
import React from 'react';
import {Link} from 'react-router';
import {Archive, ArchiveRestore, BookOpen, MoreHorizontal} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {HeaderIconButton} from '@/components/layout/HeaderIconButton';
import {relativeTime} from '@/lib/relative-time';
import {isProjectManager, type ProjectListItem} from '@/types/project';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface ProjectRowProps {
  project: ProjectListItem;
  /** The caller, so the manager check reads the caller's own membership row. */
  userId: string;
  onArchivedChange: (projectId: string, archived: boolean) => void;
}

export const ProjectRow: React.FC<ProjectRowProps> = ({project, userId, onArchivedChange}) => {
  const canManage = isProjectManager(project, userId);
  const subtitle = project.description || project.review_title || '';

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 px-4 py-3 lg:px-6',
        'transition-colors duration-75 motion-reduce:transition-none',
        'hover:bg-muted/40 focus-within:bg-muted/40',
        !project.is_active && 'opacity-60',
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/20 transition-all duration-150 group-hover:border-border group-hover:shadow-xs motion-reduce:transition-none">
        <BookOpen
          className="h-4 w-4 text-muted-foreground/60 transition-colors group-hover:text-foreground motion-reduce:transition-none"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <Link
            to={`/projects/${project.id}`}
            className="truncate rounded text-[14px] font-medium tracking-tight text-foreground transition-colors after:absolute after:inset-0 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
          >
            {project.name}
          </Link>
          {!project.is_active && (
            <span className="shrink-0 rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('pages', 'dashboardArchivedBadge')}
            </span>
          )}
        </div>
        <p className="truncate text-[12px] font-normal leading-relaxed text-muted-foreground/60">
          {subtitle}
        </p>
      </div>

      <div className="hidden shrink-0 flex-col items-end pl-2 md:flex">
        <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
          {t('pages', 'dashboardUpdatedPrefix')}
        </span>
        <span className="text-[12px] font-medium text-muted-foreground/80">
          {relativeTime(project.updated_at)}
        </span>
      </div>

      {canManage && (
        <div className="relative z-10 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <HeaderIconButton
                aria-label={t('pages', 'dashboardRowActionsAria')}
                className="opacity-0 transition-opacity duration-75 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none"
              >
                <MoreHorizontal strokeWidth={1.5} aria-hidden="true" />
              </HeaderIconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {project.is_active ? (
                <DropdownMenuItem onSelect={() => onArchivedChange(project.id, true)}>
                  <Archive className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  {t('pages', 'dashboardArchive')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => onArchivedChange(project.id, false)}>
                  <ArchiveRestore className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  {t('pages', 'dashboardRestore')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: exit 0 on both. Everything added here is additive —
`dashboardNoDescription` and the inline row it feeds both survive until Task 13
removes them together, so nothing is knowingly broken at this commit.

Note: `npm run deadcode` is deliberately NOT run here. `ProjectRow` has no
consumer until Task 13, so knip would report it orphaned; that is a normal
mid-TDD state, and the dead-code gates run at the end of Tasks 13 and 14. The
pre-push gate checks `tsc`, which is green.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/project/ProjectRow.tsx frontend/hooks/useArchiveProject.ts \
        frontend/services/projectsService.ts \
        frontend/test/hooks/useArchiveProject.test.tsx frontend/lib/copy/pages.ts
git commit -m "feat(hub): extract the project row and add the archive mutation"
```

---

### Task 13: hub header — search, status filter, sort, three empty states

**Files:**
- Modify: `frontend/pages/Dashboard.tsx` (whole file)
- Modify: `frontend/lib/copy/pages.ts`
- Modify: `scripts/fitness/check_button_scale.baseline`
- Test: `frontend/test/Dashboard.hub.test.tsx`

**Interfaces:**
- Consumes: `useProjectsQuery` + `projectsListKey` (Task 2/10),
  `useArchiveProject` + `ProjectRow` (Task 12), `ListToolbarSearch` /
  `ListDisplaySortPopover` / `EmptyListState` (`@/components/shared/list`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the remaining copy keys and delete the dead one**

In `frontend/lib/copy/pages.ts`, delete `dashboardNoDescription` — the "No
additional description" filler goes with the inline row this task replaces
(spec §5), and the copy baseline is shrink-only, so a newly dead key would fail
the gate rather than be baselined. Then add:

```ts
    dashboardSearchPlaceholder: 'Search projects…',
    dashboardFilterStatusAria: 'Filter projects by status',
    dashboardFilterActive: 'Active',
    dashboardFilterArchived: 'Archived',
    dashboardSortName: 'Name',
    dashboardSortUpdated: 'Updated',
    dashboardSortOrdering: 'Ordering',
    dashboardSortTooltip: 'Sort',
    dashboardSortAria: 'Sort options',
    dashboardNoMatches: 'No projects match your search',
    dashboardNoMatchesDesc: 'Try a different term, or switch the status filter.',
    dashboardClearSearch: 'Clear search',
    dashboardNoArchived: 'No archived projects',
    dashboardNoArchivedDesc: 'Projects you archive are kept here and can be restored at any time.',
```

`dashboardCreatedDate: 'Created'` stays — it is now the Created sort option's
label.

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/test/Dashboard.hub.test.tsx
/**
 * The hub's management surface. jsdom sees no layout and no Tailwind, so
 * nothing here asserts density, the responsive tier or the hover reveal — the
 * `⋯` menu is reached by role, which is what assistive tech does too. Visual
 * fidelity goes through the design-review loop.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router';

// Dashboard reaches the Supabase client through projectsService (createProject),
// and that client throws at import time without a URL. CI runs vitest with no .env.
vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({user: {id: 'u1'}, session: null, loading: false, signOut: vi.fn()}),
}));

const mutate = vi.fn();
vi.mock('@/hooks/useArchiveProject', () => ({useArchiveProject: () => ({mutate})}));

let queryState: Record<string, unknown>;
vi.mock('@/hooks/useProjectsQuery', () => ({useProjectsQuery: () => queryState}));

import Dashboard from '@/pages/Dashboard';

function project(over: Record<string, unknown>) {
  return {
    id: 'p1',
    name: 'Alpha',
    description: 'First review',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-09-07T11:59:30.000Z',
    is_active: true,
    review_title: null,
    // The caller's own membership row — `isProjectManager` checks `user_id`.
    project_members: [{user_id: 'u1', role: 'manager'}],
    ...over,
  };
}

function renderHub(projects: unknown[]) {
  queryState = {data: projects, isLoading: false, isError: false, refetch: vi.fn()};
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Dashboard/>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('projects hub', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists active projects and hides archived ones by default', () => {
    renderHub([project({}), project({id: 'p2', name: 'Beta', is_active: false})]);
    expect(screen.getByRole('link', {name: 'Alpha'})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Beta'})).toBeNull();
  });

  it('shows archived projects behind the Archived filter, with a badge', async () => {
    renderHub([project({}), project({id: 'p2', name: 'Beta', is_active: false})]);
    await userEvent.click(screen.getByRole('tab', {name: 'Archived'}));
    expect(screen.getByRole('link', {name: 'Beta'})).toBeInTheDocument();
    expect(screen.getByText('Archived', {selector: 'span'})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Alpha'})).toBeNull();
  });

  it('filters by search term', async () => {
    renderHub([project({}), project({id: 'p2', name: 'Beta'})]);
    await userEvent.type(screen.getByPlaceholderText('Search projects…'), 'bet');
    expect(screen.getByRole('link', {name: 'Beta'})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Alpha'})).toBeNull();
  });

  it('defaults to Updated descending and re-sorts by name', async () => {
    renderHub([
      project({id: 'p1', name: 'Zeta', updated_at: '2026-09-01T00:00:00.000Z'}),
      project({id: 'p2', name: 'Alpha', updated_at: '2026-09-05T00:00:00.000Z'}),
    ]);
    const names = () => screen.getAllByRole('link').map((el) => el.textContent);
    expect(names()).toEqual(['Alpha', 'Zeta']);

    await userEvent.click(screen.getByRole('button', {name: 'Sort options'}));
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', {name: 'Name'}));
    expect(names()).toEqual(['Zeta', 'Alpha']);
  });

  it('shows the first-project empty state when there are no projects at all', () => {
    renderHub([]);
    expect(screen.getByText('Start with your first project')).toBeInTheDocument();
  });

  it('shows a search empty state when a term matches nothing', async () => {
    renderHub([project({})]);
    await userEvent.type(screen.getByPlaceholderText('Search projects…'), 'zzz');
    expect(screen.getByText('No projects match your search')).toBeInTheDocument();
  });

  it('shows an archived empty state when nothing is archived', async () => {
    renderHub([project({})]);
    await userEvent.click(screen.getByRole('tab', {name: 'Archived'}));
    expect(screen.getByText('No archived projects')).toBeInTheDocument();
  });

  it('offers Archive to managers and fires the mutation', async () => {
    renderHub([project({})]);
    await userEvent.click(screen.getByRole('button', {name: 'Project actions'}));
    await userEvent.click(await screen.findByRole('menuitem', {name: 'Archive'}));
    expect(mutate).toHaveBeenCalledWith(
      {projectId: 'p1', archived: true},
      expect.anything(),
    );
  });

  it('does not offer the row menu to non-managers', () => {
    renderHub([project({project_members: [{user_id: 'u1', role: 'reviewer'}]})]);
    expect(screen.queryByRole('button', {name: 'Project actions'})).toBeNull();
  });

  it('does not offer the row menu on someone else\'s manager row', () => {
    // If the embed filter ever stopped narrowing, the whole roster would
    // arrive; the affordance must still answer for the caller alone.
    renderHub([
      project({
        project_members: [
          {user_id: 'someone-else', role: 'manager'},
          {user_id: 'u1', role: 'viewer'},
        ],
      }),
    ]);
    expect(screen.queryByRole('button', {name: 'Project actions'})).toBeNull();
  });

  it('renders relative update metadata, not a creation date', () => {
    renderHub([project({})]);
    const row = screen.getByRole('link', {name: 'Alpha'}).closest('div.group') as HTMLElement;
    expect(within(row).getByText('Updated')).toBeInTheDocument();
    expect(within(row).queryByText('Created')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:run -- frontend/test/Dashboard.hub.test.tsx`
Expected: FAIL — no search input, no status tabs, no sort popover.

- [ ] **Step 4: Rewrite `Dashboard.tsx`**

```tsx
import {useState, type ReactNode} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useAuth} from "@/contexts/AuthContext";
import {createProject} from "@/services/projectsService";
import {Button} from "@/components/ui/button";
import {Skeleton} from "@/components/ui/skeleton";
import {BookOpen, Plus, Search} from "lucide-react";
import {toast} from "sonner";
import {AddProjectDialog} from "@/components/project/AddProjectDialog";
import {ProjectRow} from "@/components/project/ProjectRow";
import {ErrorState} from "@/components/patterns/ErrorState";
import {EmptyListState, ListDisplaySortPopover, ListToolbarSearch} from "@/components/shared/list";
import {projectsListKey, useProjectsQuery} from "@/hooks/useProjectsQuery";
import {useArchiveProject} from "@/hooks/useArchiveProject";
import type {ProjectListItem} from "@/types/project";
import {t} from '@/lib/copy';
import {cn} from "@/lib/utils";

type StatusFilter = 'active' | 'archived';
type SortField = 'name' | 'created_at' | 'updated_at';
type SortDirection = 'asc' | 'desc';

/** Page gutter, per frontend-ux §6. Never wider. */
const GUTTER = "px-4 lg:px-6";

function matchesSearch(project: ProjectListItem, term: string): boolean {
  if (term === '') return true;
  const haystack = `${project.name} ${project.description ?? ''} ${project.review_title ?? ''}`;
  return haystack.toLowerCase().includes(term);
}

function compare(a: ProjectListItem, b: ProjectListItem, field: SortField): number {
  if (field === 'name') return a.name.localeCompare(b.name);
  return Date.parse(a[field]) - Date.parse(b[field]);
}

export default function Dashboard() {
  const {user} = useAuth();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [status, setStatus] = useState<StatusFilter>('active');
  const [sortField, setSortField] = useState<SortField>('updated_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const {data: projects = [], isLoading, isError, refetch} = useProjectsQuery();
  const archive = useArchiveProject();

  const term = searchTerm.trim().toLowerCase();
  const inStatus = projects.filter((p) => (status === 'active' ? p.is_active : !p.is_active));
  const visible = inStatus
    .filter((p) => matchesSearch(p, term))
    .slice()
    .sort((a, b) => (sortDirection === 'asc' ? compare(a, b, sortField) : -compare(a, b, sortField)));

  const handleArchivedChange = (projectId: string, archived: boolean) => {
    archive.mutate(
      {projectId, archived},
      {
        onSuccess: () => toast.success(t('pages', archived ? 'dashboardArchived' : 'dashboardRestored')),
        onError: (error) => toast.error(error.message || t('pages', 'dashboardArchiveFailed')),
      },
    );
  };

  const handleCreateProject = async (data: { name: string; description?: string }) => {
    if (!user?.id) {
      toast.error(t('pages', 'dashboardAuthRequired'));
      return;
    }
    setCreating(true);
    const result = await createProject(data.name, data.description);
    setCreating(false);
    if (!result.ok) {
      toast.error(`${t('pages', 'dashboardErrorCreating')}: ${result.error.message}`);
      return;
    }
    toast.success(t('pages', 'dashboardProjectCreated'));
    await queryClient.invalidateQueries({queryKey: projectsListKey(user.id)});
    setAddDialogOpen(false);
  };

  const statusTab = (value: StatusFilter, label: string) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={status === value}
      onClick={() => setStatus(value)}
      className={cn(
        'h-7 shrink-0 rounded px-3 text-[13px] font-medium transition-colors duration-75 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        status === value ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  // ONE control bar. Below the compact breakpoint it wraps to a second line
  // rather than duplicating the tablist — two `role="tab"` sets with the same
  // names would be two entries in the a11y tree, and ambiguous to query.
  const header = (
    <div className={cn("@container/hubbar sticky top-0 z-10 shrink-0 border-b border-border/40 bg-background/80 backdrop-blur-md", GUTTER)}>
      <div className="flex min-h-12 flex-wrap items-center gap-2 py-1.5 @[34rem]/hubbar:flex-nowrap @[34rem]/hubbar:py-0">
        <ListToolbarSearch
          placeholder={t('pages', 'dashboardSearchPlaceholder')}
          value={searchTerm}
          onChange={setSearchTerm}
        />
        <div
          role="tablist"
          aria-label={t('pages', 'dashboardFilterStatusAria')}
          className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/40 p-0.5"
        >
          {statusTab('active', t('pages', 'dashboardFilterActive'))}
          {statusTab('archived', t('pages', 'dashboardFilterArchived'))}
        </div>
        <ListDisplaySortPopover
          sortOptions={[
            {value: 'name', label: t('pages', 'dashboardSortName')},
            {value: 'created_at', label: t('pages', 'dashboardCreatedDate')},
            {value: 'updated_at', label: t('pages', 'dashboardSortUpdated')},
          ]}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortFieldChange={(v) => setSortField(v as SortField)}
          onSortDirectionChange={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
          orderLabel={t('pages', 'dashboardSortOrdering')}
          tooltipLabel={t('pages', 'dashboardSortTooltip')}
          ariaLabel={t('pages', 'dashboardSortAria')}
        />
        <Button
          variant="default"
          size="sm"
          onClick={() => setAddDialogOpen(true)}
          disabled={creating}
          className="shrink-0 gap-1.5 rounded-md text-[12px] font-medium shadow-xs transition-all motion-reduce:transition-none"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true"/>
          {/* Folds to sr-only, never to `hidden`: `hidden` would strip the word
              from the button's accessible name (.claude/rules/frontend.md). */}
          <span className="sr-only @[34rem]/hubbar:not-sr-only">{t('pages', 'dashboardNewProject')}</span>
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <>
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="divide-y divide-border/30">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={cn("flex items-center gap-3 py-3", GUTTER)}>
                <Skeleton className="h-9 w-9 shrink-0 rounded-lg"/>
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/3 max-w-[180px]"/>
                  <Skeleton className="h-3 w-1/2 max-w-[280px]"/>
                </div>
                <Skeleton className="hidden h-7 w-16 shrink-0 rounded md:block"/>
                <Skeleton className="h-8 w-8 shrink-0 rounded-md"/>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  if (isError) {
    return (
      <>
        {header}
        <div className={cn("min-h-0 flex-1 overflow-y-auto py-6", GUTTER)}>
          <ErrorState message={t('pages', 'dashboardCouldNotLoadProjects')} onRetry={refetch}/>
        </div>
      </>
    );
  }

  // Three distinct empty states, not one (spec §5).
  let body: ReactNode;
  if (projects.length === 0) {
    body = (
      <div className={cn("flex flex-col items-center justify-center py-16 sm:py-20 lg:py-28", GUTTER)}>
        <div className="w-full max-w-sm text-center duration-500 animate-in fade-in slide-in-from-bottom-4 motion-reduce:animate-none">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
            <BookOpen className="h-6 w-6 text-muted-foreground/40" strokeWidth={1.5}/>
          </div>
          <h3 className="mb-2 text-base font-medium text-foreground">
            {t('pages', 'dashboardStartFirstProject')}
          </h3>
          <p className="mx-auto mb-8 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {t('pages', 'dashboardStartFirstProjectDesc')}
          </p>
          <Button
            onClick={() => setAddDialogOpen(true)}
            className="rounded-md px-6 text-xs font-medium shadow-xs transition-all motion-reduce:transition-none"
          >
            <Plus className="mr-2 h-3.5 w-3.5"/>
            {t('pages', 'dashboardCreateProject')}
          </Button>
        </div>
      </div>
    );
  } else if (visible.length === 0 && term !== '') {
    body = (
      <div className={cn("py-6", GUTTER)}>
        <EmptyListState
          icon={Search}
          title={t('pages', 'dashboardNoMatches')}
          description={t('pages', 'dashboardNoMatchesDesc')}
          actionLabel={t('pages', 'dashboardClearSearch')}
          onAction={() => setSearchTerm('')}
        />
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className={cn("py-6", GUTTER)}>
        <EmptyListState
          icon={BookOpen}
          title={t('pages', 'dashboardNoArchived')}
          description={t('pages', 'dashboardNoArchivedDesc')}
        />
      </div>
    );
  } else {
    body = (
      <div className="divide-y divide-border/30">
        {visible.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            userId={user?.id ?? ''}
            onArchivedChange={handleArchivedChange}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      <AddProjectDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onProjectCreate={handleCreateProject}
        isCreating={creating}
      />
    </>
  );
}
```

Note the two `h-8` / `h-9` Button overrides are gone — the Button scale owns
height (`frontend-ux`), which is why `check_button_scale.baseline` can be
tightened in the next step.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- frontend/test/Dashboard.hub.test.tsx`
Expected: PASS (11 tests).

- [ ] **Step 6: Tighten the button-scale baseline**

Run: `python3 scripts/fitness/check_button_scale.py --update-baseline`
Then: `git diff scripts/fitness/check_button_scale.baseline`
Expected: the `frontend/pages/Dashboard.tsx:2` line removed. If a line is
ADDED anywhere, a new height override slipped in — remove it instead.

- [ ] **Step 7: Full suite and every gate**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run deadcode && npm run deadcode:production && bash scripts/fitness/run_all.sh`
Expected: exit 0 on all six. This is the first run where `ProjectRow` has a
consumer, so it is also the dead-code gate for Task 12's additions.

- [ ] **Step 8: Commit**

```bash
git add frontend/pages/Dashboard.tsx frontend/lib/copy/pages.ts \
        frontend/test/Dashboard.hub.test.tsx scripts/fitness/check_button_scale.baseline
git commit -m "feat(hub): add search, status filter, sort and three distinct empty states"
```

---

### Task 14: E2E, visual verification, final gates

**Files:**
- Modify: `frontend/e2e/flows/projects.e2e.ts`

**Interfaces:**
- Consumes: everything above. Produces nothing.

- [ ] **Step 1: Rewrite the E2E flow with scoped pickers**

`projects.e2e.ts:32` uses an unscoped `page.getByText("Project not found")`.
Unscoped pickers in this suite have previously poisoned backend test data, so
every picker below is scoped to a landmark, a role or a test id.

```ts
import { expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

test.describe("Projects navigation flows", () => {
  test("lands on the hub inside the unified shell", async ({ page }) => {
    const required = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    await loginViaUi(page);
    await expect(page).toHaveURL(/\/$/);

    const shell = page.getByTestId("app-shell");
    await expect(shell).toBeVisible();
    // Precondition: the route match yielded no project id, so the workspace
    // state below is the state actually under test.
    await expect(shell).toHaveAttribute("data-project-id", "");
    await expect(shell.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Projects");
    await expect(shell.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  test("opens a project and returns to the hub through the switcher", async ({ page }) => {
    const required = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "E2E_PROJECT_ID"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}`);
    await expect(page).toHaveURL(new RegExp(`/projects/${env.projectId}`));

    const shell = page.getByTestId("app-shell");
    await expect(shell).toHaveAttribute("data-project-id", env.projectId);
    await expect(shell.getByRole("button", { name: "Articles" })).toBeVisible();

    await shell.getByRole("button", { name: /^G P|Project/ }).first().click();
    await page.getByRole("menuitem", { name: "Back to projects" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("app-shell")).toHaveAttribute("data-project-id", "");
  });

  test("returns not found or guard behavior for unknown project id", async ({ page }) => {
    const required = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/00000000-0000-0000-0000-000000000000`);
    const shell = page.getByTestId("app-shell");
    await expect(shell.getByText("Project not found")).toBeVisible({ timeout: 10000 });
    // The shell around it must answer too: the breadcrumb landmark names the
    // unresolvable id rather than shimmering forever with no accessible text.
    await expect(
      shell.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("Unknown project");
    expect(page.url()).toContain("/projects/00000000-0000-0000-0000-000000000000");
  });
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `npx playwright test --project=local-api --project=local-ui`
Expected: exit 0. If the fixture env keys are absent the tests skip — that is
a pass, not a silent hole; note it in the PR body.

- [ ] **Step 3: Visual verification (NOT unit-testable)**

jsdom sees neither layout nor Tailwind, so nothing above proves density,
spacing, the responsive tiers or dark mode. Run the `design-review` loop —
render, screenshot, compare against the Plane/Linear target, fix, re-screenshot
— on each of:

- `/` at 1440 px and at 375 px (the hub bar's four controls and its compact tier)
- `/projects/<id>?tab=extraction` at 1440 px (breadcrumb truncation + the
  centred view switcher sharing one `h-12` row)
- `/settings` at 1440 px and at 375 px (the rail must no longer read as a
  second sidebar, and must not eat the viewport at 375 px)
- the sidebar's workspace state in both light and dark themes

Run: `/design-review /` then `/design-review /settings`

Also confirm by eye: the top bar's scroll elevation. `useScrolled` listens on
`window`, and inside the `h-screen` shell the document no longer scrolls — the
main pane does. If the shadow never appears, record it as a follow-up rather
than widening this PR.

- [ ] **Step 4: Run the full gate, both layers**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run deadcode && npm run deadcode:production && bash scripts/fitness/run_all.sh`
Expected: exit 0 on all six.

Run: `make lint-backend && make test-backend`
Expected: exit 0 on both — this run added a backend module (Task 9), so the
backend gates are part of "done" and the vulture ratchet must not have grown.

Run: `npm run generate:api-types && git diff --exit-code frontend/types/api/`
Expected: exit 0 — the committed contract still matches the backend, which is
what CI's `api-contract` job checks.

Read every output — do not assert from memory
(`verification-before-completion`).

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/flows/projects.e2e.ts
git commit -m "test(e2e): cover the unified shell with scoped pickers"
```

- [ ] **Step 6: Correct the spec's stale SQL anchors**

Ledger 2026-09-07T14:33Z: the spec's three `baseline_v1.sql` line anchors in §6
are each off by 3, the quoted SQL itself is correct, and the file's directory is
omitted (it is `backend/alembic/versions/`, not `supabase/migrations/` — the
app schema is owned by Alembic). In
`docs/superpowers/specs/2026-09-07-projects-hub-shell-design.md`, change
`baseline_v1.sql:2838` → `backend/alembic/versions/baseline_v1.sql:2835`,
`baseline_v1.sql:2824` → `backend/alembic/versions/baseline_v1.sql:2821`, and
`baseline_v1.sql:1710` → `backend/alembic/versions/baseline_v1.sql:1707`.

Verify before editing — each line must print the statement the spec quotes
(`project_update`, `project_members_select`, `trg_projects_updated_at`):

```bash
sed -n '1707p;2821p;2835p' backend/alembic/versions/baseline_v1.sql
```

- [ ] **Step 7: Commit the spec correction**

```bash
git add docs/superpowers/specs/2026-09-07-projects-hub-shell-design.md
git commit -m "docs(spec): correct the three baseline_v1.sql line anchors in §6"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §3.1 one shell, derived from the URL, no `ProjectContext` | 1, 6 |
| §3.2 navigation inverts to URL-driven | 4 (both halves: the sidebar writes `?tab=`, and `projectSectionNav.test.tsx` asserts `ProjectContext` follows), 5, 7 |
| §3.3 run routes stay on `RunWorkspaceShell` | 4 (prop swap only), 6 (routes untouched) |
| §4 sidebar, two states, 280/240/400/150, footer constant | 3, 4 |
| §4.1 `G H` free; workspace bindings everywhere, project bindings gated | 5 — and asserted with real keydowns in `frontend/test/hooks/useNavigationShortcuts.test.tsx`, including the negative case with its positive control |
| §5 hub header (title dropped per ledger), row subtractions, sort, 3 empty states | 12, 13 |
| §6.1 archive reuses `is_active`; the write is refused for non-managers; manager-gated affordance; embedded member row | 9, 10, 12 — **spec §6.1's PostgREST write is overridden.** ADR-0007 is accepted and constitution §VI revokes the "simple table operations" allowance, so the write is `PATCH /api/v1/projects/{id}/archive` behind `require_project_manager` (ledger 15:45Z, BLO1). The requirement §6.1 was protecting — "a non-manager's write must never read as success" — is met more strongly: a 403, not a zero-row 200 the client has to notice. |
| §6.2 `updated_at` is trigger-maintained; the list read stays on PostgREST | 10, 11 |
| §7 deferred pin slice | Untouched by design — the row's metadata slot and the sidebar's section list are the only seams it needs, and both survive. |
| §8 testing | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 — every task that changes behaviour now carries a test that is red before it |
| Ledger 14:50Z top bar | 7 |
| Ledger 14:45Z settings rail | 8 |
| Ledger 14:33Z `useProjectsList` on TanStack | 2 (moved into slice 1 — `AppShell` needs the cache entry for the breadcrumb) |
| Ledger 14:33Z `isProjectPage` → `useLocation()` | 7 (via `useShellLocation`, which wraps `useLocation`) |
| Ledger 14:33Z spec SQL anchors | 14 |
| Ledger discrepancy C `SectionViewSwitcher` | 7 — the ledger says the switcher is "unchanged"; it is unchanged *visually* and its testid does not move, but it reads `ProjectContext` directly and would render **null** once the bar sits above `ProjectProvider`. Its data source must change. Called out in the report. |
| Ledger discrepancy F row `aria-label` | 12 — removed entirely by the stretched-link pattern. |
| Ledger discrepancy K settings hardcoded strings | 8 — the seven keys already exist and are baselined; the title/back strings are deleted with their controls. |

Panel rulings (ledger 2026-09-07T15:45Z), and where each landed:

| Finding | Where |
|---|---|
| BLO1 archive write violates ADR-0007 / §VI | Task 9 (new backend endpoint), Task 12 (apiClient call); the two Global Constraints that enabled it are deleted |
| BLO2 / BLO4 / ADV7 cross-user cache leak | Task 2 — `projectsListKey(userId)` from birth, with a test that fails under the old key |
| BLO3 / BLO6 `useNavigationShortcuts` untested | Task 5 — 6 keyboard tests |
| BLO5 `ProjectContext` follows the URL write | Task 4 Step 2 |
| BLO7 Task 2 had no red step | Task 2 Step 1 |
| ADV1 `as unknown as` double cast | Task 10 Step 6 — one assertion, on the embed only |
| ADV2 `projectKeys.all` as a leaf key | Tasks 2, 12, 13 — every invalidation names the list entry |
| ADV3 commits with a knowingly red typecheck | Tasks 4 and 5 shim `AppLayout`; Task 12 defers the copy-key deletion to Task 13 |
| ADV4 a third manager predicate | Task 10 — `isManagerRole` is the one implementation; `useProjectMemberRole` uses it |
| ADV5 embed narrowing proven on a mock | Task 10 — `isProjectManager` re-checks `user_id`, tested against a full roster |
| ADV6 archive is presentation-only | "Accepted" section + the PR body |
| ADV8 DB contract vs a fake query builder | "Accepted" section — the write half became real integration tests via BLO1 |
| ADV9 `updated_at` reorders on archive | "Accepted" section + a note in the service docstring |
| ADV10 baselined `h-8` moved out of the gate's sight | Task 4 — the override is deleted and the baseline shrinks |
| ADV11 chord generalization | Task 3 — dropped; `shortcut` merely became optional |
| ADV12 nav written out four times | Task 3 — `deriveSidebarNav`, rendered by both rails |
| ADV13 `UserSettings` rewritten with no test | Task 8 Step 1 |
| ADV14 `relativeTime` races the machine timezone | Task 11 — asserted zone-independently, with a non-vacuity check |
| ADV15 the `enabled` gate is untested | Task 2 Step 1, fourth case |
| **UPHELD 2026-09-07** — the migration onto `useProjectsQuery` deletes the project-list read's only error surface, and the breadcrumb renders every unresolved root as a permanent `aria-hidden` shimmer, so a failed list read is invisible on every project route | Task 2 (`useProjectsList` exposes `isError` + `retry`; `SidebarHeader` renders four distinct menu states, proved in `frontend/components/layout/SidebarHeader.test.tsx`) and Task 7 (the breadcrumb root splits into loading / failed / not-in-list / resolved, proved in `frontend/components/navigation/Breadcrumb.test.tsx` including a non-vacuity guard that the four render four different strings). Task 14's unknown-id E2E now asserts the landmark too. The state count is four, not three, because the id-not-in-list case is an ordinary stale-link outcome and must not be dressed as a failure. |

No spec requirement is left without a task. **§7 (the deferred pin slice) is
deliberately not built** — the spec places it in a later slice.

**2. Placeholder scan** — no `TBD`, no "similar to Task N", no "add error
handling"; every code step carries the literal code, and every test step the
literal test. Two non-code steps by design: Task 14's design-review loop, routed
there because jsdom sees neither layout nor Tailwind, and Task 9's
`npm run generate:api-types`, whose output is generated and must never be
hand-written.

**3. Type consistency** — checked across tasks:
`useShellLocation(): {projectId: string | null; activeSection: SidebarTabId | null}`
is consumed with that exact shape in Tasks 4, 6, 7. `ProjectSidebar` /
`MobileSidebar` take `projectId: string | null` in Tasks 4, 6 and
`RunWorkspaceShell` passes a `string` (assignable). `SidebarNavItem` takes
`shortcut?: string` in Tasks 3, 4, and `deriveSidebarNav`'s `SidebarNavEntry`
supplies exactly `{icon, label, shortcut?, active, path}`.
`projectsListKey(userId: string)` is defined in Task 2 and called in Tasks 2,
12, 13. `useProjectsQuery(): UseQueryResult<ProjectListItem[], Error>` is
destructured as `{data, isLoading, isError, refetch}` in Tasks 2 and 13, as
`{data, isError}` in Task 7 and as `{data}` in Task 6 — all subsets of the same
result. `useProjectsList(): {projects, loading, isError, retry, switchProject}`
is produced in Task 2 and consumed only by `SidebarHeader` (Tasks 2, 4).
`listProjectsForDashboard(userId: string)` gains its parameter in Task 10 and
its only caller is `useProjectsQuery`.
`setProjectArchived(projectId, archived) → ProjectArchiveRead` (Task 12)
matches `useArchiveProject`'s `mutationFn` and its test, and
`ProjectArchiveRead` is the generated `{id, is_active}` from Task 9's
`backend/app/schemas/project_archive.py`.
`isManagerRole(role)` and `isProjectManager(project, userId)` are defined in
Task 10 and used in Task 12 (`ProjectRow`) and Task 10
(`useProjectMemberRole`). `relativeTime(iso, now?)` is defined in Task 11 and
used in Task 12.
