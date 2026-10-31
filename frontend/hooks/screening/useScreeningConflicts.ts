/**
 * The arbitrator's conflicts list. The ruling that clears one is
 * `useArbitrate` (`useScreeningMutations.ts`).
 */
import {useQuery} from '@tanstack/react-query';

import {screeningKeys} from '@/lib/query-keys/screening';
import {fetchConflicts, type ScreeningConflictsRead} from '@/services/screeningService';

export function useScreeningConflicts(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: screeningKeys.conflicts(projectId),
    enabled: enabled && Boolean(projectId),
    // Writes made elsewhere (a co-reviewer's decision, another session's
    // import) never reach this cache: under the app's 5-minute staleTime a remount would
    // otherwise keep a deleted article or miss a newly arrived conflict.
    refetchOnMount: 'always',
    queryFn: async (): Promise<ScreeningConflictsRead> => {
      const result = await fetchConflicts(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}
