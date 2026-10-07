/**
 * The run lifecycle both run screens share (extraction, quality assessment —
 * ADR-0018: QA mirrors extraction): the run view read, the worklist the
 * screen pages through, and every stage command behind the header —
 * Mark ready, Start consensus, consensus resolution, Approve & finalize
 * (ADR-0015), Reopen for revision and Reopen to extract (ADR-0017) — plus the
 * blind-review reveal (ADR-0012) and the compare view.
 *
 * Each command runs the same way, once: flush pending autosave (where the
 * command reads the reviewer's values) → call `runLifecycleService` →
 * invalidate the run's cache family and re-read the screen's own readers.
 * The kind-specific terms (copy, the transition gate, the extraction soft-warn)
 * come from `runScreenSpec` and `buildTransition`; a screen never restates them.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { useExpectedReviewerCount } from '@/hooks/runs/useExpectedReviewerCount';
import { useReviewerSummary, type ReviewerSummary } from '@/hooks/runs/useReviewerSummary';
import { useRunReviewers } from '@/hooks/runs/useRunReviewers';
import { useProjectWorklist } from '@/hooks/shared/useProjectArticlesQuery';
import type { ComparisonPermissions } from '@/hooks/shared/useComparisonPermissions';
import { t } from '@/lib/copy';
import type { ErrorResult } from '@/lib/error-utils';
import { deriveCanReopenExtraction } from '@/lib/extraction/reopenExtraction';
import { toConsensusValueEnvelope } from '@/lib/extraction/valueSemantics';
import { nextArticleTarget } from '@/lib/extraction/worklistNav';
import { buildTransition, type TransitionGate } from '@/lib/runs/buildTransition';
import { assessExtractionFinalize } from '@/lib/runs/extractionFinalizeGate';
import { runScreenSpec, type RunScreenKind } from '@/lib/runs/runScreenKind';
import { fetchRunView, runLifecycleService } from '@/services/runLifecycleService';
import { setManagerReviewVisibility } from '@/services/hitlConfigService';
import type { StageTransition } from '@/components/runs/header';
import type { RunHeaderValue } from '@/components/runs/header';
import type { ExtractionRunStage } from '@/types/ai-extraction';

import { runsKeys, type RunViewResponse } from './types';
import { coordKey } from '@/lib/runs/coord';

// =================== RUN VIEW ===================

/**
 * GET /runs/{id}/view — the aggregate both screens render from. The session
 * open seeds this cache entry, so the view is present on first paint.
 */
export function useRunView(runId: string | null | undefined) {
  return useQuery<RunViewResponse>({
    queryKey: runId ? runsKeys.detail(runId) : runsKeys.disabled,
    queryFn: async () => {
      const result = await fetchRunView(runId ?? '');
      if (!result.ok) throw result.error;
      return result.data;
    },
    enabled: Boolean(runId),
    staleTime: 30_000,
    retry: 1,
  });
}

// =================== WORKLIST ===================

/**
 * The project's article worklist and the moves through it: the header pager,
 * ⌘K, and where a finished form lands (the next article, or the project tab at
 * end-of-queue). `articleRoute` is the ONE place a screen states its route.
 */
export function useRunWorklist(p: {
  kind: RunScreenKind;
  projectId: string | undefined;
  articleId: string | undefined;
  articleRoute: (articleId: string) => string;
}) {
  const navigate = useNavigate();
  const { worklist, isLoading, error } = useProjectWorklist(p.projectId);
  const currentId = p.articleId ?? '';
  const exitRoute = `/projects/${p.projectId}?tab=${runScreenSpec(p.kind).projectTab}`;
  return {
    articles: worklist,
    isLoading,
    error,
    currentId,
    exitRoute,
    goToArticle: (articleId: string) => navigate(p.articleRoute(articleId)),
    goToNextArticle: () => {
      const nextId = nextArticleTarget(worklist, currentId);
      navigate(nextId ? p.articleRoute(nextId) : exitRoute);
    },
    exit: () => navigate(exitRoute),
  };
}

export type RunWorklist = ReturnType<typeof useRunWorklist>;

// =================== LIFECYCLE ===================

type LifecycleOp =
  | 'ready'
  | 'advance'
  | 'consensus'
  | 'approve-finalize'
  | 'reopen'
  | 'reopen-extraction';

