/**
 * TanStack Query keys for AI batch runs. Start/cancel/resume invalidate
 * `.all` — a batch can change which list entry and which detail are correct,
 * and the sets are small.
 */
export const extractionBatchKeys = {
  all: ['extraction-batches'] as const,
  list: (projectId: string | null, activeOnly: boolean) =>
    [...extractionBatchKeys.all, 'list', projectId, activeOnly] as const,
  detail: (batchId: string) =>
    [...extractionBatchKeys.all, 'detail', batchId] as const,
} as const;
