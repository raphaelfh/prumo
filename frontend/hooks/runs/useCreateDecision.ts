/**
 * Mutation hook to record a reviewer decision for a given run via
 * POST `/api/v1/runs/{runId}/decisions`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/integrations/api";

import {
  runsKeys,
  type CreateDecisionRequest,
  type ReviewerDecisionResponse,
} from "./types";

export function useCreateDecision(runId: string) {
  const queryClient = useQueryClient();

  return useMutation<ReviewerDecisionResponse, Error, CreateDecisionRequest>({
    mutationFn: (body) =>
      apiClient<ReviewerDecisionResponse>(`/api/v1/runs/${runId}/decisions`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(runId) });
    },
  });
}
