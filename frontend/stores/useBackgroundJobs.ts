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
            job.id === jobId ? { ...job, ...updates } : job
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

      getRecentJobs: (limit = 10) => {
        const allJobs = get().jobs;

          // Keep active jobs + last N completed/failed/cancelled
        const activeJobs = allJobs.filter(
          (job) => job.status === 'running' || job.status === 'pending'
        );
        
        const finishedJobs = allJobs
          .filter((job) => 
            job.status === 'completed' || 
            job.status === 'failed' || 
            job.status === 'cancelled'
          )
          .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt))
          .slice(0, Math.max(limit - activeJobs.length, MAX_COMPLETED_JOBS));

        return [...activeJobs, ...finishedJobs];
      },
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

