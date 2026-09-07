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
shared TanStack cache entry (`projectKeys.all`) that the switcher, the
breadcrumb and the list all resolve from, so an archive invalidation reaches
every surface.

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
- Commands: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npm run deadcode`, `npm run deadcode:production`, `npx playwright test --project=local-api --project=local-ui`, `bash scripts/fitness/run_all.sh`.
- No migration. No backend change. No Alembic revision. This is frontend-only.
- Conventional commits; each task ends in its own commit.

Additional constraints this plan carries:

- **Two slices, ONE branch (`claude/projects-hub-shell-design-046560`), ONE PR.**
  Tasks 1–8 are slice 1; tasks 9–13 are slice 2. Do not open a second PR.
- **Frontend tooling runs from the repo ROOT.** There is no
  `frontend/package.json`. Never `cd frontend && npm ...`.
- **`supabase` and `.from(` must stay on separate source lines.**
  `scripts/fitness/check_frontend_data_path.py` matches
  `\bsupabase\s*\.\s*from\s*\(` on a single line; every existing service write
  is already split across lines and is therefore not a violation. Collapsing
  one onto a single line adds a new violation to a baseline that may not grow.
- **Data flow is `component → hook (TanStack) → service (apiClient/supabase) →
  backend`.** Services return `ErrorResult<T>` via `toResult` and never throw
  across the boundary and never toast. Query keys come from
  `frontend/lib/query-keys/` (CI-enforced).
- **React Compiler runs with `panicThreshold: 'all_errors'`.** No `try/finally`
  and no `throw` inside a component or hook *body*; `throw` inside a query/
  mutation callback is the established in-repo pattern (`Dashboard.tsx:31`).
- **jsdom sees neither layout nor Tailwind.** Density, spacing, responsive
  tiers and visual fidelity are NOT asserted in unit tests — they go through
  the `design-review` screenshot loop (Task 13).
- **Playwright: scoped pickers only.** Unscoped pickers in this suite have
  previously poisoned backend test data (`frontend/e2e/flows/projects.e2e.ts:32`).

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `frontend/hooks/useShellLocation.ts` | The one URL derivation: active project id (`matchPath`) + active section (`?tab=`). No provider dependency. |
| `frontend/hooks/useProjectsQuery.ts` | The one project-list read, under `projectKeys.all`. Hub, switcher and breadcrumb all resolve from it. |
| `frontend/hooks/useArchiveProject.ts` | Archive/restore mutation; treats a zero-row update as an error; invalidates `projectKeys.all`. |
| `frontend/components/layout/AppShell.tsx` | The shell: Topbar + sidebar + mobile drawer + `<Outlet/>`. Owns `switcherOpen` and the nav shortcuts. |
| `frontend/components/layout/SidebarBrandHeader.tsx` | `BrandMark` (the `R` square) + the `h-12` brand header row for the no-project sidebar state. |
| `frontend/components/navigation/Breadcrumb.tsx` | Route-derived breadcrumb rendered in the Topbar's left region. |
| `frontend/components/project/ProjectRow.tsx` | One hub row: stretched link, metadata, hover `⋯` menu. |
| `frontend/lib/relative-time.ts` | `relativeTime(iso, now?)` — compact relative time over the existing `common.time*` copy keys. |
| `frontend/test/hooks/useShellLocation.test.tsx` | Derivation unit tests. |
| `frontend/test/appShell.routes.test.tsx` | App-level route tests for the shell (template: `legacyArticleRoutes.test.tsx`). |
| `frontend/components/layout/ProjectSidebar.test.tsx` | Sidebar's two states + URL-driven nav. |
| `frontend/test/relativeTime.test.ts` | Formatter unit tests. |
| `frontend/test/hooks/useArchiveProject.test.tsx` | Zero-row-as-error. |
| `frontend/test/Dashboard.hub.test.tsx` | Search, filter, sort, three empty states, row affordances. |

**Modified**

| File | Change |
|---|---|
| `frontend/App.tsx` | `SidebarProvider` above `Routes`; a layout route renders `AppShell` around `/`, `/projects/:projectId`, `/settings`. |
| `frontend/components/layout/AppLayout.tsx` | **Deleted** — both `AppLayout` and `ProjectLayout` are superseded by `AppShell`. |
| `frontend/components/layout/ProjectSidebar.tsx` | Gains a no-project state; `onTabChange` → `projectId` + internal URL navigation. |
| `frontend/components/layout/MobileSidebar.tsx` | Same inversion + no-project state. |
| `frontend/components/layout/SidebarNavItem.tsx` | Shortcut prop generalized from a `G`-sequence letter to `keys[] + variant`. |
| `frontend/components/layout/SidebarHeader.tsx` | Post-create refresh moves from `loadProjects()` to a `projectKeys.all` invalidation. |
| `frontend/components/layout/sidebarConfig.ts` | Adds `workspaceNavItems` + `workspaceSectionTitle`. |
| `frontend/components/navigation/Topbar.tsx` | Breadcrumb bar; toggle on every shell route; `window.location` → `useShellLocation()`; brand block removed. |
| `frontend/components/navigation/SectionViewSwitcher.tsx` | Reads the URL instead of `ProjectContext` (it now renders above `ProjectProvider`). |
| `frontend/components/runs/RunWorkspaceShell.tsx` | Prop swap only: `onTabChange={goToTab}` → `projectId={projectId}`. |
| `frontend/hooks/useNavigationShortcuts.ts` | URL-driven; workspace bindings always, project bindings only with a project id; adds `G H`. |
| `frontend/hooks/useProjectsList.ts` | Migrated onto `useProjectsQuery`, filtered to `is_active`. |
| `frontend/pages/Dashboard.tsx` | De-chromed, gutter converged, hub toolbar + row extraction + empty states. |
| `frontend/pages/UserSettings.tsx` | Folds into the shell; title/back removed; rail restyled + mobile tier; copy keys wired. |
| `frontend/services/projectsService.ts` | `listProjects` deleted; `listProjectsForDashboard` widened; `setProjectArchived` added. |
| `frontend/types/project.ts` | `ProjectListItem` gains `updated_at` + the embedded `project_members` row. |
| `frontend/lib/copy/{layout,navigation,pages}.ts` | New keys; two dead `pages` keys deleted. |
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

### Task 2: one cached project list for the hub, the switcher and the shell

Ledger ruling 2026-09-07T14:33Z. The switcher's list is today a second,
uncached, unfiltered `select('*')` read that no invalidation reaches
(discrepancy I). Once the hub and the switcher share a screen, archiving a
project would refresh one and not the other. This task is scheduled in slice 1
because `AppShell` (Task 6) needs the same cache entry to resolve the
breadcrumb's project name.

**Files:**
- Create: `frontend/hooks/useProjectsQuery.ts`
- Modify: `frontend/hooks/useProjectsList.ts` (whole file)
- Modify: `frontend/services/projectsService.ts:16-25` (delete `listProjects`)
- Modify: `frontend/components/layout/SidebarHeader.tsx:30-53`
- Modify: `frontend/pages/Dashboard.tsx:1-35`
- Test: `frontend/test/services/projectsService.test.ts` (retarget)

**Interfaces:**
- Consumes: `listProjectsForDashboard` (`projectsService`), `projectKeys.all`
  (`@/lib/query-keys`), `ProjectListItem` (`@/types/project`).
- Produces: `useProjectsQuery(): UseQueryResult<ProjectListItem[], Error>` —
  consumed by Tasks 6, 7 and 12. `useProjectsList()` keeps its
  `{projects, loading, switchProject}` shape but drops `loadProjects`.

- [ ] **Step 1: Retarget the service test to the surviving reader**

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

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- frontend/test/services/projectsService.test.ts`
Expected: PASS already (the first test's `select` assertion matches today's
string). This step is the guard rail for Task 9, which widens that string — it
is deliberately asserted verbatim so a silent widening cannot slip through.

- [ ] **Step 3: Delete the second read path**

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

- [ ] **Step 4: Add the shared query hook**

```ts
// frontend/hooks/useProjectsQuery.ts
/**
 * The ONE project-list read.
 *
 * The hub, the sidebar project switcher and the shell breadcrumb all resolve
 * from this single cache entry under `projectKeys.all`, so a mutation that
 * invalidates that family refreshes every one of them. Before this hook the
 * switcher held a second, uncached `select('*')` read that no invalidation
 * reached — archiving a project would refresh the hub and leave the switcher
 * listing it (ledger 2026-09-07T14:33Z).
 */
import {useQuery, type UseQueryResult} from '@tanstack/react-query';
import {listProjectsForDashboard} from '@/services/projectsService';
import {projectKeys} from '@/lib/query-keys';
import type {ProjectListItem} from '@/types/project';

export function useProjectsQuery(): UseQueryResult<ProjectListItem[], Error> {
  return useQuery<ProjectListItem[], Error>({
    queryKey: projectKeys.all,
    queryFn: async () => {
      const result = await listProjectsForDashboard();
      if (!result.ok) throw result.error;
      return result.data;
    },
    staleTime: 30_000,
  });
}
```

- [ ] **Step 5: Migrate the switcher's list onto it**

Replace the whole of `frontend/hooks/useProjectsList.ts`:

```ts
/**
 * The project switcher's list: the shared `projectKeys.all` cache entry,
 * filtered to active projects. Archived projects are reachable from the hub's
 * Archived filter, never from the switcher.
 */
import {useNavigate} from 'react-router';
import {useProjectsQuery} from './useProjectsQuery';
import type {ProjectListItem} from '@/types/project';

interface UseProjectsListReturn {
  projects: ProjectListItem[];
  loading: boolean;
  switchProject: (projectId: string) => void;
}

export const useProjectsList = (): UseProjectsListReturn => {
  const navigate = useNavigate();
  const {data, isLoading} = useProjectsQuery();
  const projects = (data ?? []).filter((project) => project.is_active);

  const switchProject = (projectId: string) => {
    navigate(`/projects/${projectId}`);
  };

  return {projects, loading: isLoading, switchProject};
};
```

- [ ] **Step 6: Point the switcher's post-create refresh at the cache**

In `frontend/components/layout/SidebarHeader.tsx`, add the imports and replace
the destructure and the create handler's refresh:

```tsx
import {useQueryClient} from '@tanstack/react-query';
import {projectKeys} from '@/lib/query-keys';
```

```tsx
  const {projects, loading, switchProject} = useProjectsList();
  const queryClient = useQueryClient();
```

```tsx
    toast.success(t('pages', 'dashboardProjectCreated'));
    setShowAddDialog(false);
    await queryClient.invalidateQueries({queryKey: projectKeys.all});
    switchProject(result.data.projectId);
```

- [ ] **Step 7: Point the Dashboard at the shared hook**

In `frontend/pages/Dashboard.tsx`, delete the inline `useQuery` block
(lines 27–35) and its `listProjectsForDashboard` / `useQuery` / `ProjectListItem`
imports, and read from the hook instead:

```tsx
import {useProjectsQuery} from "@/hooks/useProjectsQuery";
```

```tsx
  const {data: projects = [], isLoading, isError, refetch} = useProjectsQuery();
```

`useQueryClient`, `createProject` and `projectKeys` stay — the create handler
still invalidates.

- [ ] **Step 8: Run the suite and the dead-code gates**

Run: `npm run test:run -- frontend/test/services/projectsService.test.ts frontend/test/RunWorkspaceShell.test.tsx`
Expected: PASS.

Run: `npm run typecheck && npm run deadcode && npm run deadcode:production`
Expected: exit 0 on all three (`listProjects` is gone, so nothing is orphaned).

- [ ] **Step 9: Commit**

```bash
git add frontend/hooks/useProjectsQuery.ts frontend/hooks/useProjectsList.ts \
        frontend/services/projectsService.ts frontend/components/layout/SidebarHeader.tsx \
        frontend/pages/Dashboard.tsx frontend/test/services/projectsService.test.ts
git commit -m "refactor(projects): one cached project list for hub, switcher and shell"
```

---

### Task 3: sidebar primitives for the workspace state

**Files:**
- Create: `frontend/components/layout/SidebarBrandHeader.tsx`
- Modify: `frontend/components/layout/SidebarNavItem.tsx`
- Modify: `frontend/components/layout/SidebarNavItem.test.tsx`
- Modify: `frontend/components/layout/sidebarConfig.ts`
- Modify: `frontend/lib/copy/layout.ts`

**Interfaces:**
- Produces:
  - `SidebarNavItem` props become `{icon, label, shortcutKeys: string[], shortcutVariant?: 'chord' | 'sequence', active, onClick}`.
  - `BrandMark: React.FC<{className?: string}>` and `SidebarBrandHeader: React.FC` from `SidebarBrandHeader.tsx`.
  - `workspaceNavItems: WorkspaceNavItem[]` and `workspaceSectionTitle: string` from `sidebarConfig.ts`, where
    `WorkspaceNavItem = {id: 'hub' | 'settings'; label: string; icon: LucideIcon; path: string; shortcutKeys: string[]; shortcutVariant: 'chord' | 'sequence'}`.
- Consumed by Task 4 (`ProjectSidebar`, `MobileSidebar`).

- [ ] **Step 1: Write the failing test**

Replace `frontend/components/layout/SidebarNavItem.test.tsx` with:

```tsx
import {describe, it, expect, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {FileText, Settings} from 'lucide-react';
import {SidebarNavItem} from './SidebarNavItem';

describe('SidebarNavItem', () => {
  it('renders label and sequence shortcut badge', () => {
    render(<SidebarNavItem icon={FileText} label="Articles" shortcutKeys={['G', 'A']} shortcutVariant="sequence" active={false} onClick={vi.fn()} />);
    expect(screen.getByText('Articles')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('marks active item with aria-current', () => {
    render(<SidebarNavItem icon={FileText} label="Articles" shortcutKeys={['G', 'A']} shortcutVariant="sequence" active onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'page');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<SidebarNavItem icon={FileText} label="Articles" shortcutKeys={['G', 'A']} shortcutVariant="sequence" active={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes a sequence as space-separated aria-keyshortcuts', () => {
    render(<SidebarNavItem icon={FileText} label="Articles" shortcutKeys={['G', 'A']} shortcutVariant="sequence" active={false} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-keyshortcuts', 'G A');
  });

  it('exposes a chord as a plus-joined aria-keyshortcuts with Meta for mod', () => {
    render(<SidebarNavItem icon={Settings} label="Settings" shortcutKeys={['mod', ',']} shortcutVariant="chord" active={false} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-keyshortcuts', 'Meta+,');
  });

  it('hides the shortcut chip at rest and reveals it on hover and keyboard focus', () => {
    render(<SidebarNavItem icon={FileText} label="Articles" shortcutKeys={['G', 'A']} shortcutVariant="sequence" active={false} onClick={vi.fn()} />);
    const chip = screen.getByText('A').parentElement as HTMLElement;
    expect(chip.className).toContain('opacity-0');
    expect(chip.className).toContain('group-hover:opacity-100');
    expect(chip.className).toContain('group-focus-visible:opacity-100');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- frontend/components/layout/SidebarNavItem.test.tsx`
Expected: FAIL — the chord case renders `aria-keyshortcuts="G undefined"` and
typecheck rejects `shortcutKeys`.

- [ ] **Step 3: Generalize `SidebarNavItem`**

```tsx
// frontend/components/layout/SidebarNavItem.tsx
/**
 * Sidebar nav item: icon + label + shortcut badge.
 * See docs/superpowers/design-system/sidebar-and-panels.md §4 and §6.
 *
 * `shortcutKeys` is the KbdBadge vocabulary (`'mod'` renders ⌘/Ctrl), so one
 * component carries both the project rail's `G`-sequences and the workspace
 * rail's `⌘,` chord without a second component.
 */
import React from 'react';
import type {LucideIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {cn} from '@/lib/utils';

interface SidebarNavItemProps {
  icon: LucideIcon;
  label: string;
  shortcutKeys: string[];
  shortcutVariant?: 'chord' | 'sequence';
  active: boolean;
  onClick: () => void;
}

/**
 * `aria-keyshortcuts` grammar (WAI-ARIA): a chord joins with `+` and spells the
 * modifier out (`Meta+,`); a sequence separates the steps with a space (`G A`).
 * The visible KbdBadge is `aria-hidden`, so this attribute is the only thing
 * assistive tech ever sees.
 */
function ariaKeyshortcuts(keys: string[], variant: 'chord' | 'sequence'): string {
  if (variant === 'sequence') return keys.join(' ');
  return keys.map((k) => (k === 'mod' ? 'Meta' : k)).join('+');
}

export const SidebarNavItem: React.FC<SidebarNavItemProps> = ({
  icon: Icon,
  label,
  shortcutKeys,
  shortcutVariant = 'sequence',
  active,
  onClick,
}) => (
  <Button
    variant="ghost"
    aria-current={active ? 'page' : undefined}
    aria-keyshortcuts={ariaKeyshortcuts(shortcutKeys, shortcutVariant)}
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
    <KbdBadge
      keys={shortcutKeys}
      variant={shortcutVariant}
      className="opacity-0 transition-opacity duration-75 group-hover:opacity-100 group-focus-visible:opacity-100"
    />
  </Button>
);
```

- [ ] **Step 4: Add the workspace nav config**

Append to `frontend/components/layout/sidebarConfig.ts` (and add `Folder` to
the existing `lucide-react` import):

```ts
/** Workspace-level destinations, shown when no project is open. */
export interface WorkspaceNavItem {
    id: 'hub' | 'settings';
    label: string;
    icon: LucideIcon;
    path: string;
    /** KbdBadge keys, e.g. ['G','H'] or ['mod',',']. */
    shortcutKeys: string[];
    shortcutVariant: 'chord' | 'sequence';
}

export const workspaceSectionTitle = t('layout', 'sectionWorkspace');

/**
 * `G H` is free (project shortcuts use O/C/A/T/E/Q/R) and `⌘,` is already
 * bound app-wide by useGlobalShortcuts, so the Settings chip documents an
 * existing binding rather than adding one.
 */
export const workspaceNavItems: WorkspaceNavItem[] = [
    {id: 'hub', label: t('layout', 'projects'), icon: Folder, path: '/', shortcutKeys: ['G', 'H'], shortcutVariant: 'sequence'},
    {id: 'settings', label: t('layout', 'settings'), icon: Settings, path: '/settings', shortcutKeys: ['mod', ','], shortcutVariant: 'chord'},
];
```

- [ ] **Step 5: Add the one new copy key**

In `frontend/lib/copy/layout.ts`, add below `sectionReview`:

```ts
    sectionWorkspace: 'Workspace',
```

- [ ] **Step 6: Add the brand header**

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

- [ ] **Step 7: Update the two existing `SidebarNavItem` call sites**

In `frontend/components/layout/ProjectSidebar.tsx`, change the prop passed
inside the section map (Task 4 rewrites the file wholesale; this keeps the tree
compiling in the meantime):

```tsx
                <SidebarNavItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  shortcutKeys={['G', item.shortcut]}
                  shortcutVariant="sequence"
                  active={activeTab === item.id}
                  onClick={() => onTabChange(item.id)}
                />
```

`MobileSidebar` renders raw `Button`s, not `SidebarNavItem`, so it needs no
change here.

- [ ] **Step 8: Run the tests and typecheck**

Run: `npm run test:run -- frontend/components/layout/SidebarNavItem.test.tsx && npm run typecheck`
Expected: PASS (6 tests), typecheck exit 0.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/layout/SidebarNavItem.tsx frontend/components/layout/SidebarNavItem.test.tsx \
        frontend/components/layout/SidebarBrandHeader.tsx frontend/components/layout/sidebarConfig.ts \
        frontend/components/layout/ProjectSidebar.tsx frontend/lib/copy/layout.ts
git commit -m "feat(sidebar): workspace nav config, brand header and chord-capable nav items"
```

---

### Task 4: the sidebar's two states, navigating by URL

**Files:**
- Modify: `frontend/components/layout/ProjectSidebar.tsx` (whole file)
- Modify: `frontend/components/layout/MobileSidebar.tsx` (whole file)
- Modify: `frontend/components/runs/RunWorkspaceShell.tsx:25-50`
- Modify: `frontend/test/RunWorkspaceShell.test.tsx:10-15`
- Test: `frontend/components/layout/ProjectSidebar.test.tsx`

**Interfaces:**
- Consumes: `workspaceNavItems`, `workspaceSectionTitle`, `SidebarBrandHeader`,
  `BrandMark` (Task 3).
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

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- frontend/components/layout/ProjectSidebar.test.tsx`
Expected: FAIL — `projectId` is not a prop and the required `onTabChange` is
missing.

- [ ] **Step 3: Rewrite `ProjectSidebar`**

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
 * Navigation writes the URL rather than calling a prop-drilled `onTabChange`;
 * ProjectContext already syncs `activeTab` FROM the URL during render, so it
 * follows without change (spec §3.2). `activeTab` stays a prop because the
 * full-screen run routes have no `?tab=` to derive it from.
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
import {sidebarSections, workspaceNavItems, workspaceSectionTitle} from './sidebarConfig';
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
  const location = useLocation();

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
          {projectId !== null
            ? sidebarSections.map((section) => (
                <SidebarSection key={section.title} title={section.title}>
                  {section.items.map((item) => (
                    <SidebarNavItem
                      key={item.id}
                      icon={item.icon}
                      label={item.label}
                      shortcutKeys={['G', item.shortcut]}
                      shortcutVariant="sequence"
                      active={activeTab === item.id}
                      onClick={() => navigate(`/projects/${projectId}?tab=${item.id}`)}
                    />
                  ))}
                </SidebarSection>
              ))
            : (
              <SidebarSection title={workspaceSectionTitle}>
                {workspaceNavItems.map((item) => (
                  <SidebarNavItem
                    key={item.id}
                    icon={item.icon}
                    label={item.label}
                    shortcutKeys={item.shortcutKeys}
                    shortcutVariant={item.shortcutVariant}
                    active={location.pathname === item.path}
                    onClick={() => navigate(item.path)}
                  />
                ))}
              </SidebarSection>
            )}
        </nav>
        <SidebarFooter />
      </div>
    </ResizablePanel>
  );
};
```

- [ ] **Step 4: Rewrite `MobileSidebar` to match**

```tsx
// frontend/components/layout/MobileSidebar.tsx
/**
 * Mobile sidebar (Sheet): the same two states as ProjectSidebar, no badges, no
 * resize. Navigation writes the URL and closes the drawer.
 */
