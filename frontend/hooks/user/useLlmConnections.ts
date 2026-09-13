/** TanStack reads and user-scope mutations for the viewer's connections and the registry (§4). */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {meKeys, projectKeys} from '@/lib/query-keys';
import {
  createMyConnection,
  deleteMyConnection,
  fetchMyConnections,
  fetchProviders,
  verifyMyConnection,
  type LlmConnectionDeleteResult,
  type LlmConnectionRead,
  type LlmConnectionVerifyResult,
  type ProviderRead,
  type UserConnectionCreateRequest,
} from '@/services/llmConnectionsService';

const STALE_MS = 5 * 60_000;

export function useMyConnections() {
  return useQuery({
    queryKey: meKeys.connections(),
    staleTime: STALE_MS,
    queryFn: async (): Promise<LlmConnectionRead[]> => {
      const result = await fetchMyConnections();
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

export function useProviders() {
  return useQuery({
    queryKey: meKeys.providers(),
    staleTime: STALE_MS,
    queryFn: async (): Promise<ProviderRead[]> => {
      const result = await fetchProviders();
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

function useInvalidateMine() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({queryKey: meKeys.connections()});
    // A new or removed credential changes every project's `availability`.
    void queryClient.invalidateQueries({queryKey: projectKeys.llmEngines()});
  };
}

export function useCreateMyConnection() {
  const invalidate = useInvalidateMine();
  return useMutation<LlmConnectionRead, Error, UserConnectionCreateRequest>({
    mutationFn: async (body) => {
      const result = await createMyConnection(body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteMyConnection() {
  const invalidate = useInvalidateMine();
  return useMutation<LlmConnectionDeleteResult, Error, string>({
    mutationFn: async (id) => {
      const result = await deleteMyConnection(id);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useVerifyMyConnection() {
  const invalidate = useInvalidateMine();
  return useMutation<LlmConnectionVerifyResult, Error, string>({
    mutationFn: async (id) => {
      const result = await verifyMyConnection(id);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}
