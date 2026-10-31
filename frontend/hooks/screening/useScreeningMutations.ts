/**
 * The two screening writes. A decision removes the record from the cached
 * queue at once (optimistic advance), restores the snapshot on failure, and on
 * settle refetches the whole screening family and the record. A ruling settles
 * the same way: a stale or no-longer-in-conflict 409 reloads the lists the
 * same way a success does. Counts and outcomes are server-computed, never
 * patched beyond the advance.
 */
import {useMutation, useQueryClient} from '@tanstack/react-query';

import {screeningKeys} from '@/lib/query-keys/screening';
import {
  submitArbitration,
  submitDecision,
  type ScreeningArbitrationCreate,
  type ScreeningAssignmentRead,
  type ScreeningDecisionCreate,
  type ScreeningQueueRead,
} from '@/services/screeningService';

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

interface ArbitrateVariables {
  assignmentId: string;
  body: ScreeningArbitrationCreate;
}

export function useArbitrate(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<ScreeningAssignmentRead, Error, ArbitrateVariables>({
    mutationFn: async ({assignmentId, body}) => {
      const result = await submitArbitration(assignmentId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSettled: (_data, _error, {assignmentId}) => {
      void queryClient.invalidateQueries({queryKey: screeningKeys.project(projectId)});
      void queryClient.invalidateQueries({queryKey: screeningKeys.assignment(assignmentId)});
    },
  });
}
