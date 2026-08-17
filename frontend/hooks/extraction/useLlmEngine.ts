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
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: projectKeys.llmEngine(projectId),
      });
    },
  });
}