import React from 'react';
import {useLocation, useNavigate} from 'react-router';
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {Button} from '@/components/ui/button';
import {SidebarSection} from './SidebarSection';
import {SidebarFooter} from './SidebarFooter';
import {BrandMark} from './SidebarBrandHeader';
import {sidebarSections, workspaceNavItems, workspaceSectionTitle} from './sidebarConfig';
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

const itemClasses = (active: boolean) =>
  cn(
    'w-full justify-start gap-2.5 h-8 px-2.5 rounded-md transition-colors duration-75',
    active ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
  );

export const MobileSidebar: React.FC<MobileSidebarProps> = ({open, onOpenChange, projectId, activeTab, projectName}) => {
  const navigate = useNavigate();
  const location = useLocation();

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
            {projectId !== null
              ? sidebarSections.map((section) => (
                  <SidebarSection key={section.title} title={section.title}>
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const active = activeTab === item.id;
                      return (
                        <Button
                          key={item.id}
                          variant="ghost"
                          onClick={() => go(`/projects/${projectId}?tab=${item.id}`)}
                          aria-current={active ? 'page' : undefined}
                          className={itemClasses(active)}
                        >
                          <Icon className={cn('h-4 w-4 shrink-0', active && 'text-foreground')} strokeWidth={1.5} />
                          <span className="text-[13px]">{item.label}</span>
                        </Button>
                      );
                    })}
                  </SidebarSection>
                ))
              : (
                <SidebarSection title={workspaceSectionTitle}>
                  {workspaceNavItems.map((item) => {
                    const Icon = item.icon;
                    const active = location.pathname === item.path;
                    return (
                      <Button
                        key={item.id}
                        variant="ghost"
                        onClick={() => go(item.path)}
                        aria-current={active ? 'page' : undefined}
                        className={itemClasses(active)}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', active && 'text-foreground')} strokeWidth={1.5} />
                        <span className="text-[13px]">{item.label}</span>
                      </Button>
                    );
                  })}
                </SidebarSection>
              )}
          </nav>

          <SidebarFooter />
        </div>
      </SheetContent>
    </Sheet>
  );
};
```

- [ ] **Step 5: Adapt `RunWorkspaceShell` to the new props**

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

- [ ] **Step 6: Update the `RunWorkspaceShell` test's sidebar mock**

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

- [ ] **Step 7: Run the tests**

Run: `npm run test:run -- frontend/components/layout/ProjectSidebar.test.tsx frontend/test/RunWorkspaceShell.test.tsx`
Expected: PASS (6 + 2 tests).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: FAIL on `frontend/components/layout/AppLayout.tsx` only — it still
passes `onTabChange`. That file is deleted in Task 6; leave it broken and
proceed (the vitest run above does not typecheck).

If any *other* file fails, fix it before committing.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/layout/ProjectSidebar.tsx frontend/components/layout/ProjectSidebar.test.tsx \
        frontend/components/layout/MobileSidebar.tsx frontend/components/runs/RunWorkspaceShell.tsx \
        frontend/test/RunWorkspaceShell.test.tsx
git commit -m "feat(sidebar): add the no-project state and invert navigation to the URL"
```

