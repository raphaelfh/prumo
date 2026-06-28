/**
 * Hook for per-section AI extraction — async Celery-job version.
 *
 * Replaces the old blocking-await pattern. Flow:
 *   1. ``extractSection`` POSTs → gets ``jobId`` back (202).
 *   2. ``useExtractionJob`` polls every 2 s until terminal.
 *   3. On ``completed`` → calls ``onSuccess`` + success toast, clears jobId.
 *   4. On ``failed`` / ``cancelled`` → error toast, clears jobId.
 *
 * Public API unchanged: ``{ extractSection, loading, error }`` so
 * ExtractionFullScreen and other callers need no changes.
 *
 * React Compiler: no try/finally / throw in hook body — IO in services.
 */

import {useEffect, useRef, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {t} from '@/lib/copy';
import {extractionKeys} from '@/lib/query-keys';
import {
  extractSectionAsync,
  type AsyncSectionExtractionParams,
} from '@/services/sectionExtractionService';
import {useExtractionJob} from '@/hooks/extraction/useExtractionJob';
import type {components} from '@/types/api/schema';

type ExtractionJobResult = components['schemas']['ExtractionJobResult'];

// Expose the param type so callers don't need to import from the service.
export type {AsyncSectionExtractionParams as SectionExtractionAsyncParams};

export interface UseSectionExtractionReturn {
  extractSection: (params: AsyncSectionExtractionParams) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useSectionExtraction(options?: {
  onSuccess?: (runId: string, suggestionsCreated: number) => void;
}): UseSectionExtractionReturn {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [kicking, setKicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stabilize onSuccess in a ref so the completion effect never fires a
  // stale closure when the caller passes an inline callback. The ref is
  // synced in an effect (not during render) to satisfy react-hooks/refs.
  const onSuccess = options?.onSuccess;
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const jobQuery = useExtractionJob(jobId);
  const jobStatus = jobQuery.data?.status;
  const jobResult = jobQuery.data?.result as ExtractionJobResult | null | undefined;
  const jobError = jobQuery.data?.error;

  // React to terminal job state. setState is placed inside async callbacks
  // (Promise.resolve().then()) to satisfy the react-hooks/set-state-in-effect rule.

  useEffect(() => {
    if (!jobId || !jobStatus) return;

    if (jobStatus === 'completed') {
      const created =
        jobResult?.suggestionsCreated ?? jobResult?.totalSuggestionsCreated ?? 0;
      const runId = jobResult?.extractionRunId ?? '';

      if (created === 0) {
        toast.warning(t('extraction', 'sectionExtractionNoSuggestionsTitle'), {
          description: t('extraction', 'sectionExtractionNoSuggestionsDesc'),
          duration: 6000,
        });
      } else {
        toast.success(
          t('extraction', 'sectionExtractionSuccessTitle').replace(
            '{{n}}',
            String(created),
          ),
        );
      }

      void queryClient.invalidateQueries({queryKey: extractionKeys.all});
      // Call onSuccess and clear state asynchronously to satisfy lint rule.
      void Promise.resolve(onSuccessRef.current?.(runId, created))
        .catch((err: unknown) => {
          console.error('[useSectionExtraction] onSuccess error:', err);
        })
        .then(() => {
          setJobId(null);
          setError(null);
        });
      return;
    }

    if (jobStatus === 'failed') {
      const msg = jobError ?? t('extraction', 'extractionJobFailedTitle');
      toast.error(t('extraction', 'sectionExtractionErrorTitle'), {
        description: msg,
        duration: 8000,
      });
      void Promise.resolve().then(() => {
        setError(msg);
        setJobId(null);
      });
      return;
    }

    if (jobStatus === 'cancelled') {
      const msg = t('extraction', 'extractionJobCancelledTitle');
      toast.error(msg);
      void Promise.resolve().then(() => {
        setError(msg);
        setJobId(null);
      });
    }
  // jobStatus is the key dep; jobResult/jobError/onSuccess captured by closure
  // at the time the effect fires — intentional, exhaustive-deps suppressed.
  }, [jobStatus]);  

  const extractSection = async (
    params: AsyncSectionExtractionParams,
  ): Promise<void> => {
    setKicking(true);
    setError(null);
    const result = await extractSectionAsync(params);
    if (!result.ok) {
      const msg = result.error.message;
      setKicking(false);
      setError(msg);
      toast.error(t('extraction', 'sectionExtractionErrorTitle'), {
        description: msg,
      });
      return;
    }
    // Set jobId BEFORE clearing kicking so `loading` never momentarily
    // reads false in the one-frame window between the two updates.
    setJobId(result.data.jobId);
    setKicking(false);
  };

  const polling =
    Boolean(jobId) &&
    jobStatus !== 'completed' &&
    jobStatus !== 'failed' &&
    jobStatus !== 'cancelled';
  const loading = kicking || polling;

  return {extractSection, loading, error};
}
