/**
 * Hook to fetch the aggregate detail for an extraction run from `/api/v1/runs/{runId}`.
 *
 * Returns the run summary alongside its proposals, reviewer decisions,
 * consensus decisions and published states.
 */

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/integrations/api";

import { runsKeys, type RunDetailResponse } from "./types";

export interface UseRunOptions {
  enabled?: boolean;
}

export function useRun(runId: string | null | undefined, options: UseRunOptions = {}) {
  const { enabled = true } = options;

  return useQuery<RunDetailResponse>({
    queryKey: runId ? runsKeys.detail(runId) : ["runs", "disabled"],
    queryFn: async () => {
      if (!runId) {
        throw new Error("Missing run ID");
      }
      return apiClient<RunDetailResponse>(`/api/v1/runs/${runId}`);
    },
    enabled: enabled && Boolean(runId),
    staleTime: 30_000,
    retry: 1,
  });
}