interface CommandVariables {
  op: LifecycleOp;
  call: () => Promise<ErrorResult<unknown>>;
}

/** The term only one kind has: extraction gates on its form's completeness. */
type KindTerms =
  | {
      kind: 'extraction';
      formProgress: { isComplete: boolean; completed: number; total: number };
    }
  | { kind: 'qa' };

export type UseRunLifecycleScreenArgs = KindTerms & {
  projectId: string | undefined;
  runId: string | null;
  runDetail: RunViewResponse | undefined;
  permissions: ComparisonPermissions;
  currentUserId: string;
  /** Flush pending autosave; rejects when the flush failed. */
  saveNow: () => Promise<unknown>;
  goToNextArticle: () => void;
  /**
   * Coords the consensus panel names as owed — extraction's required fields
   * (also its finalize gate), QA's missing override rationales.
   */
  requiredCoords: string[];
  /** Re-resolve the session: a reopened revision is a NEW run. */
  refetchSession: () => Promise<unknown>;
  /** The screen's own readers to re-read after a command changed the run. */
  refreshReaders?: () => Promise<unknown>;
  /** A finalized run found by a separate lookup — the reopen target when the open run is not it. */
  finalizedRunId?: string | null;
  /** Extra affordance on a blocked primary click (the toast is shared). */
  onBlocked?: () => void;
};

const SUBMITTING_OPS: ReadonlySet<LifecycleOp> = new Set(['ready', 'advance', 'approve-finalize']);

const errorMessage = (err: unknown, fallback: string) =>
  (err instanceof Error && err.message) || fallback;

