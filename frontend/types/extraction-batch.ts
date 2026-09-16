/**
 * AI batch runs (spec 2026-09-15 §7) — every type is derived from the
 * generated OpenAPI schema, never hand-written: the wire is snake_case and
 * the backend owns it.
 */
import type {components} from '@/types/api/schema';

export type ExtractionBatchSummary = components['schemas']['ExtractionBatchSummary'];
export type ExtractionBatchDetail = components['schemas']['ExtractionBatchDetail'];
export type ExtractionBatchItem = components['schemas']['ExtractionBatchItemView'];
export type ExtractionBatchCounts = components['schemas']['ExtractionBatchCounts'];
export type CreateExtractionBatchRequest =
  components['schemas']['CreateExtractionBatchRequest'];

export type BatchState = ExtractionBatchSummary['state'];
export type BatchOutcome = ExtractionBatchItem['outcome'];

/** A batch the dispatcher may still advance. */
export function isBatchActive(batch: {state: BatchState}): boolean {
  return batch.state === 'active';
}

/** Articles the batch has finished with, in any way. */
export function finishedCount(counts: ExtractionBatchCounts): number {
  return (
    counts.done +
    counts.done_with_issues +
    counts.needs_attention +
    counts.skipped +
    counts.not_run
  );
}
