/**
 * The reviewer's queue and the decision that advances it. A decision removes
 * the record from the cached queue at once (optimistic advance), restores the
 * snapshot on failure, and on settle refetches the whole screening family and
 * the record: counts and outcomes are server-computed, never patched beyond
 * the advance.
 */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {screeningKeys} from '@/lib/query-keys/screening';
import {
  fetchScreeningQueue,
  submitDecision,
  type ScreeningAssignmentRead,
  type ScreeningDecisionCreate,
  type ScreeningQueueRead,
} from '@/services/screeningService';

export function useScreeningQueue(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: screeningKeys.queue(projectId),
    enabled: enabled && Boolean(projectId),
    // No article writer (Zotero/RIS import, manual create, delete) invalidates
    // the screening keys: under the app's 5-minute staleTime a remount would
    // otherwise keep a deleted article or miss a newly imported one.
    refetchOnMount: 'always',
    queryFn: async (): Promise<ScreeningQueueRead> => {
      const result = await fetchScreeningQueue(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

interface DecideVariables {
  assignmentId: string;
  body: ScreeningDecisionCreate;
}

export function useDecide(projectId: string) {
  const queryClient = useQueryClient();
  const queueKey = screeningKeys.queue(projectId);
  return useMutation<ScreeningAssignmentRead, Error, DecideVariables, {previous?: ScreeningQueueRead}>({
    mutationFn: async ({assignmentId, body}) => {
      const result = await submitDecision(assignmentId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onMutate: async ({assignmentId}) => {
      await queryClient.cancelQueries({queryKey: queueKey});
      const previous = queryClient.getQueryData<ScreeningQueueRead>(queueKey);
      if (previous?.items.some((i) => i.assignment_id === assignmentId)) {
        queryClient.setQueryData<ScreeningQueueRead>(queueKey, {
          ...previous,
          items: previous.items.filter((i) => i.assignment_id !== assignmentId),
          awaiting_me: Math.max(0, previous.awaiting_me - 1),
        });
      }
      return {previous};
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queueKey, context.previous);
    },
    onSettled: (_data, _error, {assignmentId}) => {
      void queryClient.invalidateQueries({queryKey: screeningKeys.project(projectId)});
      void queryClient.invalidateQueries({queryKey: screeningKeys.assignment(assignmentId)});
    },
  });
}
