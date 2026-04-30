/**
 * Mutation hook to advance the lifecycle stage of a run via
 * POST `/api/v1/runs/{runId}/advance`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/integrations/api";

import {
  runsKeys,
  type AdvanceStageRequest,
  type RunSummaryResponse,
} from "./types";

export function useAdvanceRun(runId: string) {
  const queryClient = useQueryClient();

  return useMutation<RunSummaryResponse, Error, AdvanceStageRequest>({
    mutationFn: (body) =>
      apiClient<RunSummaryResponse>(`/api/v1/runs/${runId}/advance`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(runId) });
    },
  });
}
