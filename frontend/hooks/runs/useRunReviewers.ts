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

import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/integrations/api";

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

const reviewersKey = (runId: string) => ["runs", runId, "reviewers"] as const;

export function useRunReviewers(
  runId: string | null | undefined,
  options: UseRunReviewersOptions = {},
): UseRunReviewersResult {
  const { enabled = true } = options;

  const query = useQuery<RunReviewersResponse>({
    queryKey: runId ? reviewersKey(runId) : ["runs", "no-run", "reviewers"],
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

  const reviewers = useMemo(
    () => query.data?.reviewers ?? [],
    [query.data?.reviewers],
  );

  const labelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of reviewers) {
      map[r.id] = r.full_name?.trim() || `Reviewer ${r.id.slice(0, 8)}…`;
    }
    return map;
  }, [reviewers]);

  const avatarById = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const r of reviewers) {
      map[r.id] = r.avatar_url;
    }
    return map;
  }, [reviewers]);

  return {
    data: reviewers,
    labelById,
    avatarById,
    isLoading: query.isLoading,
    error: query.error,
  };
}
