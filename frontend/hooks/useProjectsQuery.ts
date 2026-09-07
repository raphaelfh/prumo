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
      const result = await listProjectsForDashboard(userId);
      if (!result.ok) throw result.error;
      return result.data;
    },
    // Never fetch — and never cache — under an empty identity.
    enabled: userId !== '',
    staleTime: 30_000,
  });
}
