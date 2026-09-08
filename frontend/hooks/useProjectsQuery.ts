/**
 * The ONE project-list read.
 *
 * The hub, the sidebar project switcher and the shell breadcrumb all resolve
 * from this single cache entry, so a mutation that invalidates it refreshes
 * every one of them. Before this hook the switcher held a second, uncached
 * `select('*')` read that no invalidation reached — archiving a project would
 * refresh the hub and leave the switcher listing it (ledger 2026-09-07T14:33Z).
 *
 * The key carries the caller's id. That is no longer what stands between
 * user A's projects and user B — AuthContext drops the whole cache when the
 * signed-in account changes, because a per-key fix does not generalise to the
 * families whose keys carry no identity. It stays as the second line: the two
 * accounts land in separate entries rather than overwriting one, and the id
 * is already in hand. `projectsListKey` is exported because every
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
