/**
 * TanStack Query hook that polls the async section-extraction job status.
 *
 * Mirrors ``useExtractionExportJob`` (exports/useExtractionExportJob.ts):
 * - Polls every 2 s while the job is in a non-terminal state.
 * - Stops automatically once ``status`` is terminal
 *   (completed | failed | cancelled).
 * - ``staleTime: 0`` so each re-render always reflects the latest server
 *   response while the job is in flight.
 *
 * Consumers read ``data.status`` / ``data.result`` and react to terminal
 * states (e.g. toast success / error, invalidate query keys).
 */

import {useQuery} from '@tanstack/react-query';
import {extractionKeys} from '@/lib/query-keys';
import {getExtractionJobStatus, type ExtractionJobStatus} from '@/services/extractionRunService';

const TERMINAL_STATUSES: ExtractionJobStatus['status'][] = [
  'completed',
  'failed',
  'cancelled',
];

export function useExtractionJob(jobId: string | null) {
  return useQuery<ExtractionJobStatus>({
    queryKey: extractionKeys.job(jobId ?? ''),
    queryFn: async () => {
      if (!jobId) throw new Error('jobId is required');
      const result = await getExtractionJobStatus(jobId);
      if (!result.ok) throw result.error;
      return result.data;
    },
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const data = query.state.data as ExtractionJobStatus | undefined;
      if (!data) return 2_000;
      return TERMINAL_STATUSES.includes(data.status) ? false : 2_000;
    },
    staleTime: 0,
  });
}
