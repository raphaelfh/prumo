/**
 * The reviewer's queue: up to 20 records awaiting the caller. The decision
 * that advances it is `useDecide` (`useScreeningMutations.ts`).
 */
import {useQuery} from '@tanstack/react-query';

import {screeningKeys} from '@/lib/query-keys/screening';
import {fetchScreeningQueue, type ScreeningQueueRead} from '@/services/screeningService';

export function useScreeningQueue(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: screeningKeys.queue(projectId),
    enabled: enabled && Boolean(projectId),
    // Writes made elsewhere (a co-reviewer's decision, another session's
    // import) never reach this cache: under the app's 5-minute staleTime a remount would
    // otherwise keep a deleted article or miss a newly imported one.
    refetchOnMount: 'always',
    queryFn: async (): Promise<ScreeningQueueRead> => {
      const result = await fetchScreeningQueue(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}
