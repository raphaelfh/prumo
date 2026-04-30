/**
 * Mutation hook to record a consensus decision (and matching published state)
 * for a given run via POST `/api/v1/runs/{runId}/consensus`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/integrations/api";

import {
  runsKeys,
  type ConsensusResultResponse,
  type CreateConsensusRequest,
} from "./types";

export function useCreateConsensus(runId: string) {
  const queryClient = useQueryClient();

  return useMutation<ConsensusResultResponse, Error, CreateConsensusRequest>({
    mutationFn: (body) =>
      apiClient<ConsensusResultResponse>(`/api/v1/runs/${runId}/consensus`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(runId) });
    },
  });
}
