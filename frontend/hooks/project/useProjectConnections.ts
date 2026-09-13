/** The project's shared keys (§4) — manager-gated on the API, so callers
 * pass `null` for a non-manager and the query stays disabled. */
import {useQuery} from '@tanstack/react-query';

import {projectKeys} from '@/lib/query-keys';
import {fetchProjectConnections, type LlmConnectionRead} from '@/services/llmConnectionsService';

const STALE_MS = 5 * 60_000;

export function useProjectConnections(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKeys.connections(projectId ?? ''),
    enabled: Boolean(projectId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<LlmConnectionRead[]> => {
      const result = await fetchProjectConnections(projectId!);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}
