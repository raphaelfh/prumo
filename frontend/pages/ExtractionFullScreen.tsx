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

import {useEffect, useMemo, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {toast} from 'sonner';
import {extractionInstanceService} from '@/services/extractionInstanceService';
import {getRequiredUserId} from '@/services/authService';
import {extractionLogger} from '@/lib/extraction/observability';
import {useEntityTypePartition} from '@/lib/extraction/entityTypeRoles';
import {entityTypesFromRunView, instancesFromRunView} from '@/lib/extraction/runViewAdapters';
import {resolveExtractionViewState} from '@/lib/extraction/extractionViewState';
import {ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable';
import {Button} from '@/components/ui/button';
import {Loader2} from 'lucide-react';
import {
  HITLStatusBadges,
} from '@/components/runs/HITLStatusBadges';
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
import {useFullAIExtraction} from '@/hooks/extraction/useFullAIExtraction';
import {useComparisonPermissions} from '@/hooks/shared/useComparisonPermissions';
import {
  useAdvanceRun,
  useApproveFinalize,
  useCreateConsensus,
  useMarkReady,
  useReopenRun,
  useReviewerSummary,
  useRun,
  useRunReviewers,
} from '@/hooks/runs';
import {ConsensusPanel} from '@/components/runs/ConsensusPanel';

// Components
import {ExtractionHeader} from '@/components/extraction/ExtractionHeader';
import {ExtractionPDFPanel} from '@/components/extraction/ExtractionPDFPanel';
import {ExtractionFormPanel} from '@/components/extraction/ExtractionFormPanel';
import {AddModelDialog, RemoveModelDialog} from '@/components/extraction/hierarchy';
import {FullAIExtractionProgress} from '@/components/extraction/FullAIExtractionProgress';

// Additional hooks
import {useModelManagement} from '@/hooks/extraction/useModelManagement';
import {usePreserveScroll} from '@/hooks/usePreserveScroll';
import {t} from '@/lib/copy';
import {ViewerProvider, createViewerStore, subscribeReaderLocate} from '@prumo/pdf-viewer';

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
  // the React-Compiler-approved pattern (mirrors ViewerProvider's own
  // internal creation). Both <ExtractionPDFPanel store={viewerStore}> and
  // <ViewerProvider store={viewerStore}> below point at this instance —
  // that is the prerequisite for the click-evidence → highlight feature
  // (Task 4B follow-up).
  const [viewerStore] = useState(createViewerStore);

  // Load page-bootstrap data using dedicated hook (SRP). Entity types +
  // instances are NOT read here anymore — they are derived from the
  // server RunView (runDetail) below via the adapters.
  const {
    article,
    project,
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
  const [showPDF, setShowPDF] = useState(false);
  const [viewMode, setViewMode] = useState<'extract' | 'compare'>('extract');

  // Locating a citation (from an AI-suggestion popover) reveals the document
  // panel if it is collapsed, so the reader can scroll + flash the cited
  // passage. The helper fires only on a new locate request.
  useEffect(
    () => subscribeReaderLocate(viewerStore, () => setShowPDF(true)),
    [viewerStore],
  );

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
  // seeds top-level instances if missing, and parks it in PROPOSAL so
  // the autosave (which writes `human` proposals) can fire immediately.
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
  const proposals = runDetail?.proposals;
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
    kind: 'extraction',
    proposals,
    currentValues: runDetail?.current_values,
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

  // {instance::field} → "Section · Field" label map AND the full evaluate-all
  // coord list for the ConsensusPanel. Built from every existing instance ×
  // its entity type's snapshot fields (real labels), so the evaluate-all surface
  // shows every field — agreed and diverging — not just touched/divergent ones.
  const fieldLabelByCoordMap: Record<string, string> = {};
  const extractionAllCoords: string[] = [];
  for (const inst of instances) {
    const et = entityTypes.find((e) => e.id === inst.entity_type_id);
    const sectionLabel = et?.label ?? et?.name ?? 'Section';
    for (const f of et?.fields ?? []) {
      const key = `${inst.id}::${f.id}`;
      // Evaluate-all shows every TOUCHED coord (agreed + diverging). Untouched
      // coords (no reviewer decision) are omitted — rendering them as empty
      // "0 disagreed" rows is noise; the completeness gate covers required gaps.
      if (reviewerSummary.decisionsByCoord.has(key)) extractionAllCoords.push(key);
      fieldLabelByCoordMap[key] = `${sectionLabel} · ${f.label}`;
    }
  }
  const fieldLabelByCoord = fieldLabelByCoordMap;

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
      value: { value: params.value },
      rationale: params.rationale,
    });
    await refetchRun();
  };

  // "Approve & finalize": one action that publishes every agreed coord then
  // advances consensus → finalized (backend-atomic). The backend gate rejections
  // (unresolved divergence / incomplete required fields) surface via
  // useApproveFinalize.onError as a toast; the promise-chain guard (no try/finally)
  // keeps the React Compiler happy and skips the success path on failure.
  const handleApproveFinalize = async () => {
    if (!activeRunId) return;
    const ok = await approveFinalize
      .mutateAsync()
      .then(() => true)
      .catch(() => false);
    if (!ok) return;
    await Promise.all([refetchRun(), refreshValues(), refreshFinalizedRun()]);
    toast.success(t('pages', 'extractionScreenFinalizeSuccess'));
  };

  // Plain-identifier dep so the compiler can track this dep without
  // optional-chaining (optional-chained deps like `finalizedRun?.id` defeat it).
  const finalizedRunId = finalizedRun?.id;
  const handleReopen = async () => {
    if (!finalizedRunId) return;
    setReopening(true);
    await reopenMutation.mutateAsync(finalizedRunId).then(async () => {
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

    // Auto-save hook — writes `human` proposals during PROPOSAL stage
    // and per-user ``ReviewerDecision`` rows (decision='edit') during
    // REVIEW stage. The stage-aware target preserves the blind-review
    // contract for multi-reviewer runs: each reviewer's typing during
    // REVIEW lands in their own decision stream and the run view's
    // ``currentValues`` are resolved per reviewer_id (Layer 2 of the
    // multi-reviewer blind fix).
    //
    // No-op until the session is open and the run is in a writable
    // stage. The hook flushes pending edits on unmount, ``pagehide``,
    // and visibility changes so navigating mid-debounce never drops a
    // save.
  const { saveState, lastSavedAt, hasUnsavedChanges, saveNow } = useAutoSaveProposals({
    runId: activeRunId,
    stage,
    // kind drives the write target in 'extract': extraction → /decisions
    // (per-user ReviewerDecision), QA → /proposals. This is the extraction page.
    kind: 'extraction',
    values,
    // Server-loaded values are the baseline — opening a run must not re-POST
    // them as fresh proposals (the re-record-on-mount duplication).
    baselineValues: loadedValues,
    // Only the editable EXTRACT stage accepts autosave writes. Past that
    // (consensus, finalized, pending) the backend rejects writes, which
    // surfaced as a spurious "Error saving data automatically" toast on
    // opening a consolidated run. Mirrors the QA full-screen gate;
    // ``!isFinalized`` alone let ``consensus`` through.
    enabled:
      !!activeRunId && !loading && valuesInitialized && stage === 'extract',
  });

    // "Mark ready" (reviewer) — flush pending autosave, set the per-reviewer
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
    const nextId = nextArticleTarget(articles, articleId ?? '');
    navigate(
      nextId
        ? `/projects/${projectId}/extraction/${nextId}`
        : `/projects/${projectId}?tab=extraction`,
    );
  };

    // "Open consensus" (manager/consensus) — flush autosave, then advance
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

    // Permissions hook (controls comparison access) — extraction screen.
  const permissions = useComparisonPermissions(
    projectId || '',
    currentUserId,
    'extraction'
  );

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

    // Hook for AI suggestions with callbacks to fill/clear field
  const handleAISuggestionAccepted = async (instanceId: string, fieldId: string, value: any) => {
      // Fill field automatically when suggestion is accepted.
      // NOTE: in this screen the hook runs `acceptStrategy: 'human-proposal'`,
      // so accepting makes NO backend call. Persistence happens solely here:
      // updateValue writes the value into form state, and useAutoSaveProposals
      // records it as a fresh `human` proposal. The suggestion's own
      // status='accepted' is local-only (not persisted), so it reappears as
      // pending on reload — only the value survives. (refreshValues is
      // deliberately avoided; it caused a full-page reload.)
    updateValue(instanceId, fieldId, value);
  };

  const handleAISuggestionRejected = async (instanceId: string, fieldId: string) => {
      // Clear the field when a suggestion is rejected. Same as accept: the
      // 'human-proposal' strategy makes NO backend call — updateValue writes
      // null into form state, and useAutoSaveProposals persists the cleared
      // value. The suggestion's status='rejected' flip is local-only.
    updateValue(instanceId, fieldId, null);
  };

  const { 
    suggestions: aiSuggestions, 
    acceptSuggestion, 
    rejectSuggestion, 
    getSuggestionsHistory,
    refresh: refreshAISuggestions,
    isActionLoading 
  } = useAISuggestions({
    articleId: articleId || '',
    projectId: projectId || '',
    runId: activeRunId ?? undefined,
    // Wait for the session to resolve a run before issuing the
    // suggestion query — otherwise the first render fires a global
    // (no runId) lookup that immediately gets superseded by the
    // run-scoped one. Pure waste; same UX outcome.
    enabled: !!articleId && !!projectId && !!activeRunId,
    // The run lives in PROPOSAL while the user edits, so a
    // ReviewerDecision write would be rejected (decisions only land on
    // REVIEW). Bubble accept/reject to the form pipeline instead — the
    // autosave records each as a fresh `human` proposal.
    acceptStrategy: 'human-proposal',
    onSuggestionAccepted: handleAISuggestionAccepted,
    onSuggestionRejected: handleAISuggestionRejected
  });

  // Full AI extraction — mirrors HeaderMoreMenu wiring exactly.
  // When an active run is available (PROPOSAL stage), ``extractForRun``
  // reuses it (preserving human proposals). Otherwise ``extractFullAI``
  // creates a fresh run via the legacy multi-step orchestration.
  const { extractFullAI, loading: extractingFullAI, progress: extractionProgress } = useFullAIExtraction({
    onSuccess: async () => {
      await handleExtractionComplete();
    },
  });

  const { extractForRun, loading: extractingForRun } = useRunAIExtraction({
    onSuccess: async () => {
      await handleExtractionComplete();
    },
  });

  const extractingAI = extractingFullAI || extractingForRun;

  // Handler wired to RunHeader.AIActions — mirrors HeaderMoreMenu.handleFullAIExtraction.
  const onExtractWithAI = () => {
    if (!articleId || !template?.id) {
      console.warn('[ExtractionFullScreen] articleId or templateId not provided for AI extraction');
      return;
    }
    if (activeRunId) {
      void extractForRun({
        projectId: projectId ?? '',
        articleId,
        templateId: template.id,
        runId: activeRunId,
      }).catch((error: unknown) => {
        console.error('[ExtractionFullScreen] Run AI extraction error:', error);
      });
    } else {
      void extractFullAI({
        projectId: projectId ?? '',
        articleId,
        templateId: template.id,
      }).catch((error: unknown) => {
        console.error('[ExtractionFullScreen] Full AI extraction error:', error);
      });
    }
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
    enabled: !!template && !!modelParentEntityType
  });

    // Persist active model in localStorage
  useEffect(() => {
    if (activeModelId && articleId) {
      localStorage.setItem(`active-model-${articleId}`, activeModelId);
    }
  }, [activeModelId, articleId]);

  // Restore the active model on load
  useEffect(() => {
    if (articleId && models.length > 0 && !activeModelId) {
      const saved = localStorage.getItem(`active-model-${articleId}`);
      if (saved && models.some(m => m.instanceId === saved)) {
        setActiveModelId(saved);
      } else {
        setActiveModelId(models[0].instanceId);
      }
    }
  }, [articleId, models, activeModelId, setActiveModelId]);

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

  const handleAddInstance = async (entityTypeId: string) => {
    if (!template) return;

    extractionLogger.info('handleAddInstance', 'Starting instance creation', {
      entityTypeId,
      templateId: template.id,
    });

    const userResult = await getRequiredUserId();
    if (!userResult.ok) {
      toast.error(t('common', 'errors_userNotAuthenticated'));
      return;
    }
    const userId = userResult.data;

    // Find the entity type
    const entityType = entityTypes.find(et => et.id === entityTypeId);
    if (!entityType) {
      extractionLogger.warn('handleAddInstance', 'Entity type not found', {entityTypeId});
      return;
    }

    // Determine parent_instance_id if hierarchical entity type
    let parentInstanceId: string | undefined = undefined;
    // Pre-compute optional chain to avoid unsupported value-blocks inside conditions
    const modelParentId = modelParentEntityType?.id;

    // If it has parent_entity_type_id, it is a child entity (e.g. model child sections)
    if (entityType.parent_entity_type_id) {
      // If parent is prediction_models, use activeModelId
      if (entityType.parent_entity_type_id === modelParentId) {
        if (!activeModelId) {
          toast.error(t('pages', 'extractionScreenSelectModelFirst'));
          return;
        }
        parentInstanceId = activeModelId;
      } else {
        // Para outras hierarquias, buscar parent instance
        const parentInstance = instances.find(
          i => i.entity_type_id === entityType.parent_entity_type_id
        );
        if (parentInstance) {
          parentInstanceId = parentInstance.id;
        } else {
          toast.error(t('pages', 'extractionScreenParentNotFound'));
          return;
        }
      }
    }

    // Count existing instances to generate label (same parent)
    const existingCount = instances.filter(i =>
      i.entity_type_id === entityTypeId &&
      i.parent_instance_id === (parentInstanceId || null)
    ).length;

    // Generate unique label
    let newLabel: string;
    if (parentInstanceId) {
      // For child instances, include parent reference to avoid conflicts
      const parentInstance = instances.find(i => i.id === parentInstanceId);
      newLabel = parentInstance
        ? `${parentInstance.label} - ${entityType.label} ${existingCount + 1}`
        : `${entityType.label} ${existingCount + 1}`;
    } else {
      newLabel = `${entityType.label} ${existingCount + 1}`;
    }

    extractionLogger.debug('handleAddInstance', 'Creating instance via service', {
      entityTypeId,
      entityTypeName: entityType.name,
      parentInstanceId,
      label: newLabel
    });

    // Use .then().catch() — no try/catch in the component function.
    await extractionInstanceService.createInstance({
      projectId: projectId!,
      articleId: articleId!,
      templateId: template.id,
      entityTypeId,
      entityType,
      parentInstanceId,
      label: newLabel,
      userId,
    }).then(async (result) => {
      if (result.wasCreated) {
        // Reload the run view after create (derived instances refresh)
        await refetchRun();
        extractionLogger.info('handleAddInstance', 'Instance created successfully', {
          instanceId: result.instance.id,
          label: result.instance.label
        });
        toast.success(`${result.instance.label} ${t('pages', 'extractionScreenInstanceAddedSuccess')}`);
      } else {
        extractionLogger.info('handleAddInstance', 'Instance already existed', {
          instanceId: result.instance.id,
          label: result.instance.label
        });
        toast.info(t('pages', 'extractionScreenInstanceAlreadyExists'));
      }
    }).catch((error: unknown) => {
      extractionLogger.error('handleAddInstance', 'Failed to create instance', error instanceof Error ? error : undefined, {
        entityTypeId,
        templateId: template.id
      });
      console.error('Error adding instance:', error);
      toast.error(`${t('pages', 'extractionScreenErrorAddInstance')}: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const handleRemoveInstance = async (instanceId: string) => {
    // Check if there are extracted values
    const hasValues = Object.keys(values).some(key => key.startsWith(`${instanceId}_`));
    if (hasValues) {
      const confirmed = window.confirm(t('pages', 'extractionScreenConfirmRemoveInstance'));
      if (!confirmed) return;
    }
    const removed = await extractionInstanceService.removeInstance(instanceId).catch((error: unknown) => {
      console.error('Error removing instance:', error);
      toast.error(t('pages', 'extractionScreenErrorRemoveInstance'));
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
          // AI extraction creates a *new* run in PROPOSAL stage (see
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
  const onGuide = () => {
    const el = document.querySelector('[data-scroll-container="extraction-form"] [data-radix-scroll-area-viewport]');
    if (el) el.scrollTop = 0;
    toast.info(t('extraction', 'runHeaderGateBlocked'));
  };

  // Stage-driven transition for the RunHeader PrimaryAction slot.
  // buildExtractionTransition() owns all label/gate logic (Mark ready / Open
  // consensus / Approve & finalize). The legacy header finalize path is gone.
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
    divergencesResolved,
    isReady,
    onMarkReady,
    onOpenConsensus,
    onApproveFinalize: handleApproveFinalize,
    onGuide,
  });

  // Reopen is surfaced via the header Menu instead of the orphaned banner.
  const canReopen = isFinalized || (!activeRunId && !!finalizedRun);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header — RunHeader compound via ExtractionHeader */}
      <ExtractionHeader
        projectId={projectId || ''}
        projectName={project?.name || t('pages', 'extractionScreenProjectFallback')}
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
        showPDF={showPDF}
        onTogglePDF={() => setShowPDF(!showPDF)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        hasComparison={canCompare}
        userRole={permissions.userRole}
        isBlindMode={permissions.isBlindMode}
        saveState={saveState}
        lastSavedAt={lastSavedAt}
        hasUnsavedChanges={hasUnsavedChanges}
        isComplete={isComplete}
        submitting={submitting}
        templateId={template?.id}
        templateName={template?.name}
        runId={activeRunId}
        // RunHeader feature props
        stage={stage ?? undefined}
        transition={transition}
        isRevision={!!parentRunId}
        reviewers={{
          count: reviewerSummary.reviewers.length,
          required: reviewerSummary.requiredReviewerCount,
          // divergentCoords is a Set<string> — .size gives the count
          divergent: reviewerSummary.divergentCoords.size,
          // Advisory "N/M ready" hint — only while extracting (helps the
          // manager decide when to open consensus). Backend always sends these.
          ...(stage === 'extract' && runDetail
            ? { ready: runDetail.ready_count ?? 0, readyTotal: runDetail.reviewer_count ?? 0 }
            : {}),
        }}
        canReveal={canReveal}
        onReveal={onReveal}
        onJumpToDivergence={() => setViewMode('compare')}
        // AI extraction seeds proposals and only works in EXTRACT; once the
        // run advances to consensus it's a one-time-done step (re-running errors).
        canRunAI={stage === 'extract' || stage == null}
        onExtractionComplete={handleExtractionComplete}
        aiSuggestions={aiSuggestions}
        aiPendingCount={Object.keys(aiSuggestions).length}
        onAISuggestionsClick={() => {
          // P1: scroll to first suggestion or open panel
          console.warn('Clicked AI badge - scrolling to first suggestion');
        }}
        onRefreshInstances={handleRefreshInstances}
        onExtractWithAI={onExtractWithAI}
        extractingAI={extractingAI}
        onExtractionStateChange={setAiExtractionState}
        // Reopen moved into the header Menu
        canReopen={canReopen}
        onReopen={() => void handleReopen()}
        reopening={reopening}
      />

        {/* AI extraction progress - Rendered at page level to avoid conflicts.
            Shown when either: the page-level extractFullAI hook is running with
            progress (header button path), or a child component reported state
            via onExtractionStateChange (form-panel section path), or minimized. */}
      {(extractingFullAI && extractionProgress) || (aiExtractionState?.loading && aiExtractionState?.progress) || isProgressMinimized ? (
        <div className="fixed bottom-6 right-6 z-[9999] w-96 max-w-[calc(100vw-3rem)]">
          <FullAIExtractionProgress
            progress={extractionProgress ?? aiExtractionState?.progress ?? { stage: 'extracting_models' }}
            onClose={() => {
              setAiExtractionState(null);
              setIsProgressMinimized(false);
            }}
            onMinimize={() => {
              setIsProgressMinimized(true);
            }}
          />
        </div>
      ) : null}

      {/* HITL revision/finalized status badges. Only rendered when there is a
          badge to show (revision or published) — otherwise this bordered strip
          was an empty bar. The "N/M reviewers" counter that used to live here
          was redundant with the header's Reviewers slot and always read "1/1"
          in the single-reviewer default, so it has been removed. */}
      {(parentRunId || isFinalized || (!activeRunId && finalizedRun)) ? (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs">
          <HITLStatusBadges
            kind="extraction"
            finalized={isFinalized || (!activeRunId && !!finalizedRun)}
            parentRunId={parentRunId}
          />
        </div>
      ) : null}

      {/* Consensus stage takes over the form area: reviewers diverged
          and need to resolve. Same component the QA page uses. */}
      {inConsensusStage && runDetail ? (
        <div className="border-b bg-muted/20 px-4 py-3" data-testid="extraction-consensus-area">
          <ConsensusPanel
            runDetail={runDetail}
            summary={reviewerSummary}
            fieldLabelByCoord={fieldLabelByCoord}
            reviewerLabelById={reviewerProfiles.labelById}
            avatarById={reviewerProfiles.avatarById}
            onSelectExisting={handleSelectExisting}
            onManualOverride={handleManualOverride}
            onFinalize={handleApproveFinalize}
            isComplete={isComplete}
            isResolving={consensusMutation.isPending}
            isFinalizing={advanceMutation.isPending || approveFinalize.isPending}
            evaluateAllCoords={extractionAllCoords}
            showFinalize={false}
          />
        </div>
      ) : null}

      {/* Main content — wrapped in ViewerProvider so both the PDF viewer and
          the form panel resolve useViewerStore/useViewerStoreApi to the same
          store instance. The viewer also receives store={viewerStore} so
          Viewer.Root forwards it rather than creating a second store.
          QA-screen shared-store lift is deferred (AssessmentShell passes the
          viewer as a ReactNode prop; out of scope here). */}
      <div className="flex-1 overflow-hidden">
        <ViewerProvider store={viewerStore}>
        <ResizablePanelGroup direction="horizontal">
            {/* Extraction form (left) - Extracted to isolated component */}
          <ResizablePanel
            id="extraction-form"
            order={1}
            defaultSize={showPDF ? 50 : 100}
            minSize={30}
          >
            <ExtractionFormPanel
              viewMode={viewMode}
              showPDF={showPDF}
              formViewProps={{
                studyLevelSections,
                modelParentEntityType,
                modelChildSections,
                instances,
                values,
                updateValue,
                aiSuggestions,
                acceptSuggestion,
                rejectSuggestion,
                getSuggestionsHistory,
                isActionLoading,
                models,
                activeModelId,
                setActiveModelId,
                onAddModel: handleAddModel,
                onRemoveModel: handleRemoveModel,
                onRefreshModels: refreshModels,
                onRefreshInstances: handleRefreshInstances,
                getInstancesForModel,
                handleAddInstance,
                handleRemoveInstance,
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
          </ResizablePanel>

            {/* PDF Viewer (right, optional) - renders the handle + panel */}
          <ExtractionPDFPanel
            articleId={articleId || ''}
            projectId={projectId || ''}
            showPDF={showPDF}
            store={viewerStore}
          />
        </ResizablePanelGroup>
        </ViewerProvider>
      </div>

      {/* Dialogs */}
      <AddModelDialog
        open={showAddModelDialog}
        onConfirm={handleConfirmAddModel}
        onCancel={() => setShowAddModelDialog(false)}
        existingModels={models.map(m => m.modelName)}
      />

      <RemoveModelDialog
        open={!!modelToRemove}
        modelName={modelToRemove?.name || ''}
        hasExtractedData={modelToRemove?.hasData || false}
        extractedFieldsCount={modelToRemove?.fieldsCount || 0}
        onConfirm={handleConfirmRemoveModel}
        onCancel={() => setModelToRemove(null)}
      />
    </div>
  );
}

