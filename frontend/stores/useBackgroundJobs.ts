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
  /**
   * Timestamp the user last opened the notification bell. A finished job is
   * "unread" until then (see countUnreadJobs). Initialised to now so jobs that
   * finished in a previous session (rehydrated from storage) don't show as
   * unread on load. Persisted, so unread survives across reloads.
   */
  lastReadAt: number;

  // Actions
  addJob: (job: BackgroundJob) => void;
  updateJob: (jobId: string, updates: Partial<BackgroundJob>) => void;
  removeJob: (jobId: string) => void;
  clearCompletedJobs: () => void;
  /** Mark every finished job as read (clears the bell's unread badge). */
  markAllRead: () => void;

  // Queries
  getJob: (jobId: string) => BackgroundJob | undefined;
  getActiveJobs: () => BackgroundJob[];
  getRecentJobs: (limit?: number) => BackgroundJob[];
}

const MAX_COMPLETED_JOBS = 10; // Keep only last 10 completed jobs

/**
 * Count finished (completed/failed/cancelled) jobs that finished AFTER the user
 * last opened the bell — i.e. genuinely unread. Pure selector so the React
 * Compiler tracks deps from the callback body (mirrors selectRecentJobs).
 */
export function countUnreadJobs(jobs: BackgroundJob[], lastReadAt: number): number {
  return jobs.filter(
    (job) =>
      (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') &&
      (job.completedAt ?? 0) > lastReadAt,
  ).length;
}

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
      // Date.now() at store creation: anything finished before "now" counts as
      // already-read (so a fresh load with old persisted jobs shows no badge).
      // On rehydrate, the persisted lastReadAt shallow-merges over this default;
      // pre-update persisted state (no lastReadAt key) keeps this default.
      lastReadAt: Date.now(),

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

      markAllRead: () => {
        set({ lastReadAt: Date.now() });
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

