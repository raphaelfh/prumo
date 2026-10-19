/**
 * TanStack hooks for the project's AI agents policy. The PUT answers with the
 * stored row, written onto the read key at once and then invalidated, so the
 * group renders what the server kept, never what was typed.
 */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {projectKeys} from '@/lib/query-keys';
import {
  fetchAiPolicy,
  updateAiPolicy,
  type AiPolicyRead,
  type AiPolicyUpdateRequest,
} from '@/services/aiPolicyService';

export function useAiPolicy(projectId: string) {
  return useQuery({
    queryKey: projectKeys.aiPolicy(projectId),
    queryFn: async (): Promise<AiPolicyRead> => {
      const result = await fetchAiPolicy(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

export function useUpdateAiPolicy(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<AiPolicyRead, Error, AiPolicyUpdateRequest>({
    mutationFn: async (body) => {
      const result = await updateAiPolicy(projectId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(projectKeys.aiPolicy(projectId), data);
      void queryClient.invalidateQueries({queryKey: projectKeys.aiPolicy(projectId)});
    },
  });
}
