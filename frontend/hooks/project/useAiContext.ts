/**
 * TanStack hooks for the project's AI review question.
 *
 * The mutation response IS the fresh server read (rendered from what was
 * stored, not echoed from the request), so it is written onto the read key
 * synchronously — a back-to-back save then never computes from a pre-PUT
 * cache while the refetch is still in flight.
 *
 * `expected_revision` rides the body unchanged: a 409 STALE_VALUE reaches the
 * caller as the `ApiError` and invalidates nothing, so the read only moves
 * when the editor asks for it (Reload). A successful save also refreshes the
 * run reads: their drift chip compares the run's pinned protocol revision
 * with the project's current one.
 */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {runsKeys} from '@/hooks/runs/types';
import {projectKeys} from '@/lib/query-keys';
import {
  fetchAiContext,
  setAiContext,
  type ProjectAiContextRead,
  type ProjectAiContextUpdate,
} from '@/services/aiContextService';

const STALE_MS = 5 * 60_000;

export function useAiContext(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKeys.aiContext(projectId ?? ''),
    enabled: Boolean(projectId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<ProjectAiContextRead> => {
      const result = await fetchAiContext(projectId!);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

export function useSetAiContext(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<ProjectAiContextRead, Error, ProjectAiContextUpdate>({
    mutationFn: async (body) => {
      const result = await setAiContext(projectId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(projectKeys.aiContext(projectId), data);
      void queryClient.invalidateQueries({
        queryKey: projectKeys.aiContext(projectId),
      });
      void queryClient.invalidateQueries({queryKey: runsKeys.all});
    },
  });
}
