/**
 * Full-screen data extraction interface
 *
 * Main page where the user extracts data from a specific article.
 * Uses full-screen layout with PDF viewer beside extraction form.
 *
 * Features:
 * - PDF viewer with toggle
 * - Section-based extraction form
 * - Automatic auto-save
 * - Multi-user collaboration (popover + grid)
 * - AI suggestions (prefill + badge)
 * - Progress tracking
 *
 * @page
 */

import {useEffect, useMemo, useRef, useState} from 'react';
import {useNavigate, useParams} from 'react-router';
import {toast} from 'sonner';
import {extractionInstanceService} from '@/services/extractionInstanceService';
import {extractionLogger} from '@/lib/extraction/observability';
import {useEntityTypePartition} from '@/lib/extraction/entityTypeRoles';
import {DEFAULT_ENTRY_NOUN} from '@/lib/extraction/entryKey';
import {useAiLinkMaps} from '@/hooks/runs/useAiLinkMaps';
import {isRunEditable} from '@/lib/runs/editability';
import {firstPendingInstanceId, scrollToSectionById} from '@/lib/runs/suggestionLocate';
import {entityTypesFromRunView, instancesFromRunView} from '@/lib/extraction/runViewAdapters';
import {resolveExtractionViewState} from '@/lib/extraction/extractionViewState';
import {RunSplitShell} from '@/components/runs/RunSplitShell';
import {RunEditabilityProvider} from '@/components/runs/RunEditabilityContext';
import {usePdfPanel} from '@/hooks/usePdfPanel';
import {Button} from '@/components/ui/button';
import {Loader2} from 'lucide-react';
import {HITLPublishedBanner} from '@/components/runs/HITLStatusBadges';
import {buildExtractionTransition} from '@/lib/extraction/stageTransition';
import {nextArticleTarget} from '@/lib/extraction/worklistNav';
import {setManagerReviewVisibility} from '@/services/hitlConfigService';
import {useSidebar} from '@/contexts/SidebarContext';

// Hooks
import {useExtractionData} from '@/hooks/extraction/useExtractionData';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {useExtractedValues} from '@/hooks/extraction/useExtractedValues';
import {useExtractionSession} from '@/hooks/extraction/useExtractionSession';
import {useFinalizedExtractionRun} from '@/hooks/extraction/useFinalizedExtractionRun';
import {useExtractionProgress} from '@/hooks/extraction/useExtractionProgress';
import {useAutoSaveProposals} from '@/hooks/runs';
import {useAISuggestions} from '@/hooks/extraction/ai/useAISuggestions';
import {useRunAIExtraction} from '@/hooks/extraction/ai/useRunAIExtraction';
import {countActionableSuggestions} from '@/lib/ai-extraction/suggestionUtils';
import {useComparisonPermissions} from '@/hooks/shared/useComparisonPermissions';
import {
  useAdvanceRun,
  useApproveFinalize,
  useCreateConsensus,
  useMarkReady,
  useReopenExtraction,
  useReopenRun,
  useReviewerSummary,
  useRun,
  useRunReviewers,
} from '@/hooks/runs';
import {ConsensusResolutionPanel} from '@/components/runs/ConsensusResolutionPanel';
import {useConsensusReconciliation} from '@/hooks/extraction/useConsensusReconciliation';
import {toConsensusValueEnvelope} from '@/lib/extraction/valueSemantics';

// Components
import {ExtractionHeader} from '@/components/extraction/ExtractionHeader';
import {RunPdfContent} from '@/components/runs/RunPdfContent';
import {ExtractionFormPanel} from '@/components/extraction/ExtractionFormPanel';
import {AddModelDialog, RemoveModelDialog} from '@/components/extraction/hierarchy';
import {
  AddEntryDialog,
  RenameEntryDialog,
  type EntryIdentityChanges,
} from '@/components/extraction/AddEntryDialog';
import {ReopenExtractionDialog} from '@/components/extraction/dialogs/ReopenExtractionDialog';
import {deriveCanReopenExtraction} from '@/lib/extraction/reopenExtraction';
import {FullAIExtractionProgress} from '@/components/extraction/FullAIExtractionProgress';

// Additional hooks
import {useModelManagement} from '@/hooks/extraction/useModelManagement';
import {useAddEntry} from '@/hooks/extraction/useAddEntry';
import {useUpdateInstanceIdentity} from '@/hooks/extraction/useUpdateInstanceIdentity';
import {displayEntryKey, entryKeyOf, keyFieldOf} from '@/lib/extraction/entryKey';
import {usePreserveScroll} from '@/hooks/usePreserveScroll';
import {t} from '@/lib/copy';
import {createViewerStore, subscribeReaderLocate} from '@prumo/pdf-viewer';

const SCROLL_CONTAINERS_TO_PRESERVE = [
  // Form panel — actual scroll happens on radix' inner viewport node.
  '[data-scroll-container="extraction-form"] [data-radix-scroll-area-viewport]',
  // PDF viewer scroll container (Viewer.Body).
  '[data-scroll-container="true"]',
];

// =================== COMPONENT ===================

