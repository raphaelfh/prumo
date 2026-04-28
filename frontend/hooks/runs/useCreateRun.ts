/**
 * Mutation hook to create an extraction run via POST `/api/v1/runs`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/integrations/api";

import { runsKeys, type CreateRunRequest, type RunSummaryResponse } from "./types";

export function useCreateRun() {
  const queryClient = useQueryClient();

  return useMutation<RunSummaryResponse, Error, CreateRunRequest>({
    mutationFn: (body) =>
      apiClient<RunSummaryResponse>("/api/v1/runs", {
        method: "POST",
        body,
      }),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(run.id) });
    },
  });
}
