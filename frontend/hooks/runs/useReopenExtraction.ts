/**
 * Mutation hook to send a consensus-stage extraction run back to extract via
 * POST `/api/v1/runs/{runId}/reopen-extraction` (arbitrator-only, destructive —
 * discards the run's consensus work). See ADR-0017.
 *
 * In-place backward move (same run id), so on success we invalidate that run's
 * detail family — the refetch drops the now-empty `consensus_decisions` /
 * `published_states` and reflects `stage='extract'`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/integrations/api";

import { runsKeys, type RunSummaryResponse } from "./types";

export function useReopenExtraction() {
  const queryClient = useQueryClient();

  return useMutation<RunSummaryResponse, Error, string>({
    mutationFn: (runId) =>
      apiClient<RunSummaryResponse>(`/api/v1/runs/${runId}/reopen-extraction`, {
        method: "POST",
      }),
    onSuccess: (_run, runId) => {
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(runId) });
    },
  });
}
