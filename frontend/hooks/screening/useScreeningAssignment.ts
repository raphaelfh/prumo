/** One screening record as the caller may see it; `null` reads nothing. */
import {queryOptions, useQuery} from '@tanstack/react-query';

import {ApiError} from '@/integrations/api/client';
import {screeningKeys} from '@/lib/query-keys/screening';
import {fetchAssignment, type ScreeningAssignmentRead} from '@/services/screeningService';

/** The record read, shared by the hook and the workspace's prefetch of the next records. */
export function assignmentQueryOptions(assignmentId: string) {
  return queryOptions({
    queryKey: screeningKeys.assignment(assignmentId),
    // A missing record or a refused caller will not change on retry.
    retry: (failures, error) =>
      !(error instanceof ApiError && (error.status === 403 || error.status === 404)) && failures < 1,
    queryFn: async (): Promise<ScreeningAssignmentRead> => {
      const result = await fetchAssignment(assignmentId);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

export function useScreeningAssignment(assignmentId: string | null) {
  return useQuery({
    ...assignmentQueryOptions(assignmentId ?? ''),
    enabled: Boolean(assignmentId),
    // Writes made elsewhere (a co-reviewer's decision, another session's
    // import) never reach this cache: under the app's 5-minute staleTime a remount would
    // otherwise keep a deleted article's record or a stale outcome.
    refetchOnMount: 'always',
  });
}
