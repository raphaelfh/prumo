/**
 * TanStack hooks for the project's screening setup: the config read (which
 * also carries the enroll counts and the caller's capabilities) and the two
 * writes that move it. Every screening mutation invalidates
 * `screeningKeys.project(projectId)`: the counts the read returns are
 * server-computed, so they are refetched, never patched.
 */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {screeningKeys} from '@/lib/query-keys/screening';
import {
  enrollArticles,
  fetchScreeningConfig,
  setScreeningConfig,
  type ScreeningConfigRead,
  type ScreeningConfigUpdate,
  type ScreeningEnrollRequest,
  type ScreeningEnrollResult,
} from '@/services/screeningService';

export function useScreeningConfig(projectId: string) {
  return useQuery({
    queryKey: screeningKeys.config(projectId),
    enabled: Boolean(projectId),
    // Writes made elsewhere (a co-reviewer's decision, another session's
    // import) never reach this cache: under the app's 5-minute staleTime a remount would
    // otherwise keep pre-import enroll and PRISMA numbers.
    refetchOnMount: 'always',
    queryFn: async (): Promise<ScreeningConfigRead> => {
      const result = await fetchScreeningConfig(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

export function useSetScreeningConfig(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<ScreeningConfigRead, Error, ScreeningConfigUpdate>({
    mutationFn: async (body) => {
      const result = await setScreeningConfig(projectId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: screeningKeys.project(projectId)});
    },
  });
}

export function useEnrollArticles(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<ScreeningEnrollResult, Error, ScreeningEnrollRequest>({
    mutationFn: async (body) => {
      const result = await enrollArticles(projectId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: screeningKeys.project(projectId)});
    },
  });
}