---

### Task 5: URL-driven navigation shortcuts, with `G H` for the hub

Ledger discrepancy D: `G P`'s handler closes over `useState` in `ProjectLayout`,
which never mounts on `/`, so **no** `G`-chord fires there today. Lifting the
registration into the shell fixes the whole family at once.

**Files:**
- Modify: `frontend/hooks/useNavigationShortcuts.ts` (whole file)

**Interfaces:**
- Produces: `useNavigationShortcuts({projectId, onToggleSidebar, onOpenProjectSwitcher}): void`.
  Consumed by Task 6 (`AppShell`).

- [ ] **Step 1: Rewrite the hook**

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

- [ ] **Step 2: Verify the letters do not collide**

Run: `grep -n "shortcut:" frontend/components/layout/sidebarConfig.ts`
Expected: `O`, `C`, `A`, `T`, `E`, `Q`, `R` — `H` and `P` are free.

- [ ] **Step 3: Run the suite for the shortcut surface**

Run: `npm run test:run -- frontend/test/RunWorkspaceShell.test.tsx`
Expected: PASS — `RunWorkspaceShell` registers its own `⌘B` binding and does
not use this hook, so it must be unaffected.

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/useNavigationShortcuts.ts
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

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- frontend/test/appShell.routes.test.tsx`
Expected: FAIL — no `navigation` landmark named "Breadcrumb"; two "Prumo"
nodes; no toggle on `/`.

- [ ] **Step 3: Add the breadcrumb copy key and delete the orphaned brand key**

In `frontend/lib/copy/navigation.ts`, add next to `topbarBrandFull`:

```ts
    breadcrumbAria: 'Breadcrumb',
