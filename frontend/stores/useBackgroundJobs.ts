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
  /**
   * The account these jobs belong to; null while signed out, and also for
   * state persisted before this field existed. Persisted alongside the jobs,
   * because only a value that survives the reload can tell "the same user
   * came back" (keep the jobs — surviving a reload is why they are persisted
   * at all) from "somebody else is here now" (drop them).
   */
  ownerId: string | null;

  // Actions
  addJob: (job: BackgroundJob) => void;
  updateJob: (jobId: string, updates: Partial<BackgroundJob>) => void;
  removeJob: (jobId: string) => void;
  clearCompletedJobs: () => void;
  /** Mark every finished job as read (clears the bell's unread badge). */
  markAllRead: () => void;
  /**
   * Point the store at `userId`, emptying it first if the jobs it is holding
   * belong to a different account. Called from the one place that knows the
   * identity changed (AuthContext); adopting the same account again is a
   * no-op, so a reload, a token refresh or a re-announcement from another tab
   * never costs the user their own in-flight jobs.
   */
  adoptOwner: (userId: string | null) => void;

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
      // No account until AuthContext announces one. State persisted before
      // this field existed carries no `ownerId` key, so the shallow merge on
      // rehydrate leaves this default and the first adoption drops it — those
      // jobs cannot be shown to belong to whoever is signed in now.
      ownerId: null,

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

      adoptOwner: (userId) => {
        if (get().ownerId === userId) return;
        set({ jobs: [], lastReadAt: Date.now(), ownerId: userId });
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
      // Drop long-stale jobs on rehydrate.
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        const now = Date.now();
        const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

        // Discard jobs that finished over a week ago.
        state.jobs = state.jobs.filter((job) => {
          if (job.status === 'running' || job.status === 'pending') {
            return true; // Keep active jobs.
          }

          const jobTime = job.completedAt || job.createdAt;
          return now - jobTime < ONE_WEEK;
        });
      },
    }
  )
);

