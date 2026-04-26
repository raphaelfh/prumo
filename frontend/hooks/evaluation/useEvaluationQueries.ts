import { useQuery } from "@tanstack/react-query";

import {
  getEvaluationRun,
  listReviewQueue,
  type EvaluationReviewQueueResponse,
  type EvaluationRunResponse,
} from "@/integrations/api";

export const evaluationKeys = {
  all: ["evaluation"] as const,
  runs: () => [...evaluationKeys.all, "runs"] as const,
  runDetail: (runId: string) => [...evaluationKeys.runs(), runId] as const,
  reviewQueue: (runId?: string, status?: "pending" | "decided") =>
    [...evaluationKeys.all, "review-queue", runId ?? "all", status ?? "all"] as const,
};

export interface UseEvaluationRunOptions {
  runId: string | null;
  enabled?: boolean;
}

export function useEvaluationRun({ runId, enabled = true }: UseEvaluationRunOptions) {
  return useQuery<EvaluationRunResponse>({
    queryKey: runId ? evaluationKeys.runDetail(runId) : [],
    queryFn: async () => {
      if (!runId) {
        throw new Error("Missing run ID");
      }
      return getEvaluationRun(runId);
    },
    enabled: enabled && !!runId,
    staleTime: 30_000,
    retry: 1,
  });
}

export interface UseReviewQueueOptions {
  runId?: string;
  status?: "pending" | "decided";
  enabled?: boolean;
}

export function useReviewQueue({ runId, status, enabled = true }: UseReviewQueueOptions) {
  return useQuery<EvaluationReviewQueueResponse>({
    queryKey: evaluationKeys.reviewQueue(runId, status),
    queryFn: () => listReviewQueue({ runId, status }),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}
