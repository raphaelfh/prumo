/**
 * TanStack hooks for the PubMed import: the dry-run and start mutations, and
 * the run read the dialog polls. A finished run refreshes the whole screening
 * family (config, queue, PRISMA), because an import changes every count they
 * return.
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

/** No invalidation here: the queued run has written nothing yet. `useImportRun` refreshes on completion. */
export function useStartPubmedImport(projectId: string) {
  return useMutation<PubmedImportStarted, Error, string[]>({
    mutationFn: async (pmids) => {
      const result = await startPubmedImport(projectId, pmids);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

const isActive = (status: ImportRunRead['status'] | undefined) => status === 'pending' || status === 'running';

export function useImportRun(projectId: string, syncRunId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: screeningKeys.importRun(projectId, syncRunId ?? ''),
    enabled: Boolean(syncRunId),
    // No article writer (Zotero/RIS import, manual create, delete) invalidates
    // the screening keys: under the app's 5-minute staleTime a remount would
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

  const finished = query.data?.status === 'completed' || query.data?.status === 'failed';
  useEffect(() => {
    if (finished) void queryClient.invalidateQueries({queryKey: screeningKeys.project(projectId)});
  }, [finished, syncRunId, projectId, queryClient]);

  return query;
}
