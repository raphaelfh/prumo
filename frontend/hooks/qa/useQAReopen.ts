/**
 * Both ways the QA screen reopens an article, owned in one place:
 *
 * - **Reopen for revision** (`finalized`): forks a NEW child run seeded from the
 *   published values (`POST /runs/{id}/reopen`). The session then resolves to
 *   that child, so local form values are dropped and the session refetched.
 * - **Reopen assessment** (`consensus`, arbitrator): sends the SAME run back to
 *   `extract`, discarding its consensus work (`POST /runs/{id}/reopen-extraction`,
 *   ADR-0017 — QA included since its 2026-09-10 amendment). Only the run detail
 *   changes, so refetching it is enough. The caller confirms through
 *   `ReopenExtractionDialog` first, whose open state lives here.
 *
 * Without the second path a QA run that entered consensus with nothing decided
 * could neither finalize nor go back. Promise chains, not try/finally, keep the
 * React Compiler happy.
 */

import { useState } from 'react';
import { toast } from 'sonner';

import { useReopenExtraction, useReopenRun } from '@/hooks/runs';
import { t } from '@/lib/copy';

interface UseQAReopenArgs {
  runId: string | undefined;
  /** Drop local form values — the forked revision carries its own seeded proposals. */
  resetValues: () => void;
  refetchSession: () => Promise<unknown>;
  refetchRun: () => Promise<unknown>;
}

export function useQAReopen({ runId, resetValues, refetchSession, refetchRun }: UseQAReopenArgs) {
  const reopenRunMutation = useReopenRun();
  const reopenToExtractMutation = useReopenExtraction();
  const [reopening, setReopening] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reopenRevision = async () => {
    if (!runId) return;
    setReopening(true);
    await reopenRunMutation
      .mutateAsync(runId)
      .then(async () => {
        resetValues();
        await refetchSession();
        toast.success(t('qa', 'reopenSuccess'));
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : t('qa', 'reopenError'));
      });
    setReopening(false);
  };

  const reopenToExtract = () => {
    if (!runId) return;
    void reopenToExtractMutation
      .mutateAsync(runId)
      .then(async () => {
        await refetchRun();
        setConfirmOpen(false);
        toast.success(t('qa', 'reopenAssessmentToast'));
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : t('qa', 'reopenError'));
      });
  };

  return {
    reopening,
    reopenRevision,
    confirmOpen,
    setConfirmOpen,
    reopenToExtract,
    reopenToExtractPending: reopenToExtractMutation.isPending,
  };
}
