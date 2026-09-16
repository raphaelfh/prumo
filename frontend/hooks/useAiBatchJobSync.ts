/**
 * Mirrors every active-or-recent AI batch (spec 2026-09-15 §11.5) into the
 * background-jobs store, so the notification bell shows one entry per batch
 * without a bespoke rendering path.
 *
 * The server is the source of truth: `useRecentBatches` scopes to the caller
 * and the last 7 days and includes terminal batches, so a batch that drops
 * out of that list (aged past 7 days) is left alone here — it has already
 * reached a terminal status locally.
 * `completedAt` is stamped once, on the transition into a terminal state:
 * `countUnreadJobs` keys the bell badge off it, so restamping on every poll
 * would keep the badge from ever settling.
 */
import {useEffect} from 'react';

import {useRecentBatches} from '@/hooks/extraction/useExtractionBatches';
import {useBackgroundJobs} from '@/stores/useBackgroundJobs';
import type {AiBatchJob} from '@/types/background-jobs';
import type {BackgroundJob} from '@/types/background-jobs';
import {finishedCount} from '@/types/extraction-batch';
import type {BatchState, ExtractionBatchSummary} from '@/types/extraction-batch';

const STATUS_BY_STATE: Record<BatchState, BackgroundJob['status']> = {
  active: 'running',
  finished: 'completed',
  stopped: 'failed',
  cancelled: 'cancelled',
};

function isTerminal(status: BackgroundJob['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function toJob(summary: ExtractionBatchSummary, existing: BackgroundJob | undefined): AiBatchJob {
  const status = STATUS_BY_STATE[summary.state];
  const wasTerminal = existing ? isTerminal(existing.status) : false;
  const completedAt = isTerminal(status) ? (wasTerminal ? existing?.completedAt : Date.now()) : undefined;

  return {
    id: `ai-batch-${summary.id}`,
    type: 'ai-batch',
    status,
    createdAt: existing?.createdAt ?? new Date(summary.created_at).getTime(),
    startedAt: existing?.startedAt ?? new Date(summary.created_at).getTime(),
    completedAt,
    progress: {
      phase: summary.state,
      current: finishedCount(summary.counts),
      total: summary.counts.total,
      message: '',
    },
    metadata: {
      batchId: summary.id,
      projectId: summary.project_id,
      projectName: summary.project_name,
      templateId: summary.template_id,
      templateName: summary.template_name,
      kind: summary.kind,
      state: summary.state,
      stalled: summary.stalled,
      stopCode: summary.stop_code,
      counts: summary.counts,
    },
  };
}

export function useAiBatchJobSync(): void {
  const {jobs, addJob, updateJob} = useBackgroundJobs();
  const {data: batches} = useRecentBatches();

  useEffect(() => {
    if (!batches) return;
    for (const summary of batches) {
      const id = `ai-batch-${summary.id}`;
      const existing = jobs.find((job) => job.id === id);
      const job = toJob(summary, existing);
      if (!existing) {
        addJob(job);
      } else {
        updateJob(id, job);
      }
    }
     
  }, [batches]);
}