```

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

export const AppBreadcrumb: React.FC = () => {
  const {projectId, activeSection} = useShellLocation();
  const location = useLocation();
  const {data: projects} = useProjectsQuery();

  const project = projectId === null ? undefined : projects?.find((p) => p.id === projectId);
  const descriptionKey = activeSection === null ? undefined : sectionDescriptionKey[activeSection];

  const root = projectId !== null
    ? project?.name
    : location.pathname === '/settings'
      ? t('layout', 'settings')
      : t('layout', 'projects');

  return (
    <nav
      aria-label={t('navigation', 'breadcrumbAria')}
      className="flex min-w-0 items-center gap-1.5 px-2"
    >
      {root === undefined ? (
        // Project route whose name has not resolved yet: the same skeleton the
        // Topbar already uses for its loading state, so the bar does not jump.
        <span className="h-[13px] w-24 animate-pulse rounded bg-muted" aria-hidden="true" />
      ) : (
        <TruncatedText className="text-header-title font-medium text-foreground" text={root} />
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

Run: `npm run test:run -- frontend/test/appShell.routes.test.tsx frontend/components/navigation/SectionViewSwitcher.test.tsx`
Expected: PASS (10 + 5 tests).

- [ ] **Step 9: Full suite, typecheck, lint, dead code**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run deadcode && npm run deadcode:production`
Expected: exit 0 on all five.

