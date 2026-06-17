/**
 * Store for Background Jobs
 *
 * Keeps state of running jobs and recent history,
 * with LocalStorage persistence to survive reloads.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {BackgroundJob} from '@/types/background-jobs';

interface BackgroundJobsState {
  jobs: BackgroundJob[];
  
  // Actions
  addJob: (job: BackgroundJob) => void;
  updateJob: (jobId: string, updates: Partial<BackgroundJob>) => void;
  removeJob: (jobId: string) => void;
  clearCompletedJobs: () => void;
  
  // Queries
  getJob: (jobId: string) => BackgroundJob | undefined;
  getActiveJobs: () => BackgroundJob[];
  getRecentJobs: (limit?: number) => BackgroundJob[];
}

const MAX_COMPLETED_JOBS = 10; // Keep only last 10 completed jobs

/**
 * Pure selector for the notification list: active jobs first, then the most
 * recently finished ones. Exported so components can derive it from a
 * reactive `jobs` value — the React Compiler tracks dependencies from the
 * callback body, so a `useMemo(() => getRecentJobs(20), [jobs])` whose
 * callback never references `jobs` is memoized as stale and misses
 * in-session additions. Passing `jobs` in keeps the dependency real.
 */
export function selectRecentJobs(
  jobs: BackgroundJob[],
  limit = 10,
): BackgroundJob[] {
  const activeJobs = jobs.filter(
    (job) => job.status === 'running' || job.status === 'pending',
  );
  const finishedJobs = jobs
    .filter(
      (job) =>
        job.status === 'completed' ||
        job.status === 'failed' ||
        job.status === 'cancelled',
    )
    .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt))
    .slice(0, Math.max(limit - activeJobs.length, MAX_COMPLETED_JOBS));

  return [...activeJobs, ...finishedJobs];
}

export const useBackgroundJobs = create<BackgroundJobsState>()(
  persist(
    (set, get) => ({
      jobs: [],

      addJob: (job) => {
        set((state) => ({
          jobs: [job, ...state.jobs],
        }));
      },

      updateJob: (jobId, updates) => {
        set((state) => ({
          jobs: state.jobs.map((job) =>
              job.id === jobId
                  ? {
                      ...job,
                      ...updates,
                      progress: updates.progress ? {...job.progress, ...updates.progress} : job.progress,
                      stats: updates.stats ? {...job.stats, ...updates.stats} : job.stats,
                      metadata: updates.metadata ? {...job.metadata, ...updates.metadata} : job.metadata,
                  }
                  : job
          ),
        }));
      },

      removeJob: (jobId) => {
        set((state) => ({
          jobs: state.jobs.filter((job) => job.id !== jobId),
        }));
      },

      clearCompletedJobs: () => {
        set((state) => ({
          jobs: state.jobs.filter(
            (job) => job.status === 'running' || job.status === 'pending'
          ),
        }));
      },

      getJob: (jobId) => {
        return get().jobs.find((job) => job.id === jobId);
      },

      getActiveJobs: () => {
        return get().jobs.filter(
          (job) => job.status === 'running' || job.status === 'pending'
        );
      },

      getRecentJobs: (limit = 10) => selectRecentJobs(get().jobs, limit),
    }),
    {
      name: 'review-hub-background-jobs',
      version: 1,
      // Limpar jobs muito antigos ao hidratar
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        
        const now = Date.now();
        const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
        
        // Remover jobs completos com mais de 1 semana
        state.jobs = state.jobs.filter((job) => {
          if (job.status === 'running' || job.status === 'pending') {
            return true; // Manter jobs ativos
          }
          
          const jobTime = job.completedAt || job.createdAt;
          return now - jobTime < ONE_WEEK;
        });
      },
    }
  )
);

