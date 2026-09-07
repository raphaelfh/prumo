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