- [ ] **Step 10: Commit**

```bash
git add frontend/components/navigation/Breadcrumb.tsx frontend/components/navigation/Topbar.tsx \
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

**Interfaces:**
- Consumes: nothing new. Uses the seven already-defined-but-baselined `user.*`
  keys (`tabProfile`, `tabProfileDesc`, `tabSecurity`, `tabSecurityDesc`,
  `tabIntegrations`, `tabIntegrationsDesc`, `settingsAriaSections`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite the page**

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

- [ ] **Step 2: Confirm the copy gate now reports seven tightenable keys**

Run: `python3 scripts/fitness/check_copy_keys.py`
Expected: exit 0, with `tabProfile`, `tabProfileDesc`, `tabSecurity`,
`tabSecurityDesc`, `tabIntegrations`, `tabIntegrationsDesc` and
`settingsAriaSections` listed as tightenable baseline entries.

- [ ] **Step 3: Tighten the baseline**

Run: `python3 scripts/fitness/check_copy_keys.py --update-baseline`
Then: `git diff --stat scripts/fitness/check_copy_keys.baseline`
Expected: 7 lines removed, 0 added. If any line is ADDED, stop — a key went
dead and must be deleted from its namespace instead of baselined.

- [ ] **Step 4: Run the suite and the gates**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: exit 0 on all three.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/UserSettings.tsx scripts/fitness/check_copy_keys.baseline
git commit -m "feat(settings): fold /settings into the shell and restyle its rail as inset sub-nav"
```

---

# SLICE 2 — hub management

### Task 9: widen the list read and add the archive write

**Files:**
- Modify: `frontend/types/project.ts:86-89`
- Modify: `frontend/services/projectsService.ts` (list select + new writer)
- Modify: `frontend/hooks/useProjectsQuery.ts`
- Test: `frontend/test/services/projectsService.test.ts`

**Interfaces:**
- Produces:
  - `ProjectListItem` gains `updated_at: string` and `project_members: {role: MemberRole}[]`.
  - `isProjectManager(project: ProjectListItem): boolean` from `@/types/project`.
  - `listProjectsForDashboard(userId: string): Promise<ErrorResult<ProjectListItem[]>>`.
  - `setProjectArchived(projectId: string, archived: boolean): Promise<ErrorResult<{updated: boolean}>>`.
