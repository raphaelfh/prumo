/** Coordinate-scoped section extraction; mounted subscribers own polling. */
import {useEffect, useRef, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';

import {useAuth} from '@/contexts/AuthContext';
import {ApiError} from '@/integrations/api/client';
import {t} from '@/lib/copy';
import {showExtractionErrorToast} from './helpers/showExtractionErrorToast';
import {extractionKeys} from '@/lib/query-keys';
import {articleExtractionValuesKeys} from '@/lib/query-keys/extraction';
import {runsKeys} from '@/hooks/runs/types';
import {extractSectionAsync, type AsyncSectionExtractionParams} from '@/services/sectionExtractionService';
import {useExtractionJob} from './useExtractionJob';
import {idleSectionJob, sectionJobKey, useSectionExtractionJobs, type SectionJobState} from '@/stores/sectionExtractionJobs';

export interface UseSectionExtractionReturn {
  extractSection: (params: AsyncSectionExtractionParams) => Promise<void>;
  getSectionState: (params: AsyncSectionExtractionParams) => SectionJobState;
  loading: boolean;
  error: string | null;
}

function isBusy(state: SectionJobState): boolean {
  return ['starting', 'pending', 'running'].includes(state.status);
}

function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}

export function useSectionExtraction(options?: {
  params?: AsyncSectionExtractionParams;
  onSuccess?: (runId: string, suggestionsCreated: number) => void;
}): UseSectionExtractionReturn {
  const {user} = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const records = useSectionExtractionJobs(state => state.records);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const scopedKey = options?.params && userId ? sectionJobKey({...options.params, userId}) : null;
  const getSectionState = (params: AsyncSectionExtractionParams): SectionJobState =>
    (userId && records[sectionJobKey({...params, userId})]) || idleSectionJob;

  // Explicit section subscribers only watch their coordinate. The backward
  // compatible unscoped API drains all outstanding session jobs, one polling
  // subscription at a time, so a second kickoff never drops the first result.
  const pending = Object.entries(records).find(([, record]) => record.userId === userId && isBusy(record) && record.jobId);
  const pollingKey = scopedKey ?? pending?.[0] ?? lastKey;
  const record = pollingKey ? records[pollingKey] : undefined;
  const active = record && record.userId === userId && isBusy(record) ? record : undefined;
  const jobQuery = useExtractionJob(active?.jobId ?? null);
  const onSuccess = options?.onSuccess;
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  const clearDeniedProject = (projectId: string, owner: string) => {
    const store = useSectionExtractionJobs.getState();
    if (store.ownerId !== owner) return;
    const denied = Object.values(store.records).filter(r => r.userId === owner && r.params.projectId === projectId);
    store.clearProject(owner, projectId);
    for (const item of denied) {
      if (item.jobId) queryClient.removeQueries({queryKey: extractionKeys.job(item.jobId)});
      if (item.params.runId) {
        queryClient.removeQueries({queryKey: runsKeys.detail(item.params.runId)});
      }
    }
  };

  useEffect(() => {
    if (!active?.requestId || !pollingKey) return;
    if (isAccessDenied(jobQuery.error)) {
      clearDeniedProject(active.params.projectId, active.userId);
      toast.error(t('extraction', 'sectionExtractionAccessDenied'));
      return;
    }
    const data = jobQuery.data;
    if (!data) return;
    const store = useSectionExtractionJobs.getState();
    if (data.status === 'pending' || data.status === 'running') {
      if (active.status !== data.status) store.update(pollingKey, active.requestId, {status: data.status});
      return;
    }
    if (data.status !== 'completed' && data.status !== 'failed' && data.status !== 'cancelled') return;
    const message = data.status === 'cancelled'
      ? t('extraction', 'extractionJobCancelledTitle')
      : data.error ?? t('extraction', 'extractionJobFailedTitle');
    if (!store.claimTerminal(pollingKey, active.requestId, {
      status: data.status,
      error: data.status === 'completed' ? null : {code: data.errorCode ?? null, message},
      uncertainTransport: false,
    })) return;

    if (data.status !== 'completed') {
      if (!showExtractionErrorToast(data.errorCode, message)) {
        toast.error(t('extraction', 'sectionExtractionErrorTitle'), {description: message, duration: 8000});
      }
      return;
    }
    const created = data.result?.suggestionsCreated ?? data.result?.totalSuggestionsCreated ?? 0;
    const runId = active.params.runId ?? data.result?.extractionRunId;
    if (created === 0) {
      toast.info(t('extraction', 'sectionExtractionNoSuggestionsTitle'), {
        description: t('extraction', 'sectionExtractionNoSuggestionsDesc'), duration: 6000,
      });
    } else {
      toast.success(t('extraction', 'sectionExtractionSuccessTitle').replace('{{n}}', String(created)));
    }
    if (runId) {
      // RunView is server-computed: refetch it, never patch its instances/proposals.
      void queryClient.invalidateQueries({queryKey: runsKeys.detail(runId)});
    }
    void queryClient.invalidateQueries({queryKey: articleExtractionValuesKeys.byCaller(active.params.projectId, active.params.templateId, active.userId)});
    void Promise.resolve().then(() => onSuccessRef.current?.(data.result?.extractionRunId ?? runId ?? '', created))
      .catch((error: unknown) => console.error('[useSectionExtraction] onSuccess error:', error));
  }, [active, pollingKey, jobQuery.data, jobQuery.error, queryClient]);

  const extractSection = async (params: AsyncSectionExtractionParams): Promise<void> => {
    if (!userId) return;
    const store = useSectionExtractionJobs.getState();
    const started = store.begin(userId, params);
    if (!started?.requestId) return;
    const key = sectionJobKey({...params, userId});
    setLastKey(key);
    const result = await extractSectionAsync({...started.params, requestId: started.requestId});
    // Auth reset/access denial may have discarded the record while POST ran.
    if (useSectionExtractionJobs.getState().records[key]?.requestId !== started.requestId) return;
    if (!result.ok) {
      if (isAccessDenied(result.error)) {
        clearDeniedProject(params.projectId, userId);
        toast.error(t('extraction', 'sectionExtractionAccessDenied'));
        return;
      }
      const error = result.error;
      const code = error instanceof ApiError ? error.code : null;
      // No trustworthy rejection: the server may have already enqueued it.
      const uncertainTransport = !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
      if (!store.update(key, started.requestId, {status: 'failed', error: {code, message: error.message}, uncertainTransport})) return;
      if (!showExtractionErrorToast(code, error.message)) toast.error(t('extraction', 'sectionExtractionErrorTitle'), {description: error.message});
      return;
    }
    store.update(key, started.requestId, {jobId: result.data.jobId, status: 'pending'});
  };

  const selected = scopedKey ? records[scopedKey] : lastKey ? records[lastKey] : undefined;
  return {
    extractSection, getSectionState,
    loading: scopedKey ? Boolean(selected && isBusy(selected)) : Object.values(records).some(r => r.userId === userId && isBusy(r)),
    error: selected?.userId === userId ? selected?.error?.message ?? null : null,
  };
}
