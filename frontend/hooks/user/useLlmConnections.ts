/** TanStack reads for the viewer's own connections and (Task 14) the registry (§4). */
import {useQuery} from '@tanstack/react-query';

import {meKeys} from '@/lib/query-keys';
import {fetchMyConnections, type LlmConnectionRead} from '@/services/llmConnectionsService';

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