- Consumed by Tasks 11 and 12.

- [ ] **Step 1: Write the failing tests**

Replace `frontend/test/services/projectsService.test.ts` with:

```ts
// frontend/test/services/projectsService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({supabase: {from: vi.fn()}}));

import {supabase} from '@/integrations/supabase/client';
import {listProjectsForDashboard, setProjectArchived} from '@/services/projectsService';

function readChain(payload: {data: unknown; error?: {message: string} | null}) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.order = vi.fn(async () => ({data: payload.data, error: payload.error ?? null}));
  return c;
}

function writeChain(payload: {data: unknown; error?: {message: string} | null}) {
  const c: Record<string, unknown> = {};
  c.update = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.select = vi.fn(async () => ({data: payload.data, error: payload.error ?? null}));
  return c;
}

describe('projectsService.listProjectsForDashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('selects updated_at and the caller-scoped membership row', async () => {
    const rows = [{id: 'p1', project_members: [{role: 'manager'}]}];
    const c = readChain({data: rows});
    vi.mocked(supabase.from).mockReturnValue(c as never);

    const result = await listProjectsForDashboard('u1');

    expect(supabase.from).toHaveBeenCalledWith('projects');
    expect(c.select).toHaveBeenCalledWith(
      'id, name, description, created_at, updated_at, is_active, review_title, project_members(role)',
    );
    // The embed is narrowed to the caller's own row, so a manager check reads
    // the caller's role and not some other member's.
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

describe('projectsService.setProjectArchived', () => {
  beforeEach(() => vi.clearAllMocks());

  it('archives with .select() so an RLS-rejected write is observable', async () => {
    const c = writeChain({data: [{id: 'p1'}]});
    vi.mocked(supabase.from).mockReturnValue(c as never);

    const result = await setProjectArchived('p1', true);

    expect(c.update).toHaveBeenCalledWith({is_active: false});
    expect(c.eq).toHaveBeenCalledWith('id', 'p1');
    // Load-bearing: without .select(), PostgREST reports success having
    // changed nothing when RLS rejects the row (spec §6.1).
    expect(c.select).toHaveBeenCalled();
    expect(result).toEqual({ok: true, data: {updated: true}});
  });

  it('restores by writing is_active true', async () => {
    const c = writeChain({data: [{id: 'p1'}]});
    vi.mocked(supabase.from).mockReturnValue(c as never);

    await setProjectArchived('p1', false);

    expect(c.update).toHaveBeenCalledWith({is_active: true});
  });

  it('reports updated:false when RLS returns zero rows', async () => {
    vi.mocked(supabase.from).mockReturnValue(writeChain({data: []}) as never);
    expect(await setProjectArchived('p1', true)).toEqual({ok: true, data: {updated: false}});
  });

  it('returns ok:false (never throws) on a supabase error', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      writeChain({data: null, error: {message: 'boom'}}) as never,
    );
    const result = await setProjectArchived('p1', true);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- frontend/test/services/projectsService.test.ts`
Expected: FAIL — `setProjectArchived` is not exported and the `select` string
assertion does not match.

- [ ] **Step 3: Widen the type**

In `frontend/types/project.ts`, replace the `ProjectListItem` block:

```ts
/**
 * Lean type for project lists.
 *
 * `project_members` is the caller's OWN membership row, embedded by
 * `listProjectsForDashboard` and narrowed with `.eq('project_members.user_id',
 * …)`. It gates the Archive/Restore affordance; it is not the security
 * boundary — `baseline_v1.sql` policy `project_update` already restricts the
 * write to managers, and the mutation still treats a zero-row result as an
 * error (spec §6.1).
 */
export type ProjectListItem = Pick<
    Project,
    'id' | 'name' | 'description' | 'created_at' | 'updated_at' | 'is_active' | 'review_title'
> & {
    project_members: { role: MemberRole }[];
};

/** True when the caller manages this project (embedded membership row). */
export function isProjectManager(project: ProjectListItem): boolean {
    return project.project_members.some((member) => member.role === 'manager');
}
```

- [ ] **Step 4: Widen the read and add the write**

In `frontend/services/projectsService.ts`, replace `listProjectsForDashboard`
and append the writer. Keep `supabase` and `.from(` on separate lines —
`check_frontend_data_path.py` matches them only when they share a line.

```ts
// ---------------------------------------------------------------------------
// Hub: list projects (typed columns + the caller's own membership row)
// ---------------------------------------------------------------------------

const PROJECT_LIST_SELECT =
  'id, name, description, created_at, updated_at, is_active, review_title, project_members(role)';

/**
 * `updated_at` is maintained by the `trg_projects_updated_at` BEFORE UPDATE
 * trigger, so it is real for PostgREST writes too — the `Updated <relative>`
 * row metadata and the default sort both rest on that (spec §6.2).
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
    return (data ?? []) as unknown as ProjectListItem[];
  }, 'projectsService.listProjectsForDashboard');
}

// ---------------------------------------------------------------------------
// Hub: archive / restore
// ---------------------------------------------------------------------------

export interface SetProjectArchivedResult {
  /** True when at least one row was written (RLS returned data). */
  updated: boolean;
}

/**
 * Archive (`is_active = false`) or restore a project.
 *
 * `.select()` is load-bearing: a PostgREST update without it returns success
 * having changed nothing when RLS rejects the row, and `project_update` is
 * manager-only. `deleteProject` in projectSettingsService is the same shape.
 *
 * NOTE: toast messages are handled by the caller.
 */
export function setProjectArchived(
  projectId: string,
  archived: boolean,
): Promise<ErrorResult<SetProjectArchivedResult>> {
  return toResult(async () => {
    const {data, error} = await supabase
      .from('projects')
      .update({is_active: !archived})
      .eq('id', projectId)
      .select();
    if (error) throw error;
    return {updated: Boolean(data && data.length > 0)};
  }, 'projectsService.setProjectArchived');
}
```

- [ ] **Step 5: Thread the user id through the query hook**

In `frontend/hooks/useProjectsQuery.ts`:

```ts
import {useAuth} from '@/contexts/AuthContext';
```