export function useRunLifecycleScreen(args: UseRunLifecycleScreenArgs) {
  const { kind, projectId, runId, runDetail, permissions, currentUserId } = args;
  const { saveNow, goToNextArticle, requiredCoords, refetchSession, refreshReaders } = args;
  const spec = runScreenSpec(kind);
  const queryClient = useQueryClient();

  const stage = (runDetail?.run.stage ?? null) as ExtractionRunStage | null;
  const finalized = stage === 'finalized';
  const inConsensusStage = stage === 'consensus';
  const parameters = runDetail?.run.parameters;
  const parentRunId =
    parameters && typeof parameters === 'object' && 'parent_run_id' in parameters
      ? String(parameters.parent_run_id)
      : null;

  // ---- Reviewers ----
  const reviewerSummary: ReviewerSummary = useReviewerSummary(runDetail);
  const reviewerProfiles = useRunReviewers(runId, { enabled: !!runId });
  // Role-derived "N of M reviewers" denominator (never the run's inert snapshot).
  const expectedReviewerCount = useExpectedReviewerCount(projectId, reviewerSummary.reviewers.length);
  const reviewersHeader: RunHeaderValue['reviewers'] = {
    count: reviewerSummary.reviewers.length,
    required: expectedReviewerCount,
    divergent: reviewerSummary.divergentCoords.size,
    ...(spec.readyHint && stage === 'extract' && runDetail
      ? { ready: runDetail.ready_count ?? 0, readyTotal: expectedReviewerCount }
      : {}),
  };

  // divergencesResolved: every diverging coord carries a consensus decision (a
  // no-divergence run is trivially resolved). isReady: the caller already
  // flagged themselves ready.
  const resolvedCoordKeys = new Set(
    (runDetail?.consensus_decisions ?? []).map((c) => coordKey(c.instance_id, c.field_id)),
  );
  const divergencesResolved = [...reviewerSummary.divergentCoords].every((c) =>
    resolvedCoordKeys.has(c),
  );
  const isReady = (runDetail?.reviewers_ready ?? []).includes(currentUserId);

  // ---- Commands: flush → command → invalidate, once ----
  const command = useMutation<unknown, Error, CommandVariables>({
    mutationFn: async ({ call }) => {
      const result = await call();
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
  const pendingOp = command.isPending ? command.variables?.op ?? null : null;

  const run = (op: LifecycleOp, call: () => Promise<ErrorResult<unknown>>) =>
    command.mutateAsync({ op, call });
  const flushed = () => saveNow().then(() => true).catch(() => false);
  const invalidateRun = (id: string | null = runId) =>
    id ? queryClient.invalidateQueries({ queryKey: runsKeys.detail(id) }) : Promise.resolve();
  // A refetch failure after a successful command is not the command's failure.
  const reread = () =>
    Promise.all([invalidateRun(), refreshReaders?.()]).catch(() => undefined);
  // The stage commands toast their own rejection (e.g. a backend gate refusal).
  const toastFailure = (fallback: string) => (err: unknown) => {
    toast.error(errorMessage(err, fallback));
    return false;
  };

  // "Finish" (reviewer): the advisory ready flag — the run stays in EXTRACT and
  // re-editing stays possible; then the next article opens.
  const onMarkReady = async () => {
    if (!runId || !(await flushed())) return;
    const ok = await run('ready', () => runLifecycleService.markReady(runId, { ready: true }))
      .then(() => true)
      .catch(toastFailure(t('extraction', 'errors_markReadyFailed')));
    if (!ok) return;
    await Promise.all([reread(), queryClient.invalidateQueries({ queryKey: runsKeys.reviewers(runId) })]);
    if (spec.markReadySuccess) toast.success(spec.markReadySuccess);
    goToNextArticle();
  };

  // "Start consensus" (arbitrator): EXTRACT → CONSENSUS. The backend
  // materializes reviewer decisions and auto-reveals a blind manager
  // (run-scoped), surfaced through peers_revealed on the re-read.
  const onOpenConsensus = async () => {
    if (!runId || !(await flushed())) return;
    const ok = await run('advance', () =>
      runLifecycleService.advance(runId, { target_stage: 'consensus' }),
    )
      .then(() => true)
      .catch(toastFailure(t('extraction', 'errors_advanceFailed')));
    if (ok) await reread();
  };

  const finalizeGate =
    kind === 'extraction'
      ? assessExtractionFinalize({ runDetail, reviewerSummary, requiredCoords, expectedReviewerCount })
      : null;

  // "Approve & finalize" (arbitrator): publish every agreed value, then
  // consensus → finalized, backend-atomic. Gate refusals toast; extraction
  // first confirms its soft-warn.
  const onApproveFinalize = async () => {
    if (!runId) return;
    if (finalizeGate?.warning.shouldWarn && !window.confirm(finalizeGate.warning.confirmMessage)) return;
    const ok = await run('approve-finalize', () => runLifecycleService.approveFinalize(runId))
      .then(() => true)
      .catch(toastFailure(t('extraction', 'errors_advanceFailed')));
    if (!ok) return;
    await reread();
    toast.success(spec.finalizeSuccess);
    goToNextArticle();
  };

  // Consensus resolution rejects on failure: the panel keeps its editor open.
  const resolve = async (body: Parameters<typeof runLifecycleService.createConsensus>[1]) => {
    if (!runId) return;
    await run('consensus', () => runLifecycleService.createConsensus(runId, body));
    await invalidateRun();
  };

  const onGuide = (message?: string) => {
    args.onBlocked?.();
    toast[spec.guideTone](message ?? spec.guideFallback);
  };

  const gate: TransitionGate =
    args.kind === 'extraction'
      ? {
          kind: 'extraction',
          ...args.formProgress,
          consensusComplete: finalizeGate?.requiredFieldsResolved ?? false,
        }
      : {
          kind: 'qa',
          // Nothing filled and nothing resolved: approve-finalize would 400.
          nothingRecorded: reviewerSummary.filledCoords.size === 0 && resolvedCoordKeys.size === 0,
        };
  const transition: StageTransition | null = buildTransition({
    stage,
    canResolveConflicts: permissions.canResolveConflicts,
    divergencesResolved,
    isReady,
    gate,
    onMarkReady,
    onOpenConsensus,
    onApproveFinalize,
    onGuide,
  });

  // ---- Reopen ----
  // For revision: forks a NEW child run seeded from the published values; the
  // session then resolves to it. The open run is the target when it is the
  // finalized one, so the button never silently no-ops while a separate
  // finalized-run lookup is in flight or failed.
  const reopenTargetId = args.finalizedRunId ?? (finalized ? runId : null);
  const [reopening, setReopening] = useState(false);
  const reopenRevision = async () => {
    if (!reopenTargetId) return;
    setReopening(true);
    await run('reopen', () => runLifecycleService.reopen(reopenTargetId))
      .then(async (child) => {
        await Promise.all([
          invalidateRun(reopenTargetId),
          invalidateRun((child as { id: string }).id),
        ]);
        await refetchSession();
        await refreshReaders?.();
        toast.success(spec.reopenSuccess);
      })
      .catch(toastFailure(spec.reopenError));
    setReopening(false);
  };

  // To extract (arbitrator, consensus only): the SAME run goes back to extract,
  // its consensus work discarded server-side. The caller confirms first.
  const [confirmReopenToExtract, setConfirmReopenToExtract] = useState(false);
  const reopenToExtract = () => {
    if (!runId) return;
    void run('reopen-extraction', () => runLifecycleService.reopenExtraction(runId))
      .then(async () => {
        await reread();
        setConfirmReopenToExtract(false);
        toast.success(spec.reopenToExtractSuccess);
      })
      .catch(toastFailure(spec.reopenError));
  };

  // ---- Reveal (ADR-0012) ----
  // The persistent project toggle, offered only to a blind manager DURING
  // extract; from consensus on the run-scoped auto-reveal covers it.
  const canReveal =
    permissions.userRole === 'manager' &&
    permissions.isBlindMode &&
    stage === 'extract' &&
    !runDetail?.peers_revealed;
  const onReveal = () => {
    void setManagerReviewVisibility(projectId ?? '', spec.reviewKind, true)
      .then(() => permissions.refresh())
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
  };

  // ---- Compare view ----
  // Peer values come from the server-blinded run view — offered only when the
  // caller may see peers AND peers exist. The consensus stage's resolve table
  // is the only compare surface there, so the toggle would be a dead control.
  const [compareChosen, setCompareChosen] = useState(false);
  const showPeerIdentity = !!runDetail?.peers_revealed || permissions.canSeeOthers;
  const peersVisible = spec.compareHonoursRunReveal ? showPeerIdentity : permissions.canSeeOthers;
  const compareAvailable =
    peersVisible && reviewerSummary.decisionsByCoord.size > 0 && !inConsensusStage;

  return {
    kind,
    stage,
    finalized,
    inConsensusStage,
    /** Set when this run is a revision of a finalized one. */
    parentRunId,
    /** Identity-visible callers see "Run by {name}"; blind reviewers stay timestamp-only. */
    showPeerIdentity,
    isReady,
    divergencesResolved,
    transition,
    /** Any primary command in flight (the header PrimaryAction spinner). */
    submitting: pendingOp !== null && SUBMITTING_OPS.has(pendingOp),
    reviewers: { summary: reviewerSummary, profiles: reviewerProfiles, header: reviewersHeader },
    compare: {
      available: compareAvailable,
      // Never strand the user on compare when the toggle disappears.
      active: compareAvailable && compareChosen,
      toggle: () => setCompareChosen((prev) => !prev),
      jumpToDivergence: compareAvailable ? () => setCompareChosen(true) : undefined,
    },
    consensus: {
      requiredCoords,
      resolvedCount: resolvedCoordKeys.size,
      onSelectExisting: (p: { instanceId: string; fieldId: string; decisionId: string }) =>
        resolve({
          instance_id: p.instanceId,
          field_id: p.fieldId,
          mode: 'select_existing',
          selected_decision_id: p.decisionId,
        }),
      onManualOverride: (p: { instanceId: string; fieldId: string; value: unknown; rationale: string }) =>
        resolve({
          instance_id: p.instanceId,
          field_id: p.fieldId,
          mode: 'manual_override',
          value: toConsensusValueEnvelope(p.value),
          rationale: p.rationale,
        }),
      onApproveFinalize,
      resolving: pendingOp === 'consensus',
      finalizing: pendingOp === 'approve-finalize' || pendingOp === 'advance',
    },
    reveal: { canReveal, onReveal },
    reopen: {
      canReopen: finalized || (!runId && !!args.finalizedRunId),
      reopening,
      reopenRevision,
      canReopenToExtract: deriveCanReopenExtraction(permissions.canResolveConflicts, stage),
      confirmOpen: confirmReopenToExtract,
      setConfirmOpen: setConfirmReopenToExtract,
      reopenToExtract,
      reopenToExtractPending: pendingOp === 'reopen-extraction',
    },
  };
}

export type RunLifecycleScreen = ReturnType<typeof useRunLifecycleScreen>;
