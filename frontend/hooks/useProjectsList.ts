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
