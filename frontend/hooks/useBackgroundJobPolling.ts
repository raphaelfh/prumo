/**
 * Hook para polling de Background Jobs
 * 
 * Monitora jobs ativos e atualiza seu status automaticamente.
 * Sincroniza com serviços em execução para refletir progresso em tempo real.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useBackgroundJobs } from '@/stores/useBackgroundJobs';
import type { BackgroundJob } from '@/types/background-jobs';

interface UseBackgroundJobPollingOptions {
  interval?: number; // Intervalo de polling em ms (padrão: 2000)
  onJobComplete?: (job: BackgroundJob) => void;
  onJobFailed?: (job: BackgroundJob) => void;
}

/**
 * Hook que faz polling de jobs ativos e atualiza notificações
 */
export function useBackgroundJobPolling(options: UseBackgroundJobPollingOptions = {}) {
  const { interval = 2000, onJobComplete, onJobFailed } = options;
  
  const { getActiveJobs } = useBackgroundJobs();
  const previousJobStatesRef = useRef<Map<string, string>>(new Map());

  const checkJobStatus = useCallback(() => {
    const activeJobs = getActiveJobs();
    
    // Verificar mudanças de estado
    activeJobs.forEach((job) => {
      const previousStatus = previousJobStatesRef.current.get(job.id);
      
      // Job completado
      if (previousStatus === 'running' && job.status === 'completed') {
        onJobComplete?.(job);
      }
      
      // Job falhou
      if (previousStatus === 'running' && job.status === 'failed') {
        onJobFailed?.(job);
      }
      
      // Atualizar estado anterior
      previousJobStatesRef.current.set(job.id, job.status);
    });

    // Limpar jobs que não existem mais
    const activeJobIds = new Set(activeJobs.map(j => j.id));
    for (const [jobId] of previousJobStatesRef.current) {
      if (!activeJobIds.has(jobId)) {
        previousJobStatesRef.current.delete(jobId);
      }
    }
  }, [getActiveJobs, onJobComplete, onJobFailed]);

  useEffect(() => {
    const activeJobs = getActiveJobs();
    
    // Se não há jobs ativos, não fazer polling
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

