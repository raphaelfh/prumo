/**
 * TanStack Query access to AI batch runs (spec 2026-09-15 §11.1).
 *
 * The server is the source of truth: the hooks poll while a batch is active
 * and stop the moment it is not, so a finished batch costs nothing.
 */
import {useEffect, useRef} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {extractionBatchKeys} from '@/lib/query-keys/extractionBatch';
import {articleExtractionValuesKeys} from '@/lib/query-keys/extraction';
import {
  cancelExtractionBatch,
  getExtractionBatch,
  listExtractionBatches,
  resumeExtractionBatch,
  startExtractionBatch,
} from '@/services/extractionBatchService';
import type {
  CreateExtractionBatchRequest,
  ExtractionBatchDetail,
  ExtractionBatchSummary,
} from '@/types/extraction-batch';
import {isBatchActive} from '@/types/extraction-batch';

export const ACTIVE_BATCH_POLL_MS = 5000;

export function useActiveBatches(projectId: string | null) {
  return useQuery({
    queryKey: extractionBatchKeys.list(projectId, true),
    queryFn: () => listExtractionBatches({projectId: projectId ?? undefined, active: true}),
    enabled: Boolean(projectId),
    // Poll only while something is actually running; TanStack already pauses
    // the interval while the tab is hidden.
    refetchInterval: (query) =>
      (query.state.data as ExtractionBatchSummary[] | undefined)?.some(isBatchActive)
        ? ACTIVE_BATCH_POLL_MS
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

/**
 * The caller's batches from the last 7 days, active AND terminal (spec
 * 2026-09-15 §11.5 fix). `useActiveBatches` filters to `active: true` server
 * side, so a finished batch drops out of that list forever — this is the
 * query the notification bell needs to ever observe a completion.
 */
export function useRecentBatches() {
  return useQuery({
    queryKey: extractionBatchKeys.list(null, false),
    queryFn: () => listExtractionBatches({}),
    refetchInterval: (query) =>
      (query.state.data as ExtractionBatchSummary[] | undefined)?.some(isBatchActive)
        ? ACTIVE_BATCH_POLL_MS
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useBatchDetail(batchId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: extractionBatchKeys.detail(batchId ?? ''),
    queryFn: () => getExtractionBatch(batchId as string),
    enabled: Boolean(batchId),
    refetchInterval: (q) =>
      (q.state.data as ExtractionBatchDetail | undefined)?.state === 'active'
        ? ACTIVE_BATCH_POLL_MS
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // §11.4: when an article finishes, the list rings are stale. Keyed by
  // batchId so switching to a different batch never compares its fresh
  // done count against a stale count left over from the previous batch.
  const lastDoneRef = useRef<{batchId: string | null; done: number}>({
    batchId: null,
    done: 0,
  });
  const counts = query.data?.counts;
  const done = counts ? counts.done + counts.done_with_issues : 0;
  useEffect(() => {
    const last = lastDoneRef.current;
    if (last.batchId !== batchId) {
      lastDoneRef.current = {batchId, done: 0};
      return;
    }
    if (done > last.done) {
      lastDoneRef.current = {batchId, done};
      void queryClient.invalidateQueries({queryKey: articleExtractionValuesKeys.all});
    }
  }, [batchId, done, queryClient]);

  return query;
}

function useBatchMutation<TVariables>(
  fn: (variables: TVariables) => Promise<ExtractionBatchDetail>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: extractionBatchKeys.all});
    },
  });
}

export function useStartBatch() {
  return useBatchMutation<CreateExtractionBatchRequest>(startExtractionBatch);
}

export function useCancelBatch() {
  return useBatchMutation<string>(cancelExtractionBatch);
}

export function useResumeBatch() {
  return useBatchMutation<string>(resumeExtractionBatch);
}
