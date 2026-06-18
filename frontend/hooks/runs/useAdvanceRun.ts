/**
 * Mutation hook to advance the lifecycle stage of a run via
 * POST `/api/v1/runs/{runId}/advance`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api";
import { t } from "@/lib/copy";

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
    // Surface stage-transition rejections (e.g. the finalize completeness
    // gate, ADR 0009). Previously callers fired this via `void onFinalize()`,
    // so a backend 400 became a swallowed promise rejection and the user got
    // no feedback. The ApiError carries the envelope's `error.message`.
    onError: (error) => {
      toast.error(error.message || t("extraction", "errors_advanceFailed"));
    },
  });
}
