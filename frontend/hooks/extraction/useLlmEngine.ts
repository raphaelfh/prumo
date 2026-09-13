/** TanStack hooks for the project engine read and the viewer's own row (§4). */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {projectKeys} from '@/lib/query-keys';
import {
  clearMyEngine,
  fetchLlmEngine,
  setMyEngine,
  type LlmEngineRead,
  type UserEngineClearResult,
  type UserEngineUpdateRequest,
} from '@/services/llmEngineService';

const STALE_MS = 5 * 60_000;

export function useLlmEngine(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKeys.llmEngine(projectId ?? ''),
    enabled: Boolean(projectId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<LlmEngineRead> => {
      const result = await fetchLlmEngine(projectId ?? '');
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

export function useSetMyEngine(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<LlmEngineRead, Error, UserEngineUpdateRequest>({
    mutationFn: async (body) => {
      const result = await setMyEngine(projectId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: (data) => {
      // The response IS the fresh read: land it synchronously, then reconcile.
      queryClient.setQueryData(projectKeys.llmEngine(projectId), data);
      void queryClient.invalidateQueries({queryKey: projectKeys.llmEngine(projectId)});
    },
  });
}

/** Drops the viewer's own row: the next run follows the project default. */
export function useClearMyEngine(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<UserEngineClearResult, Error, void>({
    mutationFn: async () => {
      const result = await clearMyEngine(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: () => void queryClient.invalidateQueries({queryKey: projectKeys.llmEngine(projectId)}),
  });
}
