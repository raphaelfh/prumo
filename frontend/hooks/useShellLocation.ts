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
