/**
 * Observes background-job status transitions and fires terminal-state
 * callbacks (completion / failure).
 *
 * Why this is subscription-driven, not interval-driven: the store's
 * `getActiveJobs()` only returns non-terminal jobs (running|pending),
 * so a job is invisible the instant it completes. Polling that set
 * could never witness a running→completed transition, which silently
 * killed the async-export completion toast + download action — the
 * worker built and signed the file, but the user never saw a download.
 *
 * We instead subscribe to the full `jobs` list and diff the previous
 * status of every job. `updateJob` always produces a new array, so a
 * completion is guaranteed to schedule a render and re-run the effect,
 * letting us observe the transition exactly once.
 */

import {useEffect, useRef} from 'react';
import {useBackgroundJobs} from '@/stores/useBackgroundJobs';
import type {BackgroundJob} from '@/types/background-jobs';

interface UseBackgroundJobPollingOptions {
  onJobComplete?: (job: BackgroundJob) => void;
  onJobFailed?: (job: BackgroundJob) => void;
}

/**
 * Hook that watches every background job and notifies on terminal
 * transitions.
 */
export function useBackgroundJobPolling(options: UseBackgroundJobPollingOptions = {}) {
  const {onJobComplete, onJobFailed} = options;

  const jobs = useBackgroundJobs((state) => state.jobs);
  const previousStatusRef = useRef<Map<string, BackgroundJob['status']>>(new Map());

  useEffect(() => {
    const seen = previousStatusRef.current;

    for (const job of jobs) {
      const previous = seen.get(job.id);
      // Fire only on a genuine transition INTO a terminal state.
      // `previous === undefined` means the job first appeared already
      // terminal (e.g. rehydrated from localStorage on reload) — that is
      // not a transition we caused, so we never re-toast it.
      if (previous !== undefined && previous !== job.status) {
        if (job.status === 'completed') {
          onJobComplete?.(job);
        } else if (job.status === 'failed') {
          onJobFailed?.(job);
        }
      }
      seen.set(job.id, job.status);
    }

    // Drop bookkeeping for jobs that no longer exist so the map cannot
    // grow unbounded and a recycled id cannot inherit a stale status.
    const liveIds = new Set(jobs.map((job) => job.id));
    for (const id of seen.keys()) {
      if (!liveIds.has(id)) {
        seen.delete(id);
      }
    }
  }, [jobs, onJobComplete, onJobFailed]);

  const activeJobsCount = jobs.filter(
    (job) => job.status === 'running' || job.status === 'pending',
  ).length;

  return {
    activeJobsCount,
  };
}
