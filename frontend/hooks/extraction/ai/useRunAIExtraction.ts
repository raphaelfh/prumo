/**
 * Run AI extraction over an *existing* Run — async Celery-job version.
 *
 * The POST to ``/api/v1/extraction/sections`` now returns 202 + ``{ job_id }``
 * instead of a synchronous result. This hook:
 *
 *   1. POSTs to kick off the job → stores the returned ``jobId``.
 *   2. Drives ``useExtractionJob`` which polls every 2 s until terminal.
 *   3. On ``completed`` → calls ``onSuccess`` + success toast, then clears
 *      the job id (stops polling).
 *   4. On ``failed`` / ``cancelled`` → error toast, then clears.
 *
 * Public API is unchanged: ``{ extractForRun, loading, error }`` so
 * callers (ExtractionFullScreen, QA header) need no edits.
 *
 * React Compiler note: no try/finally or throw in this hook body.
 * All IO is in the service layer (extractForRun / getExtractionJobStatus).
 */

import {useEffect, useRef, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {t} from '@/lib/copy';
import {jobErrorToast} from '@/lib/ai-extraction/jobErrorToast';
import {extractionKeys} from '@/lib/query-keys';
import {
  extractForRun as extractForRunService,
  type ExtractForRunRequest,
} from '@/services/extractionRunService';
import {useExtractionJob} from '@/hooks/extraction/useExtractionJob';
import type {components} from '@/types/api/schema';

type ExtractionJobResult = components['schemas']['ExtractionJobResult'];

export interface UseRunAIExtractionReturn {
  extractForRun: (params: ExtractForRunRequest) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useRunAIExtraction(options?: {
  onSuccess?: () => Promise<void> | void;
}): UseRunAIExtractionReturn {
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
  const jobErrorCode = jobQuery.data?.errorCode;

  // React to terminal job state. setState is placed inside async callbacks
  // (Promise.resolve().then()) to satisfy the react-hooks/set-state-in-effect rule.

  useEffect(() => {
    if (!jobId || !jobStatus) return;

    if (jobStatus === 'completed') {
      const created =
        jobResult?.totalSuggestionsCreated ?? jobResult?.suggestionsCreated ?? 0;
      const successful = jobResult?.successfulSections ?? 0;
      const total = jobResult?.totalSections ?? 0;
      toast.success(t('extraction', 'fullAICompleteSuccessTitle'), {
        description: `${created} suggestion(s) created across ${successful}/${total} sections.`,
      });
      void queryClient.invalidateQueries({queryKey: extractionKeys.all});
      // Run onSuccess then clear state asynchronously to satisfy lint rule.
      void Promise.resolve(onSuccessRef.current?.())
        .catch((err: unknown) => {
          console.error('[useRunAIExtraction] onSuccess error:', err);
        })
        .then(() => {
          setJobId(null);
          setError(null);
        });
      return;
    }

    if (jobStatus === 'failed') {
      const msg = jobError ?? t('extraction', 'extractionJobFailedTitle');
      // A classified backend code gets specific copy; otherwise fall back to
      // the generic "AI extraction failed" toast.
      const specific = jobErrorToast(jobErrorCode, msg);
      if (specific) {
        toast.error(specific.title, {
          description: specific.description,
          duration: specific.duration,
        });
      } else {
        toast.error(t('extraction', 'extractionJobFailedTitle'), {
          description: msg,
          duration: 8000,
        });
      }
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

  const extractForRun = async (params: ExtractForRunRequest): Promise<void> => {
    setKicking(true);
    setError(null);
    const result = await extractForRunService(params);
    if (!result.ok) {
      const msg = result.error.message;
      setKicking(false);
      setError(msg);
      toast.error(`${t('extraction', 'fullAIErrorPrefix')}: ${msg}`, {
        duration: 8000,
      });
      return;
    }
    // Set jobId BEFORE clearing kicking so `loading` never momentarily
    // reads false in the one-frame window between the two updates.
    setJobId(result.data.jobId);
    setKicking(false);
  };

  // loading = kickoff in flight OR job is actively polling (pending|running)
  const polling =
    Boolean(jobId) &&
    jobStatus !== 'completed' &&
    jobStatus !== 'failed' &&
    jobStatus !== 'cancelled';
  const loading = kicking || polling;

  return {extractForRun, loading, error};
}
