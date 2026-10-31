/**
 * The two screening writes. Each settles by refetching the whole screening
 * family and the record: a decision, a ruling, or a stale / no-longer-in-
 * conflict 409 all reload the same way. Counts, statuses and outcomes are
 * server-computed, so they are refetched, never patched.
 */
import {useMutation, useQueryClient} from '@tanstack/react-query';

import {screeningKeys} from '@/lib/query-keys/screening';
import {
  submitArbitration,
  submitDecision,
  type ScreeningArbitrationCreate,
  type ScreeningAssignmentRead,
  type ScreeningDecisionCreate,
} from '@/services/screeningService';

interface DecideVariables {
  assignmentId: string;
  body: ScreeningDecisionCreate;
}

export function useDecide(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<ScreeningAssignmentRead, Error, DecideVariables>({
    mutationFn: async ({assignmentId, body}) => {
      const result = await submitDecision(assignmentId, body);
      if (!result.ok) throw result.error;
      return result.data;
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
