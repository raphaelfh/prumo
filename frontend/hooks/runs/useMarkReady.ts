/**
 * Mutation hook to toggle the caller's per-reviewer "ready" signal via
 * POST `/api/v1/runs/{runId}/ready`. Advisory — it never advances the run.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api";
import { t } from "@/lib/copy";

import {
  runsKeys,
  type MarkReadyRequest,
  type RunReadyStateResponse,
} from "./types";

export function useMarkReady(runId: string) {
  const queryClient = useQueryClient();

  return useMutation<RunReadyStateResponse, Error, MarkReadyRequest>({
    mutationFn: (body) =>
      apiClient<RunReadyStateResponse>(`/api/v1/runs/${runId}/ready`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(runId) });
      queryClient.invalidateQueries({ queryKey: runsKeys.reviewers(runId) });
    },
    onError: (error) => {
      toast.error(error.message || t("extraction", "errors_markReadyFailed"));
    },
  });
}
