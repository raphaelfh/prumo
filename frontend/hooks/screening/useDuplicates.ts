/**
 * The project's duplicate pairs and the verdict write. The read sits under
 * `screeningKeys.project`, so every screening mutation refreshes it; a verdict
 * invalidates that whole family (the pair list, the records read, the counts
 * and PRISMA all move with it).
 */
import {queryOptions, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import type {ApiError} from '@/integrations/api/client';
import {invalidateScreening, screeningKeys} from '@/lib/query-keys/screening';
import {
  fetchDuplicates,
  postDuplicateVerdicts,
  type DuplicatesRead,
  type DuplicateVerdictCreate,
  type DuplicateVerdictsResult,
} from '@/services/duplicatesService';

/** Shared by `useDuplicates` and the enroll buttons' `queryClient.fetchQuery`. */
export function duplicatesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: screeningKeys.duplicates(projectId),
    queryFn: async (): Promise<DuplicatesRead> => {
      const result = await fetchDuplicates(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

export function useDuplicates(projectId: string, enabled: boolean) {
  return useQuery({
    ...duplicatesQueryOptions(projectId),
    enabled: enabled && Boolean(projectId),
    // Writes made elsewhere (an import, a co-manager's verdict) never reach
    // this cache; a remount must not keep a stale pair list.
    refetchOnMount: 'always',
  });
}

export function useDuplicateVerdicts(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<DuplicateVerdictsResult, ApiError, DuplicateVerdictCreate[]>({
    mutationFn: async (items) => {
      const result = await postDuplicateVerdicts(projectId, items);
      if (!result.ok) throw result.error;
      return result.data;
    },
    // A refusal means the pairs moved under the caller: refetch on failure too.
    onSettled: () => invalidateScreening(queryClient, projectId),
  });
}