export default function ExtractionFullScreen() {
  const { projectId, articleId } = useParams();
  const navigate = useNavigate();
  // App navigation sidebar (provided by RunWorkspaceShell). SidebarToggle + ⌘B
  // collapse the desktop sidebar (lg+); toggleMobile opens the drawer below lg.
  const { sidebarCollapsed, toggleSidebar, toggleMobile } = useSidebar();

  // ONE stable viewer store shared between the PDF panel and the form panel.
  // useState lazy initializer creates the store exactly once per mount —
  // the React-Compiler-approved pattern. RunSplitShell wraps both panels in a
  // single <ViewerProvider store={viewerStore}>, and RunPdfContent
  // receives store={viewerStore}, so the form-panel evidence popover and the
  // PDF reader resolve the SAME store — the prerequisite for the
  // click-evidence → highlight feature.
  const [viewerStore] = useState(createViewerStore);

  // Load page-bootstrap data using dedicated hook (SRP). Entity types +
  // instances are NOT read here anymore — they are derived from the
  // server RunView (runDetail) below via the adapters.
  const {
    article,
    template,
    articles,
    loading,
    error: dataError,
  } = useExtractionData({
    projectId,
    articleId,
    enabled: !!projectId && !!articleId,
  });

  // Local state
  // Current reviewer id from AuthContext (zero network) — was a
  // supabase.auth.getUser() round-trip + a serial gate on run open.
  const { userId } = useCurrentUser();
  const currentUserId = userId ?? '';

  // UI state
  const pdf = usePdfPanel({ initialOpen: false });
  const [viewMode, setViewMode] = useState<'extract' | 'compare'>('extract');

  // A citation-locate (from an AI-suggestion popover) reveals the document panel
  // if collapsed, so the reader can scroll + flash the cited passage.
  // `usePdfPanel.open` is a fresh closure each render; hold it in a ref and
  // subscribe ONCE per store so a citation-locate reveals the PDF panel without
  // re-subscribing every render. Cleanup via return (React Compiler).
  const openPdfRef = useRef(pdf.open);
  useEffect(() => {
    openPdfRef.current = pdf.open;
  }, [pdf.open]);
  useEffect(() => subscribeReaderLocate(viewerStore, () => openPdfRef.current()), [viewerStore]);

    // AI extraction progress state
  const [aiExtractionState, setAiExtractionState] = useState<{
    loading: boolean;
    progress: any;
  } | null>(null);
  const [isProgressMinimized, setIsProgressMinimized] = useState(false);
  
  // Hierarchy state
  const [showAddModelDialog, setShowAddModelDialog] = useState(false);
  const [modelToRemove, setModelToRemove] = useState<{
    id: string; 
    name: string;
    hasData: boolean;
    fieldsCount: number;
  } | null>(null);

  // Open / resume the HITL session for this (article × project_template).
  // Mirrors the QA flow: the backend ensures an extraction Run exists,
  // seeds top-level instances if missing, and parks it in `extract` so
  // the autosave (which persists the user's own values) can fire immediately.
  const sessionResult = useExtractionSession({
    projectId,
    articleId,
    projectTemplateId: template?.id,
    enabled: !!projectId && !!articleId && !!template?.id,
  });
  const activeRunId = sessionResult.session?.runId ?? null;

  // Detail fetch on the active run — drives the "Revision" badge when
  // `parameters.parent_run_id` is present, the stage-aware read path of
  // useExtractedValues, and the reviewer-summary + ConsensusPanel below.
  // The view also carries the frozen-snapshot ``entity_types`` + the
  // materialised ``instances`` — the single source of truth for the form.
  // The session embed seeds this cache on open, so ``runDetail`` is present
  // on first paint and the derived memos populate immediately.
  const {
    data: runDetail,
    refetch: refetchRun,
    isError: runIsError,
    error: runErrorObj,
  } = useRun(activeRunId ?? null, { enabled: !!activeRunId });

  // Entity types + instances are derived from the view (not direct
  // Supabase). ``entityTypesFromRunView`` / ``instancesFromRunView`` are
  // pure adapters; the memos keep references stable across renders that
  // don't change ``runDetail``.
  const entityTypes = useMemo(
    () => (runDetail ? entityTypesFromRunView(runDetail) : []),
    [runDetail],
  );
  const instances = useMemo(
    () => (runDetail ? instancesFromRunView(runDetail) : []),
    [runDetail],
  );

  const stage = (runDetail?.run.stage ?? null) as import('@/types/ai-extraction').ExtractionRunStage | null;
  const isFinalized = stage === 'finalized';

  // Hook to manage extracted values — read path branches on stage.
  const {
    values,
    loadedValues,
    updateValue,
    loading: valuesLoading,
    initialized: valuesInitialized,
    refresh: refreshValues,
  } = useExtractedValues({
    runId: activeRunId,
    stage,
    currentValues: runDetail?.current_values,
    publishedStates: runDetail?.published_states,
    currentUserId,
    enabled: !!activeRunId,
  });

  // Reopen wiring: when the active run is finalized, surface the reopen
  // affordance. The reopen mutation creates a new EXTRACT-stage run with
  // proposals seeded from the published values.
  const {
    finalizedRun,
    refresh: refreshFinalizedRun,
  } = useFinalizedExtractionRun({
    articleId: articleId || '',
    projectTemplateId: template?.id ?? null,
    enabled: !!articleId && !!template?.id && (!activeRunId || isFinalized),
  });
  const reopenMutation = useReopenRun();
  const [reopening, setReopening] = useState(false);
  const reopenExtractionMutation = useReopenExtraction();
  const [reopenExtractionOpen, setReopenExtractionOpen] = useState(false);
  const parentRunId =
    runDetail?.run.parameters &&
    typeof runDetail.run.parameters === 'object' &&
    'parent_run_id' in runDetail.run.parameters
      ? String(runDetail.run.parameters.parent_run_id)
      : null;

  // Multi-reviewer state: count, divergence, profiles.
  const reviewerSummary = useReviewerSummary(runDetail);
  const reviewerProfiles = useRunReviewers(activeRunId ?? null, {
    enabled: !!activeRunId,
  });

  // Mutations needed for consensus resolution + finalize.
  const advanceMutation = useAdvanceRun(activeRunId ?? '');
  const consensusMutation = useCreateConsensus(activeRunId ?? '');
  // Per-reviewer ready flag (advisory; does not advance) + the one-action
  // consensus → finalized (publish-all then advance, backend-atomic).
  const markReady = useMarkReady(activeRunId ?? '');
  const approveFinalize = useApproveFinalize(activeRunId ?? '');
  // The header PrimaryAction spinner reflects any in-flight primary mutation.
  const submitting =
    markReady.isPending || advanceMutation.isPending || approveFinalize.isPending;

  const inConsensusStage = runDetail?.run.stage === 'consensus';

  // Consensus-page derived values: required coords, run-level completeness, expected reviewer count, finalize warning.
  const {
    requiredCoords,
    requiredFieldsResolved,
    expectedReviewerCount,
    finalizeWarning,
  } = useConsensusReconciliation({
    runDetail,
    reviewerSummary,
    instances,
    entityTypes,
    projectId,
  });

  const handleSelectExisting = async (params: {
    instanceId: string;
    fieldId: string;
    decisionId: string;
  }) => {
    await consensusMutation.mutateAsync({
      instance_id: params.instanceId,
      field_id: params.fieldId,
      mode: 'select_existing',
      selected_decision_id: params.decisionId,
    });
    await refetchRun();
  };

  const handleManualOverride = async (params: {
    instanceId: string;
    fieldId: string;
    value: unknown;
    rationale: string;
  }) => {
    await consensusMutation.mutateAsync({
      instance_id: params.instanceId,
      field_id: params.fieldId,
      mode: 'manual_override',
      value: toConsensusValueEnvelope(params.value),
      rationale: params.rationale,
    });
    await refetchRun();
  };

  // Where a finished form lands: the next article in the worklist, or the
  // project's extraction tab at end-of-queue. Shared by the reviewer's
  // mark-ready and the arbitrator's terminal approve-finalize — both mean
  // "done with this article".
  const goToNextArticle = () => {
    const nextId = nextArticleTarget(articles, articleId ?? '');
    navigate(
      nextId
        ? `/projects/${projectId}/extraction/${nextId}`
        : `/projects/${projectId}?tab=extraction`,
    );
  };

  // "Approve & finalize": one action that publishes every agreed coord then
  // advances consensus → finalized (backend-atomic). The backend gate rejections
  // (unresolved divergence / incomplete required fields) surface via
  // useApproveFinalize.onError as a toast; the promise-chain guard (no try/finally)
  // keeps the React Compiler happy and skips the success path on failure.
  // Soft-warn: pre-built by useConsensusReconciliation; one line here.
  const handleApproveFinalize = async () => {
    if (!activeRunId) return;
    if (finalizeWarning.shouldWarn && !window.confirm(finalizeWarning.confirmMessage)) return;
    const ok = await approveFinalize.mutateAsync().then(() => true).catch(() => false);
    if (!ok) return;
    await Promise.all([refetchRun(), refreshValues(), refreshFinalizedRun()]);
    toast.success(t('pages', 'extractionScreenFinalizeSuccess'));
    goToNextArticle();
  };

  // Plain-identifier dep so the compiler can track this dep without
  // optional-chaining (optional-chained deps like `finalizedRun?.id` defeat it).
  // Fallback to the active run: when the open run IS finalized, it is the
  // reopen target — clicking the banner button during (or after a failure
  // of) the separate finalized-run lookup must not silently no-op
  // (2026-07-02 hardening finding).
  const finalizedRunId = finalizedRun?.id;
  const stageIsFinalized = stage === 'finalized';
  const reopenTargetId = finalizedRunId ?? (stageIsFinalized ? activeRunId : null);
  const handleReopen = async () => {
    if (!reopenTargetId) return;
    setReopening(true);
    await reopenMutation.mutateAsync(reopenTargetId).then(async () => {
      // The reopen endpoint creates a fresh EXTRACT-stage run linked via
      // parameters.parent_run_id. We refetch the HITL session first so
      // activeRunId points at the new child run; only then do the
      // value / runDetail / finalized-run reads run against the new
      // coordinate. Without the session refetch the banner stays stuck
      // on the finalized run and the revision badge never appears.
      await sessionResult.refetch();
      await Promise.all([refreshValues(), refreshFinalizedRun(), refetchRun()]);
      toast.success(t('pages', 'extractionScreenReopenSuccess'));
    }).catch((err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : t('pages', 'extractionScreenReopenError'),
      );
    });
    setReopening(false);
  };

  // Consensus -> extract on the SAME run (arbitrator-only). The mutation discards
  // this run's consensus work server-side; refetch the run detail (stage + cleared
  // consensus rows) and the form values so the screen re-renders as EXTRACT.
  const handleReopenExtraction = () => {
    if (!activeRunId) return;
    void reopenExtractionMutation
      .mutateAsync(activeRunId)
      .then(async () => {
        await Promise.all([refreshValues(), refetchRun()]);
        setReopenExtractionOpen(false);
        toast.success(t('extraction', 'reopenExtractionToast'));
      })
      .catch((err: unknown) => {
        toast.error(
          err instanceof Error ? err.message : t('pages', 'extractionScreenReopenError'),
        );
      });
  };

  // Hook to compute progress. Pass the materialized instances so optional
  // cardinality='many' entities with no instances (e.g. no prediction models
  // added) and their child sections don't strand the form below the finalize
  // gate — the "40%, can't submit" bug.
  const { completedFields, totalFields, completionPercentage, isComplete } =
    useExtractionProgress(values, entityTypes, instances);

  // Captures the scroll position of the form + PDF panels around async
  // refreshes so the user does not get bounced back to the top after an AI
  // extraction completes. See usePreserveScroll for the rAF dance.
  const preserveScroll = usePreserveScroll(SCROLL_CONTAINERS_TO_PRESERVE);

    // Permissions hook (controls comparison access + the viewer write gate) —
    // declared before the autosave hook, whose `enabled` reads the role.
  const permissions = useComparisonPermissions(
    projectId || '',
    currentUserId,
    'extraction'
  );

    // Hook for AI suggestions with callbacks to fill/clear field. Declared
    // BEFORE useAutoSaveProposals: autosave consumes aiLinkByKey (below),
    // which derives from this hook's sessionAdoption.
  const handleAISuggestionAccepted = async (instanceId: string, fieldId: string, value: any) => {
      // Fill field automatically when suggestion is accepted.
      // NOTE: accepting makes NO backend call here. updateValue writes the
      // value into form state and useAutoSaveProposals persists it as this
      // reviewer's `edit` decision — carrying proposal_record_id via
      // linkByKey (D0) so the adoption is traceable in consensus. The
      // suggestion's status flip is optimistic; on reload the server
      // re-resolves status from the caller's decisions. (refreshValues is
      // deliberately avoided; it caused a full-page reload.)
    updateValue(instanceId, fieldId, value);
  };

  const handleAISuggestionRejected = async (instanceId: string, fieldId: string) => {
      // Clear the field when a suggestion is rejected. Same as accept: no
      // direct backend call — updateValue writes null into form state and
      // autosave persists the cleared value (with the coord's AI link
      // severed via the sessionAdoption tombstone).
    updateValue(instanceId, fieldId, null);
  };

  const {
    suggestions: aiSuggestions,
    sessionAdoption,
    suggestionsReady: aiSuggestionsReady,
    acceptSuggestion,
    selectSuggestion,
    rejectSuggestion,
    getSuggestionsHistory,
    refresh: refreshAISuggestions,
  } = useAISuggestions({
    articleId: articleId || '',
    runId: activeRunId ?? undefined,
    // Wait for the session to resolve a run before issuing the
    // suggestion query — otherwise the first render fires a global
    // (no runId) lookup that immediately gets superseded by the
    // run-scoped one. Pure waste; same UX outcome.
    enabled: !!articleId && !!projectId && !!activeRunId,
    onSuggestionAccepted: handleAISuggestionAccepted,
    onSuggestionRejected: handleAISuggestionRejected
  });

  // D0: coords whose value has a traceable AI basis — see useAiLinkMaps for
  // the layer semantics and the never-from-status invariant.
  const { aiLinkByKey, persistedAiLinkByKey } = useAiLinkMaps({
    decisions: runDetail?.decisions,
    currentUserId,
    sessionAdoption,
  });

    // Auto-save hook — in the editable `extract` stage this extraction page
    // writes per-user ``ReviewerDecision`` rows (decision='edit'); it never
    // writes in `consensus` or any later stage (WRITABLE_STAGES gates it).
    // Each reviewer's typing lands in their own decision stream and the run
    // view's ``currentValues`` are resolved per reviewer_id (Layer 2 of the
    // multi-reviewer blind fix).
    //
    // No-op until the session is open and the run is in a writable
    // stage. The hook flushes pending edits on unmount, ``pagehide``,
    // and visibility changes so navigating mid-debounce never drops a
    // save.
  const { saveState, lastSavedAt, saveNow } = useAutoSaveProposals({
    runId: activeRunId,
    stage,
    values,
    // Server-loaded values are the baseline — opening a run must not re-POST
    // them as fresh proposals (the re-record-on-mount duplication).
    baselineValues: loadedValues,
    // D0: stamp edit decisions with the accepted/selected AI proposal id;
    // the persisted map is the link-side baseline (same-value adoptions
    // still write — the human selection event is append-only recorded).
    linkByKey: aiLinkByKey,
    baselineLinkByKey: persistedAiLinkByKey,
    // Only the editable EXTRACT stage accepts autosave writes. Past that
    // (consensus, finalized, pending) the backend rejects writes, which
    // surfaced as a spurious "Error saving data automatically" toast on
    // opening a consolidated run. Mirrors the QA full-screen gate;
    // ``!isFinalized`` alone let ``consensus`` through.
    enabled:
      !!activeRunId &&
      !loading &&
      valuesInitialized &&
      isRunEditable(stage) &&
      // Viewer writes 403 server-side; never fire them (forms render
      // read-only via forceReadOnly, this is the flush-path belt).
      permissions.userRole !== 'viewer',
  });

    // "Finish extraction" (reviewer) — flush pending autosave, set the per-reviewer
    // ready flag (advisory; does NOT advance the run), then open the next article
    // in the worklist. The run stays in EXTRACT — the manager opens consensus
    // separately. Re-editing after marking ready stays possible (autosave is live
    // in EXTRACT); the flag is advisory and not auto-cleared. Promise-chain guards
    // (no try/finally) keep the React Compiler happy. Declared after
    // `useAutoSaveProposals` so the closure picks up the initialized `saveNow`.
  const onMarkReady = async () => {
    if (!activeRunId) return;
    const saved = await saveNow().then(() => true).catch(() => false);
    if (!saved) return;
    const ok = await markReady
      .mutateAsync({ ready: true })
      .then(() => true)
      .catch(() => false);
    if (!ok) return;
    goToNextArticle();
  };

    // "Start consensus" (manager/consensus) — flush autosave, then advance
    // EXTRACT → CONSENSUS so the evaluate-all surface becomes reachable. A blind
    // manager is auto-revealed server-side on consensus entry (run-scoped), surfaced
    // via runDetail.peers_revealed after the refetch below.
  const onOpenConsensus = async () => {
    if (!activeRunId) return;
    const saved = await saveNow().then(() => true).catch(() => false);
    if (!saved) return;
    const ok = await advanceMutation
      .mutateAsync({ target_stage: 'consensus' })
      .then(() => true)
      .catch(() => false);
    if (!ok) return;
    await refetchRun().catch(() => undefined);
  };

    // Other reviewers' values for the compare view come from the shared,
    // server-blinded runDetail (reviewerSummary.decisionsByCoord) — no
    // separate fetch. Compare is offered only when the caller may see peers
    // (manager/consensus, per the live setting) AND peers actually exist.
  // peers_revealed (backend, run-scoped) OR the persistent per-kind setting:
  // a manager auto-revealed on consensus entry sees the compare surface without
  // flipping the project toggle. Keep the size>0 guard so we never show an empty grid.
  const canCompare =
    (runDetail?.peers_revealed || permissions.canSeeOthers) &&
    reviewerSummary.decisionsByCoord.size > 0;

  // Manager reveal (the persistent project-toggle): offered only to a blind
  // manager DURING extract. Once the run reaches consensus the run-scoped
  // auto-reveal covers it, so the persistent toggle is no longer surfaced.
  // Promise-chain form (no try/finally) satisfies the React Compiler.
  const canReveal =
    permissions.userRole === 'manager' &&
    permissions.isBlindMode &&
    stage === 'extract' &&
    !runDetail?.peers_revealed;
  const onReveal = () => {
    void setManagerReviewVisibility(projectId || '', 'extraction', true)
      .then(() => permissions.refresh())
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
  };

  // Shared actionable count (ADR-0016 Phase 4): unresolved AI proposals awaiting
  // a human decision — an abstention ("no information") counts, resolved ones
  // don't. Memoized: this screen re-renders on every field keystroke.
  const aiPendingCount = useMemo(
    () => countActionableSuggestions(aiSuggestions),
    [aiSuggestions],
  );

  // AI extraction always runs on the OPEN session run (``extractForRun``
  // reuses it, preserving human decisions). The old run-less ``extractFullAI``
  // fallback is gone: it forked a parallel run that shadowed the reviewer's
  // saved decisions on refresh (the silent data-loss bug). The button is gated
  // on ``activeRunId`` (see ``canRunAI``), so a session must be open first.
  const { extractForRun, loading: extractingAI } = useRunAIExtraction({
    onSuccess: async () => {
      await handleExtractionComplete();
    },
  });

  // Handler wired to RunHeader.AIActions — mirrors HeaderMoreMenu.handleFullAIExtraction.
  const onExtractWithAI = () => {
    if (!articleId || !template?.id) {
      console.warn('[ExtractionFullScreen] articleId or templateId not provided for AI extraction');
      return;
    }
    // Belt-and-suspenders: never fire a run-less extraction (the orphaning
    // bug). The button is already disabled until the session run resolves.
    if (!activeRunId) return;
    void extractForRun({
      projectId: projectId ?? '',
      articleId,
      templateId: template.id,
      runId: activeRunId,
    }).catch((error: unknown) => {
      console.error('[ExtractionFullScreen] Run AI extraction error:', error);
    });
  };

  // Partition entity types into study-level + model container + per-model
  // children by structural role. The partition function is the single
  // source of truth — no more ``name === 'prediction_models'`` lookups
  // sprinkled across the codebase.
  const {
    studyLevel: studyLevelSections,
    modelContainer: modelParentEntityType,
    modelChildren: modelChildSections,
  } = useEntityTypePartition(entityTypes);

  // The model-container instances, sourced from the view-derived
  // ``instances`` and shaped to ``ModelInstanceRow``. Passed to
  // useModelManagement so it derives models from the view instead of
  // issuing its own ``extraction_instances`` read. ``undefined`` until a
  // container entity type exists so the hook keeps its standalone behavior.
  const modelInstances = useMemo(
    () =>
      modelParentEntityType
        ? instances
            .filter((i) => i.entity_type_id === modelParentEntityType.id)
            .map((i) => ({
              id: i.id,
              label: i.label,
              sort_order: i.sort_order,
              created_at: i.created_at,
            }))
        : undefined,
    [instances, modelParentEntityType],
  );

  // Restore preference for the active model (persisted below). A
  // per-article mount snapshot, deliberately not live: the hook applies
  // it only when no current selection survives a load. Guarded read —
  // localStorage can throw in restricted contexts (SidebarContext
  // precedent).
  const initialModelId = useMemo(() => {
    if (!articleId) return null;
    try {
      return localStorage.getItem(`active-model-${articleId}`);
    } catch {
      return null;
    }
  }, [articleId]);

  // Hook for model management
  const {
    models,
    activeModelId,
    setActiveModelId,
    loading: modelsLoading,
    createModel,
    removeModel,
    refreshModels,
    getModelProgress
  } = useModelManagement({
    projectId: projectId || '',
    articleId: articleId || '',
    templateId: template?.id || '',
    modelParentEntityTypeId: modelParentEntityType?.id || null,
    modelInstances,
    initialModelId,
    enabled: !!template && !!modelParentEntityType
  });

    // Persist active model in localStorage (guarded like the read above).
  useEffect(() => {
    if (activeModelId && articleId) {
      try {
        localStorage.setItem(`active-model-${articleId}`, activeModelId);
      } catch {
        // Restricted context — losing the preference is fine.
      }
    }
  }, [activeModelId, articleId]);

    // Redirect on critical error
  useEffect(() => {
    if (dataError && projectId) {
      toast.error(dataError);
      navigate(`/projects/${projectId}?tab=extraction`);
    }
  }, [dataError, projectId, navigate]);

  const getInstancesForModel = (entityTypeId: string, modelId: string) => {
    return instances.filter(
      i => i.entity_type_id === entityTypeId && i.parent_instance_id === modelId
    );
  };

    // Function to reload the run view (and thus the derived instances).
    // Used after model / instance mutations and AI extraction.
  const handleRefreshInstances = async () => {
    await refetchRun();
  };

  const handleBack = () => {
    navigate(`/projects/${projectId}?tab=extraction`);
  };

  const handleNavigateToArticle = (newArticleId: string) => {
    navigate(`/projects/${projectId}/extraction/${newArticleId}`);
  };

  // Handlers for model management
  const handleAddModel = () => {
    setShowAddModelDialog(true);
  };

  const handleConfirmAddModel = async (modelName: string, modellingMethod: string) => {
    const result = await createModel(modelName, modellingMethod);
    if (result) {
      setShowAddModelDialog(false);
      // Reload the run view (child instances will be included).
      // refreshModels() is NOT called — the createModel hook already updated local state.
      await preserveScroll(refetchRun);
    }
  };

  const handleRemoveModel = async (instanceId: string) => {
    const model = models.find(m => m.instanceId === instanceId);
    if (!model) return;

      // Check if there is extracted data
    const progress = await getModelProgress(instanceId);
    const hasData = !!(progress && progress.completed > 0);

    setModelToRemove({ 
      id: instanceId, 
      name: model.modelName,
      hasData,
      fieldsCount: progress?.completed || 0
    });
  };

  const handleConfirmRemoveModel = async () => {
    if (!modelToRemove) return;

    extractionLogger.info('removeModelHandler', 'Starting model removal', {
      modelId: modelToRemove.id,
      modelName: modelToRemove.name,
      hasData: modelToRemove.hasData,
      fieldsCount: modelToRemove.fieldsCount,
    });

    const modelIdToRemove = modelToRemove.id;
    const modelNameToRemove = modelToRemove.name;

    // removeModel resolves/rejects — use .then().catch() so there is no
    // try/catch or throw in this component function.
    await removeModel(modelIdToRemove).then(async () => {
      extractionLogger.info('removeModelHandler', 'Model removed successfully', {
        modelId: modelIdToRemove,
        modelName: modelNameToRemove,
      });

      // Close dialog immediately after successful removal
      setModelToRemove(null);

      // Do not call refreshModels() - hook already updates local state
      // Only reload the run view so child instances are removed from UI
      await refetchRun().catch((refreshError: unknown) => {
        // Log error but do not re-throw - model was already removed successfully
        extractionLogger.error('removeModelHandler', 'Error reloading run view after removal', refreshError instanceof Error ? refreshError : undefined, {
          modelId: modelIdToRemove,
        });
        // Do not block flow - model was already removed from local state
      });
    }).catch((error: unknown) => {
      extractionLogger.error('removeModelHandler', 'Failed to remove model', error instanceof Error ? error : undefined, {
        modelId: modelIdToRemove,
        modelName: modelNameToRemove,
      });
      // Re-throw so the dialog can display the error — CONCERN: this
      // throw is at the top level of handleConfirmRemoveModel (not inside
      // a try block in this component), so it propagates to the dialog's
      // onConfirm handler which catches it.
      throw error;
    });
  };

  // Adding an entry to a repeating section: the dialog (key input labelled
  // by the section's key field, sibling chips, duplicate block) and the
  // create live in the hook; the identity is stamped at creation.
  const addEntry = useAddEntry({
    projectId,
    articleId,
    templateId: template?.id,
    entityTypes,
    instances,
    modelParentEntityTypeId: modelParentEntityType?.id ?? null,
    activeModelId,
    updateValue,
    onCreated: refetchRun,
  });
  const handleAddInstance = addEntry.open;

  // Rename / re-key — one write for cards and for the active model. The
  // noun names the entry in the toasts; the run view refetch (invalidated
  // by the hook) re-derives labels and identities.
  const updateIdentity = useUpdateInstanceIdentity(activeRunId);
  const [modelToRename, setModelToRename] = useState<string | null>(null);
  const handleRenameInstance = async (instanceId: string, changes: EntryIdentityChanges) => {
    const instance = instances.find((i) => i.id === instanceId);
    const entityType = entityTypes.find((et) => et.id === instance?.entity_type_id);
    await updateIdentity.mutateAsync({
      instanceId,
      noun: entityType?.entry_label ?? DEFAULT_ENTRY_NOUN,
      body: {
        projectId: projectId ?? '',
        articleId: articleId ?? '',
        templateId: template?.id ?? '',
        label: changes.label,
        entityKey: changes.entityKey ?? undefined,
      },
    });
  };
  const modelKeyField = modelParentEntityType ? keyFieldOf(modelParentEntityType.fields) : null;
  const modelBeingRenamed = instances.find((i) => i.id === modelToRename) ?? null;

  const handleRemoveInstance = async (instanceId: string) => {
    // Check if there are extracted values
    const hasValues = Object.keys(values).some(key => key.startsWith(`${instanceId}_`));
    if (hasValues) {
      const confirmed = window.confirm(t('pages', 'extractionScreenConfirmRemoveInstance'));
      if (!confirmed) return;
    }
    const removed = await extractionInstanceService.removeInstance(instanceId).catch((error: unknown) => {
      console.error('Error removing instance:', error);
      // FK 23503: the instance is pinned by published rows from a prior
      // finalized revision (deferred FK, migration 0040) — explain, don't
      // show the generic failure (2026-07-02 hardening finding).
      const message = error instanceof Error ? error.message : String(error);
      toast.error(
        message.includes('extraction_published_states')
          ? t('pages', 'extractionScreenInstancePinned')
          : t('pages', 'extractionScreenErrorRemoveInstance'),
      );
      return false;
    });
    if (removed !== false) {
      await refetchRun();
      toast.success(t('pages', 'extractionScreenInstanceRemoved'));
    }
  };


  // Single render gate. ``no-fields`` is reported ONLY when the run is loaded
  // and genuinely carries no entity types — a missing run (open/fetch failed or
  // still in flight) is an error or a loader, never a false "template has no
  // fields" empty state (the #324 masking regression). See
  // ``resolveExtractionViewState``.
  const viewState = resolveExtractionViewState({
    bootstrapLoading: loading,
    hasArticleAndTemplate: !!article && !!template,
    runDetailLoaded: !!runDetail,
    sessionError: sessionResult.error,
    runError: runIsError,
    runErrorMessage: runErrorObj instanceof Error ? runErrorObj.message : null,
    valuesLoading,
    entityTypesCount: entityTypes.length,
  });

  // Loading state
  if (viewState.kind === 'loading') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">{t('pages', 'extractionScreenLoading')}</p>
        </div>
      </div>
    );
  }

  // Bootstrap (article/template) failed to load.
  if (viewState.kind === 'load-error') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
            <p className="text-destructive">{t('pages', 'extractionScreenErrorLoad')}</p>
            <Button onClick={handleBack}>{t('common', 'back')}</Button>
        </div>
      </div>
    );
  }

  // The extraction run could not be opened (session-open or RunView fetch
  // failed). Surface it with a retry instead of masking it as "No fields".
  if (viewState.kind === 'run-error') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">{t('pages', 'extractionScreenRunErrorTitle')}</h3>
            <p className="text-muted-foreground">{t('pages', 'extractionScreenRunErrorDesc')}</p>
            {viewState.message ? (
              <p className="text-xs text-muted-foreground/70 break-words">{viewState.message}</p>
            ) : null}
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button
              onClick={() => {
                void sessionResult.refetch();
                void refetchRun();
              }}
            >
              {t('pages', 'extractionScreenRetry')}
            </Button>
            <Button variant="outline" onClick={handleBack}>{t('common', 'back')}</Button>
          </div>
        </div>
      </div>
    );
  }

  // Run is loaded and genuinely has no entity types configured.
  if (viewState.kind === 'no-fields') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-6 max-w-md">
          <div className="space-y-2">
              <h3 className="text-lg font-semibold">{t('pages', 'extractionScreenNoFieldsTitle')}</h3>
            <p className="text-muted-foreground">
                {t('pages', 'extractionScreenNoFieldsDesc')}
            </p>
          </div>
          
          <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
              <p className="font-medium">{t('pages', 'extractionScreenToResolve')}</p>
            <ul className="text-left space-y-1 text-muted-foreground">
                <li>• {t('pages', 'extractionScreenContactManager')}</li>
                <li>• {t('pages', 'extractionScreenRequestConfig')}</li>
                <li>• {t('pages', 'extractionScreenOrConfigureTemplate')}</li>
            </ul>
          </div>

            <Button onClick={handleBack}>{t('common', 'back')}</Button>
        </div>
      </div>
    );
  }

  // Only the ``ready`` view-state reaches here. ``article``/``template`` are
  // guaranteed non-null at this point (a missing one resolves to 'loading' or
  // 'load-error' above); this guard is unreachable and exists solely to narrow
  // them for TypeScript after the gate was lifted into resolveExtractionViewState.
  if (!article || !template) {
    return null;
  }

  /**
   * Handler called after section extraction completes
   *
   * Refreshes suggestions and extracted values in background.
   * Uses polling to ensure suggestions are loaded when available.
   *
   * IMPORTANT: This function must not block - runs in background.
   */
  const handleExtractionComplete = (_runId?: string) => {
      // Run refresh in background (do not block).
      // Wrapped in preserveScroll so the form + PDF panels keep their scroll
      // position even though the underlying state updates trigger a re-render.
    (async () => {
      // Polling state declared outside try so the poll loop can run after
      // the initial-refresh try/catch without triggering compiler value-block
      // restrictions inside the try statement.
      let attempts = 0;
      const maxAttempts = 5;
      const pollDelay = 1000;
      let foundSuggestions: boolean;

      try {
        await new Promise(resolve => setTimeout(resolve, 1500));

        await preserveScroll(async () => {
          // AI extraction creates a *new* run in `extract` stage (see
          // ``SectionExtractionService.extract_section``); the proposals
          // live on that new run, not on the session run the page was
          // bound to. Refetch the HITL session first so ``activeRunId``
          // re-resolves to the most-recent non-terminal run (the AI
          // run); then refetch its detail so ``runDetail.proposals``
          // hydrates ``useExtractedValues``. Without the session
          // refetch, the form keeps reading the original session run
          // and the extracted values never appear without F5.
          try {
            await sessionResult.refetch();
          } catch (err) {
            console.error('Error refetching session (non-critical):', err);
          }
          try {
            // Refetching the run view also re-derives entity_types +
            // instances (the form's single source of truth) — no separate
            // instance refresh is needed.
            await refetchRun();
          } catch (err) {
            console.error('Error refetching run (non-critical):', err);
          }
          await refreshValues();
        });

        // Wait briefly before suggestion polling so newly created
        // instances are queryable.
        await new Promise(resolve => setTimeout(resolve, 500));

        // Polling for AI suggestions. Each attempt is wrapped in
        // preserveScroll so suggestion-driven re-renders also keep the
        // user's place. We use the direct result (not React state) to
        // decide when to stop, which avoids racing the next render.
        const result = await preserveScroll(refreshAISuggestions);
        foundSuggestions = result.count > 0;
      } catch (error) {
        console.error('Error reloading suggestions:', error);
        // Do not show error toast - suggestions may not have been created
        // (already handled by extraction hook)
        return;
      }

      // Poll loop runs outside the try/catch so complex conditions are not
      // inside a try statement (React Compiler restriction).
      if (foundSuggestions) return;
      while (attempts < maxAttempts) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, pollDelay));
        // refreshAISuggestions never rejects (terminal .catch in loadSuggestions) — safe outside try
        const pollResult = await preserveScroll(refreshAISuggestions);
        foundSuggestions = pollResult.count > 0;
        if (foundSuggestions) return;
      }
    })();
  };

  // P0 guide handler: scroll the form container to top and show a toast.
  // Jump-to-first-empty-field is a documented P1 refinement — not wired here.
  const onGuide = (message?: string) => {
    const el = document.querySelector('[data-scroll-container="extraction-form"] [data-radix-scroll-area-viewport]');
    if (el) el.scrollTop = 0;
    toast.info(message ?? t('extraction', 'runHeaderGateBlocked'));
  };

  // Stage-driven transition for the RunHeader PrimaryAction slot.
  // buildExtractionTransition() owns all label/gate logic (Finish extraction /
  // Start consensus / Approve & finalize). The legacy header finalize path is gone.
  //
  // divergencesResolved: every diverging coord carries a consensus decision (a
  // no-divergence run is trivially resolved). isReady: the caller already marked
  // themselves ready. Both feed the consensus / extract phase-aware actions.
  const resolvedCoordKeys = new Set(
    (runDetail?.consensus_decisions ?? []).map(
      (c) => `${c.instance_id}::${c.field_id}`,
    ),
  );
  const divergencesResolved = [...reviewerSummary.divergentCoords].every((c) =>
    resolvedCoordKeys.has(c),
  );
  const isReady = (runDetail?.reviewers_ready ?? []).includes(currentUserId);
  const transition = buildExtractionTransition({
    stage,
    canResolveConflicts: permissions.canResolveConflicts,
    isComplete,
    completed: completedFields,
    total: totalFields,
    consensusComplete: requiredFieldsResolved,
    divergencesResolved,
    isReady,
    onMarkReady,
    onOpenConsensus,
    onApproveFinalize: handleApproveFinalize,
    onGuide,
  });

  // Reopen is surfaced via the header Menu instead of the orphaned banner.
  const canReopen = isFinalized || (!activeRunId && !!finalizedRun);

  // Backward reopen (consensus -> extract): arbitrator-only, consensus stage only.
  // resolvedCoordKeys.size is exactly what the discard removes (drives the dialog copy).
  const canReopenExtraction = deriveCanReopenExtraction(permissions.canResolveConflicts, stage);
  const reopenResolvedCount = resolvedCoordKeys.size;

  // AI extraction progress overlay (fixed-position; DOM placement irrelevant).
  const aiProgressOverlay =
    (aiExtractionState?.loading && aiExtractionState?.progress) ||
    isProgressMinimized ? (
      <div className="fixed bottom-6 right-6 z-[9999] w-96 max-w-[calc(100vw-3rem)]">
        <FullAIExtractionProgress
          progress={aiExtractionState?.progress ?? { stage: 'extracting_models' }}
          onClose={() => {
            setAiExtractionState(null);
            setIsProgressMinimized(false);
          }}
          onMinimize={() => {
            setIsProgressMinimized(true);
          }}
        />
      </div>
    ) : null;

  // Published/revision banner between header and panels (shared component,
  // spec 2026-07-02 D4) — the header-menu Reopen item stays.
  const extractionSubHeader = (
    <HITLPublishedBanner
      kind="extraction"
      finalized={canReopen}
      parentRunId={parentRunId}
      onReopen={() => void handleReopen()}
      reopening={reopening}
    />
  );

  const extractionFormPanelInner =
    inConsensusStage && runDetail ? (
      <div className="h-full min-h-0 overflow-y-auto" data-testid="extraction-consensus-area">
        <ConsensusResolutionPanel
          runDetail={runDetail}
          summary={reviewerSummary}
          entityTypes={entityTypes}
          instances={instances}
          ownValues={values}
          requiredCoords={requiredCoords}
          peersRevealed={!!runDetail.peers_revealed}
          reviewerLabelById={reviewerProfiles.labelById}
          reviewerAvatarById={reviewerProfiles.avatarById}
          canResolve={permissions.canResolveConflicts}
          // Consensus AI trace (D2): a single top-level channel, deeper history
          // window (50) so adopted versions rarely fall outside it; a not-yet-
          // loaded/failed suggestions map passes null so no coord mislabels.
          // showPeerIdentity + currentUserId gate field-level peer cross-marks
          // to self in blind review (server already strips peer rows).
          aiTrace={{
            articleId: articleId || '',
            getHistory: (i, f) => getSuggestionsHistory(i, f, 50),
            aiSuggestions: aiSuggestionsReady ? aiSuggestions : null,
            showPeerIdentity: !!runDetail.peers_revealed || permissions.canSeeOthers,
            currentUserId: currentUserId || null,
          }}
          onSelectExisting={handleSelectExisting}
          onManualOverride={handleManualOverride}
          onFinalize={handleApproveFinalize}
          isResolving={consensusMutation.isPending}
          isFinalizing={advanceMutation.isPending || approveFinalize.isPending}
          showFinalize={false}
        />
      </div>
    ) : (
      <ExtractionFormPanel
        viewMode={viewMode}
        showPDF={pdf.isOpen}
        formViewProps={{
          studyLevelSections,
          modelParentEntityType,
          modelChildSections,
          instances,
          values,
          updateValue,
          aiSuggestions,
          acceptSuggestion,
          selectSuggestion,
          rejectSuggestion,
          getSuggestionsHistory,
          models,
          activeModelId,
          setActiveModelId,
          onAddModel: handleAddModel,
          onRemoveModel: handleRemoveModel,
          onRenameModel: setModelToRename,
          onRefreshModels: refreshModels,
          onRefreshInstances: handleRefreshInstances,
          getInstancesForModel,
          handleAddInstance,
          handleRemoveInstance,
          handleRenameInstance,
          projectId: projectId || '',
          articleId: articleId || '',
          templateId: template?.id || '',
          runId: activeRunId,
          modelsLoading,
          onExtractionComplete: handleExtractionComplete,
        }}
        compareViewProps={{
          decisionsByCoord: reviewerSummary.decisionsByCoord,
          entityTypes,
          instances,
          ownValues: values,
          reviewerLabelById: reviewerProfiles.labelById,
          reviewerAvatarById: reviewerProfiles.avatarById,
        }}
      />
    );

  const extractionFormPanel = (
    // showPeerIdentity (D3): auto-revealed consensus / unblinded or manager
    // extract callers see "Run by {name}" on popover run headers and the
    // generation dialog's Ran-by rows; blind reviewers keep timestamp-only.
    <RunEditabilityProvider
      stage={stage}
      showPeerIdentity={!!runDetail?.peers_revealed || permissions.canSeeOthers}
      forceReadOnly={permissions.userRole === 'viewer'}
    >
      {extractionFormPanelInner}
    </RunEditabilityProvider>
  );

  return (
    <div className="h-full bg-background">
      {aiProgressOverlay}
      <RunSplitShell
        pdfState={pdf}
        viewerStore={viewerStore}
        subHeader={extractionSubHeader}
        formPanel={extractionFormPanel}
        pdfPanel={
          <RunPdfContent
            articleId={articleId || ''}
            projectId={projectId || ''}
            store={viewerStore}
          />
        }
        header={
          <ExtractionHeader
        articleTitle={article.title}
        onBack={handleBack}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onOpenMobileNav={toggleMobile}
        articles={articles}
        currentArticleId={articleId || ''}
        onNavigateToArticle={handleNavigateToArticle}
        completedFields={completedFields}
        totalFields={totalFields}
        completionPercentage={completionPercentage}
        showPDF={pdf.isOpen}
        onTogglePDF={pdf.toggle}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        // D6: during consensus the resolve table is the only compare surface
        // (viewMode is ignored there) — a live toggle would be a dead control.
        hasComparison={canCompare && !inConsensusStage}
        userRole={permissions.userRole}
        isBlindMode={permissions.isBlindMode}
        saveState={saveState}
        lastSavedAt={lastSavedAt}
        submitting={submitting}
        // RunHeader feature props
        stage={stage ?? undefined}
        transition={transition}
        isRevision={!!parentRunId}
        reviewers={{
          count: reviewerSummary.reviewers.length,
          required: expectedReviewerCount,
          // divergentCoords is a Set<string> — .size gives the count
          divergent: reviewerSummary.divergentCoords.size,
          // Advisory "N/M ready" hint — only while extracting (helps the
          // manager decide when to open consensus). Backend always sends these.
          ...(stage === 'extract' && runDetail
            ? { ready: runDetail.ready_count ?? 0, readyTotal: expectedReviewerCount }
            : {}),
        }}
        canReveal={canReveal}
        onReveal={onReveal}
        // D6: inert during consensus (the consensus branch ignores viewMode) —
        // mirror the QA guard so the status-popover jump never dead-clicks.
        onJumpToDivergence={inConsensusStage ? undefined : () => setViewMode('compare')}
        // AI extraction seeds proposals and only works in EXTRACT; once the
        // run advances to consensus it's a one-time-done step (re-running errors).
        // Gated on an OPEN session run — extraction always targets that run, so
        // it never forks a parallel run that would orphan the reviewer's edits.
        canRunAI={!!activeRunId && (stage === 'extract' || stage == null)}
        aiPendingCount={isFinalized ? 0 : aiPendingCount}
        onAISuggestionsClick={() => {
          // Header "Review N pending suggestions": scroll the form to the
          // section holding the first pending suggestion.
          const instanceId = firstPendingInstanceId(aiSuggestions);
          const entityTypeId = instanceId
            ? instances.find((i) => i.id === instanceId)?.entity_type_id
            : undefined;
          if (entityTypeId) scrollToSectionById(entityTypeId);
        }}
        onExtractWithAI={onExtractWithAI}
        extractingAI={extractingAI}
        // Reopen moved into the header Menu
        canReopen={canReopen}
        onReopen={() => void handleReopen()}
        reopening={reopening}
        canReopenExtraction={canReopenExtraction}
        onReopenExtraction={() => setReopenExtractionOpen(true)}
      />
        }
      />

      {/* Dialogs */}
      <AddModelDialog
        open={showAddModelDialog}
        onConfirm={handleConfirmAddModel}
        onCancel={() => setShowAddModelDialog(false)}
        existingModels={models.map(m => m.modelName)}
        entryLabel={modelParentEntityType?.entry_label ?? DEFAULT_ENTRY_NOUN}
        keyLabel={modelKeyField?.label ?? null}
      />

      <AddEntryDialog {...addEntry.dialogProps} />

      <RenameEntryDialog
        open={modelBeingRenamed !== null}
        entryLabel={modelParentEntityType?.entry_label ?? DEFAULT_ENTRY_NOUN}
        keyLabel={modelKeyField?.label ?? null}
        initialLabel={modelBeingRenamed?.label ?? ''}
        initialKey={modelBeingRenamed ? displayEntryKey(modelBeingRenamed) : null}
        siblingKeys={instances
          .filter(
            (i) =>
              i.entity_type_id === modelParentEntityType?.id && i.id !== modelToRename,
          )
          .map((i) => entryKeyOf(i) ?? i.label)}
        onConfirm={async (changes) => {
          if (!modelToRename) return;
          await handleRenameInstance(modelToRename, changes);
          setModelToRename(null);
        }}
        onCancel={() => setModelToRename(null)}
      />

      <RemoveModelDialog
        open={!!modelToRemove}
        entryLabel={modelParentEntityType?.entry_label ?? DEFAULT_ENTRY_NOUN}
        modelName={modelToRemove?.name || ''}
        hasExtractedData={modelToRemove?.hasData || false}
        extractedFieldsCount={modelToRemove?.fieldsCount || 0}
        onConfirm={handleConfirmRemoveModel}
        onCancel={() => setModelToRemove(null)}
      />

      <ReopenExtractionDialog
        open={reopenExtractionOpen}
        onOpenChange={setReopenExtractionOpen}
        resolvedCount={reopenResolvedCount}
        onConfirm={handleReopenExtraction}
        pending={reopenExtractionMutation.isPending}
      />
    </div>
  );
}

