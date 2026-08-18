/**
 * TanStack hooks for the per-project LLM engine (§5, C1b).
 *
 * `useLlmEngine` reads the resolved engine view the ⚙ chip renders; an
 * ErrorResult from the service becomes the query's error state, which the
 * chip maps to "render nothing" (deploy-race window where new-FE hits an
 * old-BE without the route). `useSetLlmEngine` persists a catalogue pair
 * and invalidates the owning key family.
 */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {projectKeys} from '@/lib/query-keys';
import {
  fetchLlmEngine,
  setLlmEngine,
  type LlmEngineRead,
  type LlmEngineUpdateRequest,
} from '@/services/llmEngineService';

const STALE_MS = 5 * 60_000;

export function useLlmEngine(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKeys.llmEngine(projectId ?? ''),
    enabled: Boolean(projectId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<LlmEngineRead> => {
      const result = await fetchLlmEngine(projectId!);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

export function useSetLlmEngine(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<LlmEngineRead, Error, LlmEngineUpdateRequest>({
    mutationFn: async (body) => {
      const result = await setLlmEngine(projectId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: (data) => {
      // The mutation's response IS the fresh normalized read: write it on
      // the read hook's key synchronously, so a back-to-back mutation never
      // computes its next alternates list from the pre-PUT cache while the
      // refetch is still in flight (lost-update race). The invalidation
      // stays — it reconciles with the server for everything else.
      queryClient.setQueryData(projectKeys.llmEngine(projectId), data);
      void queryClient.invalidateQueries({
        queryKey: projectKeys.llmEngine(projectId),
      });
    },
  });
}
