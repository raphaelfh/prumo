/**
 * TanStack hooks for the PubMed import: the dry-run and start mutations, the
 * run read, and the tracker the project view mounts. The started run id lives
 * in `usePubmedImportRuns`, so leaving the tab or a tab-state change never
 * stops the tracking. A finished run refreshes the whole screening family
 * (config, queue, PRISMA), because an import changes every count they return.
 */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';

import {ApiError} from '@/integrations/api/client';
import {screeningKeys} from '@/lib/query-keys/screening';
import {
  dryRunPubmedImport,
  fetchImportRun,
  startPubmedImport,
  type ImportRunRead,
  type PubmedDryRunRead,
  type PubmedImportStarted,
} from '@/services/screeningService';
import {usePubmedImportRuns} from '@/stores/pubmedImportRuns';

const IMPORT_RUN_POLL_MS = 2000;

export function usePubmedDryRun(projectId: string) {
  return useMutation<PubmedDryRunRead, Error, string[]>({
    mutationFn: async (pmids) => {
      const result = await dryRunPubmedImport(projectId, pmids);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

/**
 * No invalidation here: the queued run has written nothing yet. The run id is
 * recorded at hook level, so it lands even if the dialog unmounted meanwhile.
 */
export function useStartPubmedImport(projectId: string) {
  const track = usePubmedImportRuns((state) => state.track);
  return useMutation<PubmedImportStarted, Error, string[]>({
    mutationFn: async (pmids) => {
      const result = await startPubmedImport(projectId, pmids);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: (started) => track(projectId, started.sync_run_id),
  });
}

/** The run the project is tracking, or null. */
export function useTrackedImportRunId(projectId: string): string | null {
  return usePubmedImportRuns((state) => state.runs[projectId]?.runId ?? null);
}

const isActive = (status: ImportRunRead['status'] | undefined) => status === 'pending' || status === 'running';

export function useImportRun(projectId: string, syncRunId: string | null) {
  return useQuery({
    queryKey: screeningKeys.importRun(projectId, syncRunId ?? ''),
    enabled: Boolean(syncRunId),
    // Writes made elsewhere (a co-reviewer's decision, another session's
    // import) never reach this cache: under the app's 5-minute staleTime a remount would
    // otherwise keep a pre-import run and its counts.
    refetchOnMount: 'always',
    // A run that is gone will not come back: do not retry its 404.
    retry: (failures, error) => !(error instanceof ApiError && error.status === 404) && failures < 1,
    // Poll only while the run is in flight. After an error TanStack keeps the
    // last `running` data, so the error itself must stop the poll (a 404 never recovers).
    refetchInterval: (q) => (!q.state.error && isActive(q.state.data?.status) ? IMPORT_RUN_POLL_MS : false),
    queryFn: async (): Promise<ImportRunRead> => {
      const result = await fetchImportRun(projectId, syncRunId ?? '');
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

/**
 * Mounted once for the whole project view: polls the tracked run and, when it
 * ends (completed, or failed with its partial import kept), refreshes the
 * screening family and calls `onFinished` once per run.
 */
export function useImportRunTracker(projectId: string, onFinished: () => void) {
  const queryClient = useQueryClient();
  const tracked = usePubmedImportRuns((state) => state.runs[projectId]);
  const settle = usePubmedImportRuns((state) => state.settle);
  const runId = tracked?.runId ?? null;
  const query = useImportRun(projectId, runId);
  const status = query.data?.status;
  const ended = !tracked?.settled && (status === 'completed' || status === 'failed');
  useEffect(() => {
    if (!ended || !runId) return;
    settle(projectId, runId);
    void queryClient.invalidateQueries({queryKey: screeningKeys.project(projectId)});
    onFinished();
  }, [ended, runId, projectId, settle, queryClient, onFinished]);
}
