/**
 * Per-row queued/running state, derived from the caller's active batch for
 * this tool (spec 2026-09-15 §11.1/§11.4).
 */
import {useMemo} from 'react';

import {useActiveBatches, useBatchDetail} from '@/hooks/extraction/useExtractionBatches';
import type {ExtractionBatchSummary} from '@/types/extraction-batch';

/** The caller's active batch for this tool, and its per-article state. */
export function useBatchRowStatus(
  projectId: string,
  templateId: string,
): {
  activeBatch: ExtractionBatchSummary | null;
  rowStatus: Map<string, 'queued' | 'running'>;
} {
  const {data: batches} = useActiveBatches(projectId);
  const activeBatch =
    batches?.find((batch) => batch.template_id === templateId && batch.state === 'active') ??
    null;

  const {data: detail} = useBatchDetail(activeBatch?.id ?? null);

  const rowStatus = useMemo(() => {
    const map = new Map<string, 'queued' | 'running'>();
    for (const item of detail?.items ?? []) {
      if (item.outcome === 'queued' || item.outcome === 'running') {
        map.set(item.article_id, item.outcome);
      }
    }
    return map;
  }, [detail]);

  return {activeBatch, rowStatus};
}
