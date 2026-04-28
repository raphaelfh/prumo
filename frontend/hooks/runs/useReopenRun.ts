/**
 * Mutation hook to reopen a finalized run via
 * POST `/api/v1/runs/{runId}/reopen`.
 *
 * Returns the new run summary; the caller is responsible for navigating
 * to the new run (or refetching the active-run resolver, since
 * QualityAssessmentFullScreen / ExtractionFullScreen find the latest
 * non-terminal run automatically).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/integrations/api";

import { runsKeys, type RunSummaryResponse } from "./types";

export function useReopenRun() {
  const queryClient = useQueryClient();

  return useMutation<RunSummaryResponse, Error, string>({
    mutationFn: (runId) =>
      apiClient<RunSummaryResponse>(`/api/v1/runs/${runId}/reopen`, {
        method: "POST",
      }),
    onSuccess: (newRun, oldRunId) => {
      // Invalidate the old run (its status / lineage didn't change but
      // any cached aggregate may want to reflect "has child"), and prime
      // the new run cache.
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(oldRunId) });
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(newRun.id) });
    },
  });
}
