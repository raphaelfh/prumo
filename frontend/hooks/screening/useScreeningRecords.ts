/**
 * Every project article in one screening phase, as the caller may see it: the
 * workspace's list. Status and outcome are server-computed (and blind-safe), so
 * a decision refetches this read rather than patching it.
 */
import {useQuery} from '@tanstack/react-query';

import {screeningKeys} from '@/lib/query-keys/screening';
import {fetchScreeningRecords, type ScreeningPhase, type ScreeningRecordsRead} from '@/services/screeningService';

export function useScreeningRecords(projectId: string, phase: ScreeningPhase, enabled: boolean) {
  return useQuery({
    queryKey: screeningKeys.records(projectId, phase),
    enabled: enabled && Boolean(projectId),
    // Writes made elsewhere (a co-reviewer's decision, another session's
    // import) never reach this cache: under the app's 5-minute staleTime a remount would
    // otherwise keep a deleted article or miss a newly imported one.
    refetchOnMount: 'always',
    queryFn: async (): Promise<ScreeningRecordsRead> => {
      const result = await fetchScreeningRecords(projectId, phase);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}
