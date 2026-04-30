/**
 * Mutation hook to record a proposal for a given run via
 * POST `/api/v1/runs/{runId}/proposals`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/integrations/api";

import {
  runsKeys,
  type CreateProposalRequest,
  type ProposalRecordResponse,
} from "./types";

export function useCreateProposal(runId: string) {
  const queryClient = useQueryClient();

  return useMutation<ProposalRecordResponse, Error, CreateProposalRequest>({
    mutationFn: (body) =>
      apiClient<ProposalRecordResponse>(`/api/v1/runs/${runId}/proposals`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(runId) });
    },
  });
}