```ts
export function useProjectsQuery(): UseQueryResult<ProjectListItem[], Error> {
  const {user} = useAuth();
  const userId = user?.id ?? '';
  return useQuery<ProjectListItem[], Error>({
    queryKey: projectKeys.all,
    queryFn: async () => {
      const result = await listProjectsForDashboard(userId);
      if (!result.ok) throw result.error;
      return result.data;
    },
    enabled: userId !== '',
    staleTime: 30_000,
  });
}
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:run -- frontend/test/services/projectsService.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Full suite and gates**

Run: `npm run test:run && npm run typecheck && python3 scripts/fitness/check_frontend_data_path.py`
Expected: exit 0. The data-path check must report **no new violations** — if it
does, a `supabase.from(` was collapsed onto one line; split it again.

- [ ] **Step 8: Commit**

```bash
git add frontend/types/project.ts frontend/services/projectsService.ts \
        frontend/hooks/useProjectsQuery.ts frontend/test/services/projectsService.test.ts
git commit -m "feat(projects): carry updated_at and the caller's role, and add archive/restore"
```

---

### Task 10: relative time

There is no relative-time formatter in the repo and no `date-fns`. The four
`common.time*` keys already exist and are currently baselined as dead; this
task makes them live and tightens the baseline.

**Files:**
- Create: `frontend/lib/relative-time.ts`
- Create: `frontend/test/relativeTime.test.ts`
- Modify: `scripts/fitness/check_copy_keys.baseline`

**Interfaces:**
- Produces: `relativeTime(iso: string, now?: number): string`. Consumed by Task 11.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/test/relativeTime.test.ts
/**
 * `now` is injected so the boundaries are asserted exactly rather than raced
 * against the wall clock.
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
    expect(relativeTime(iso(30 * DAY), NOW)).toBe('8/8/2026');
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

### Task 11: the hub row and the archive mutation

**Files:**
- Create: `frontend/components/project/ProjectRow.tsx`
- Create: `frontend/hooks/useArchiveProject.ts`
- Create: `frontend/test/hooks/useArchiveProject.test.tsx`
- Modify: `frontend/lib/copy/pages.ts`

**Interfaces:**
- Consumes: `ProjectListItem` + `isProjectManager` (Task 9), `relativeTime`
  (Task 10), `setProjectArchived` (Task 9).
- Produces:
  - `useArchiveProject(): UseMutationResult<{updated: boolean}, Error, {projectId: string; archived: boolean}>`.
  - `ProjectRow: React.FC<{project: ProjectListItem; onArchivedChange: (projectId: string, archived: boolean) => void}>`.
- Consumed by Task 12.

- [ ] **Step 1: Add the copy keys**

In `frontend/lib/copy/pages.ts`, delete `dashboardNoDescription` (the "No
additional description" filler is removed — spec §5) and add, next to the other
`dashboard*` keys:

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
 * Spec §6.1: `project_update` is manager-only in RLS, so a reviewer or viewer
 * who reaches the write gets a 0-row success from PostgREST. The manager gate
 * in the UI is an affordance, not the security boundary — the hook must treat
 * a zero-row result as an error regardless.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const setProjectArchived = vi.fn();
vi.mock('@/services/projectsService', () => ({
  setProjectArchived: (...args: unknown[]) => setProjectArchived(...args),
}));

import {useArchiveProject} from '@/hooks/useArchiveProject';
import {projectKeys} from '@/lib/query-keys';

function harness() {
  const queryClient = new QueryClient({defaultOptions: {mutations: {retry: false}}});
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const {result} = renderHook(() => useArchiveProject(), {
    wrapper: ({children}) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
  return {result, invalidate};
}

describe('useArchiveProject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('succeeds and invalidates the project family when a row was written', async () => {
    setProjectArchived.mockResolvedValue({ok: true, data: {updated: true}});
    const {result, invalidate} = harness();

    result.current.mutate({projectId: 'p1', archived: true});

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(setProjectArchived).toHaveBeenCalledWith('p1', true);
    expect(invalidate).toHaveBeenCalledWith({queryKey: projectKeys.all});
  });

  it('surfaces a zero-row update as an error, not a silent success', async () => {
    setProjectArchived.mockResolvedValue({ok: true, data: {updated: false}});
    const {result, invalidate} = harness();

    result.current.mutate({projectId: 'p1', archived: true});

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('You do not have permission to change this project');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('surfaces a service error', async () => {
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

- [ ] **Step 4: Write the mutation hook**

```ts
// frontend/hooks/useArchiveProject.ts
/**
 * Archive / restore a project.
 *
 * A zero-row PostgREST update is an ERROR here, not a success: `project_update`
 * is manager-only in RLS, so a reviewer or viewer who reaches the write gets a
 * 200 with no rows. The manager-gated menu item is an affordance; this is the
 * check that actually holds (spec §6.1).
 *
 * On success the whole `projectKeys.all` family is invalidated, which is the
 * one cache entry the hub list, the sidebar switcher and the shell breadcrumb
 * all read.
 */
import {useMutation, useQueryClient, type UseMutationResult} from '@tanstack/react-query';
import {setProjectArchived, type SetProjectArchivedResult} from '@/services/projectsService';
import {projectKeys} from '@/lib/query-keys';
import {t} from '@/lib/copy';

export interface ArchiveProjectVariables {
  projectId: string;
  archived: boolean;
}

export function useArchiveProject(): UseMutationResult<
  SetProjectArchivedResult,
  Error,
  ArchiveProjectVariables
> {
  const queryClient = useQueryClient();

  return useMutation<SetProjectArchivedResult, Error, ArchiveProjectVariables>({
    mutationFn: async ({projectId, archived}) => {
      const result = await setProjectArchived(projectId, archived);
      if (!result.ok) throw result.error;
      if (!result.data.updated) throw new Error(t('pages', 'dashboardArchiveDenied'));
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: projectKeys.all});
    },
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- frontend/test/hooks/useArchiveProject.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Extract the row**

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
  onArchivedChange: (projectId: string, archived: boolean) => void;
}

export const ProjectRow: React.FC<ProjectRowProps> = ({project, onArchivedChange}) => {
  const canManage = isProjectManager(project);
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

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: FAIL only in `frontend/pages/Dashboard.tsx` — it still renders the
inline row and reads the deleted `dashboardNoDescription` key. Task 12 replaces
that block; every other file must be clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/project/ProjectRow.tsx frontend/hooks/useArchiveProject.ts \
        frontend/test/hooks/useArchiveProject.test.tsx frontend/lib/copy/pages.ts
git commit -m "feat(hub): extract the project row and add a zero-row-safe archive mutation"
```

---

### Task 12: hub header — search, status filter, sort, three empty states

**Files:**
- Modify: `frontend/pages/Dashboard.tsx` (whole file)
- Modify: `frontend/lib/copy/pages.ts`
- Modify: `scripts/fitness/check_button_scale.baseline`
- Test: `frontend/test/Dashboard.hub.test.tsx`

**Interfaces:**
- Consumes: `useProjectsQuery` (Task 2/9), `useArchiveProject` + `ProjectRow`
  (Task 11), `ListToolbarSearch` / `ListDisplaySortPopover` / `EmptyListState`
  (`@/components/shared/list`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the remaining copy keys**

In `frontend/lib/copy/pages.ts`, add:

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
    project_members: [{role: 'manager'}],
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
    renderHub([project({project_members: [{role: 'reviewer'}]})]);
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
import {useProjectsQuery} from "@/hooks/useProjectsQuery";
import {useArchiveProject} from "@/hooks/useArchiveProject";
import type {ProjectListItem} from "@/types/project";
import {t} from '@/lib/copy';
import {projectKeys} from '@/lib/query-keys';
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
    await queryClient.invalidateQueries({queryKey: projectKeys.all});
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
          <ProjectRow key={project.id} project={project} onArchivedChange={handleArchivedChange}/>
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
Expected: PASS (10 tests).

- [ ] **Step 6: Tighten the button-scale baseline**

Run: `python3 scripts/fitness/check_button_scale.py --update-baseline`
Then: `git diff scripts/fitness/check_button_scale.baseline`
Expected: the `frontend/pages/Dashboard.tsx:2` line removed. If a line is
ADDED anywhere, a new height override slipped in — remove it instead.

- [ ] **Step 7: Full suite and every gate**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run deadcode && npm run deadcode:production && bash scripts/fitness/run_all.sh`
Expected: exit 0 on all six.

- [ ] **Step 8: Commit**

```bash
git add frontend/pages/Dashboard.tsx frontend/lib/copy/pages.ts \
        frontend/test/Dashboard.hub.test.tsx scripts/fitness/check_button_scale.baseline
git commit -m "feat(hub): add search, status filter, sort and three distinct empty states"
```

---

### Task 13: E2E, visual verification, final gates

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
    await expect(
      page.getByTestId("app-shell").getByText("Project not found"),
    ).toBeVisible({ timeout: 10000 });
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

- [ ] **Step 4: Run the full gate**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run deadcode && npm run deadcode:production && bash scripts/fitness/run_all.sh`
Expected: exit 0 on all six. Read the output — do not assert from memory
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
| §3.2 navigation inverts to URL-driven | 4, 5, 7 |
| §3.3 run routes stay on `RunWorkspaceShell` | 4 (prop swap only), 6 (routes untouched) |
| §4 sidebar, two states, 280/240/400/150, footer constant | 3, 4 |
| §4.1 `G H` free; workspace bindings everywhere, project bindings gated | 5 |
| §5 hub header (title dropped per ledger), row subtractions, sort, 3 empty states | 11, 12 |
| §6.1 archive reuses `is_active`; `.select()`; zero-row-as-error; manager-gated affordance; embedded member row | 9, 11 |
| §6.2 `updated_at` is trigger-maintained; reads stay on PostgREST | 9, 10 |
| §7 deferred pin slice | Untouched by design — the row's metadata slot and the sidebar's section list are the only seams it needs, and both survive. |
| §8 testing | 1, 3, 4, 6, 7, 9, 10, 11, 12, 13 |
| Ledger 14:50Z top bar | 7 |
| Ledger 14:45Z settings rail | 8 |
| Ledger 14:33Z `useProjectsList` on TanStack | 2 (moved into slice 1 — `AppShell` needs the cache entry for the breadcrumb) |
| Ledger 14:33Z `isProjectPage` → `useLocation()` | 7 (via `useShellLocation`, which wraps `useLocation`) |
| Ledger 14:33Z spec SQL anchors | 13 |
| Ledger discrepancy C `SectionViewSwitcher` | 7 — the ledger says the switcher is "unchanged"; it is unchanged *visually* and its testid does not move, but it reads `ProjectContext` directly and would render **null** once the bar sits above `ProjectProvider`. Its data source must change. Called out in the report. |
| Ledger discrepancy F row `aria-label` | 11 — removed entirely by the stretched-link pattern. |
| Ledger discrepancy K settings hardcoded strings | 8 — the seven keys already exist and are baselined; the title/back strings are deleted with their controls. |

No spec requirement is left without a task. **§7 (the deferred pin slice) is
deliberately not built** — the spec places it in a later slice.

**2. Placeholder scan** — no `TBD`, no "similar to Task N", no "add error
handling"; every code step carries the literal code, and every test step the
literal test. The one non-code step is Task 13's design-review loop, which is
routed there precisely because jsdom cannot assert it.

**3. Type consistency** — checked across tasks:
`useShellLocation(): {projectId: string | null; activeSection: SidebarTabId | null}`
is consumed with that exact shape in Tasks 6, 7. `ProjectSidebar` /
`MobileSidebar` take `projectId: string | null` in Tasks 4, 6 and
`RunWorkspaceShell` passes a `string` (assignable). `SidebarNavItem` takes
`shortcutKeys: string[]` + `shortcutVariant` in Tasks 3, 4.
`useProjectsQuery(): UseQueryResult<ProjectListItem[], Error>` is destructured
as `{data, isLoading, isError, refetch}` in Tasks 2, 6, 7, 12.
`setProjectArchived(projectId, archived) → {updated: boolean}` matches
`useArchiveProject`'s `mutationFn` in Task 11 and its test.
`isProjectManager(project)` is defined in Task 9 and used in Task 11.
`relativeTime(iso, now?)` is defined in Task 10 and used in Task 11.
