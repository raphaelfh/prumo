/**
 * Hook to fetch the list of reviewer profiles for a run via
 * `GET /api/v1/runs/{runId}/reviewers`.
 *
 * Returns the raw response plus two derived lookups
 * (`labelById` / `avatarById`) the consensus panel + avatar stack
 * components consume. Cache key is per-run; refetched after each
 * decision/consensus mutation invalidates the run detail cache (which
 * cascades to here, since the lists overlap).
 */

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/integrations/api";
import { runsKeys } from "./types";

export interface RunReviewerProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

interface RunReviewersResponse {
  reviewers: RunReviewerProfile[];
}

export interface UseRunReviewersOptions {
  enabled?: boolean;
}

export interface UseRunReviewersResult {
  data: RunReviewerProfile[];
  labelById: Record<string, string>;
  avatarById: Record<string, string | null>;
  isLoading: boolean;
  error: Error | null;
}

export function useRunReviewers(
  runId: string | null | undefined,
  options: UseRunReviewersOptions = {},
): UseRunReviewersResult {
  const { enabled = true } = options;

  const query = useQuery<RunReviewersResponse>({
    queryKey: runId ? runsKeys.reviewers(runId) : runsKeys.noRunReviewers,
    queryFn: async () => {
      if (!runId) throw new Error("Missing run ID");
      return apiClient<RunReviewersResponse>(
        `/api/v1/runs/${runId}/reviewers`,
      );
    },
    enabled: enabled && Boolean(runId),
    staleTime: 30_000,
    retry: 1,
  });

  const reviewers = query.data?.reviewers ?? [];

  const labelById: Record<string, string> = {};
  for (const r of reviewers) {
    labelById[r.id] = r.full_name?.trim() || `Reviewer ${r.id.slice(0, 8)}…`;
  }

  const avatarById: Record<string, string | null> = {};
  for (const r of reviewers) {
    avatarById[r.id] = r.avatar_url;
  }

  return {
    data: reviewers,
    labelById,
    avatarById,
    isLoading: query.isLoading,
    error: query.error,
  };
}
