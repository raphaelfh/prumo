/**
 * Hook para polling de Background Jobs
 * 
 * Monitora jobs ativos e atualiza seu status automaticamente.
 * Syncs with running services to reflect progress in real time.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useBackgroundJobs } from '@/stores/useBackgroundJobs';
import type { BackgroundJob } from '@/types/background-jobs';

interface UseBackgroundJobPollingOptions {
    interval?: number; // Polling interval in ms (default: 2000)
  onJobComplete?: (job: BackgroundJob) => void;
  onJobFailed?: (job: BackgroundJob) => void;
}

/**
 * Hook that polls active jobs and updates notifications
 */
export function useBackgroundJobPolling(options: UseBackgroundJobPollingOptions = {}) {
  const { interval = 2000, onJobComplete, onJobFailed } = options;
  
  const { getActiveJobs } = useBackgroundJobs();
  const previousJobStatesRef = useRef<Map<string, string>>(new Map());

  const checkJobStatus = useCallback(() => {
    const activeJobs = getActiveJobs();

      // Check for state changes
    activeJobs.forEach((job) => {
      const previousStatus = previousJobStatesRef.current.get(job.id);
      
      // Job completado
        if (
            previousStatus !== undefined &&
            previousStatus !== 'completed' &&
            job.status === 'completed'
        ) {
        onJobComplete?.(job);
      }
      
      // Job falhou
        if (
            previousStatus !== undefined &&
            previousStatus !== 'failed' &&
            job.status === 'failed'
        ) {
        onJobFailed?.(job);
      }

        // Update previous state
      previousJobStatesRef.current.set(job.id, job.status);
    });

      // Clear jobs that no longer exist
    const activeJobIds = new Set(activeJobs.map(j => j.id));
    for (const [jobId] of previousJobStatesRef.current) {
      if (!activeJobIds.has(jobId)) {
        previousJobStatesRef.current.delete(jobId);
      }
    }
  }, [getActiveJobs, onJobComplete, onJobFailed]);

  useEffect(() => {
    const activeJobs = getActiveJobs();

      // If no active jobs, do not poll
    if (activeJobs.length === 0) {
      return;
    }

    // Polling interval
    const intervalId = setInterval(checkJobStatus, interval);

    // Cleanup
    return () => {
      clearInterval(intervalId);
    };
  }, [getActiveJobs, checkJobStatus, interval]);

  return {
    activeJobsCount: getActiveJobs().length,
  };
}

