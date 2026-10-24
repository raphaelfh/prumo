/**
 * The arbitrator's conflicts list and the ruling that clears one. A ruling
 * settles by refetching the whole screening family and the record: a stale or
 * no-longer-in-conflict 409 reloads the list the same way a success does.
 */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {screeningKeys} from '@/lib/query-keys/screening';
import {
  fetchConflicts,
  submitArbitration,
  type ScreeningArbitrationCreate,
  type ScreeningAssignmentRead,
  type ScreeningConflictsRead,
} from '@/services/screeningService';

export function useScreeningConflicts(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: screeningKeys.conflicts(projectId),
    enabled: enabled && Boolean(projectId),
    // No article writer (Zotero/RIS import, manual create, delete) invalidates
    // the screening keys: under the app's 5-minute staleTime a remount would
    // otherwise keep a deleted article or miss a newly arrived conflict.
    refetchOnMount: 'always',
    queryFn: async (): Promise<ScreeningConflictsRead> => {
      const result = await fetchConflicts(projectId);
      if (!result.ok) throw result.error;
      return result.data;
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
