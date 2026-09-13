/** The project's shared keys (§4) — manager-gated on the API, so callers
 * pass `null` for a non-manager and the query stays disabled. */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {projectKeys} from '@/lib/query-keys';
import {
  createProjectConnection,
  deleteProjectConnection,
  fetchProjectConnections,
  type LlmConnectionDeleteResult,
  type LlmConnectionRead,
  type ProjectConnectionCreateRequest,
} from '@/services/llmConnectionsService';

const STALE_MS = 5 * 60_000;

export function useProjectConnections(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKeys.connections(projectId ?? ''),
    enabled: Boolean(projectId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<LlmConnectionRead[]> => {
      const result = await fetchProjectConnections(projectId!);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

function useInvalidateProject(projectId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({queryKey: projectKeys.connections(projectId)});
    // A shared key changes every member's `availability` on this project's engine read.
    void queryClient.invalidateQueries({queryKey: projectKeys.llmEngine(projectId)});
  };
}

export function useCreateProjectConnection(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation<LlmConnectionRead, Error, ProjectConnectionCreateRequest>({
    mutationFn: async (body) => {
      const result = await createProjectConnection(projectId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteProjectConnection(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation<LlmConnectionDeleteResult, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteProjectConnection(projectId, id);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}
