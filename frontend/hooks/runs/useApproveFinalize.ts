/**
 * Mutation hook for the one-action consensus → finalized flow via
 * POST `/api/v1/runs/{runId}/approve-finalize`. Publishes every agreed coord
 * then finalizes, atomically (backend). Surfaces gate rejections as a toast.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api";
import { t } from "@/lib/copy";

import { runsKeys, type ApproveFinalizeResponse } from "./types";

export function useApproveFinalize(runId: string) {
  const queryClient = useQueryClient();

  return useMutation<ApproveFinalizeResponse, Error, void>({
    mutationFn: () =>
      apiClient<ApproveFinalizeResponse>(
        `/api/v1/runs/${runId}/approve-finalize`,
        { method: "POST" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runsKeys.detail(runId) });
    },
    onError: (error) => {
      toast.error(error.message || t("extraction", "errors_advanceFailed"));
    },
  });
}
