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
import {extractionInstanceService, markInstancesCompleted} from '@/services/extractionInstanceService';
import {getRequiredUserId} from '@/services/authService';
import {extractionLogger} from '@/lib/extraction/observability';
import {useEntityTypePartition} from '@/lib/extraction/entityTypeRoles';
import {entityTypesFromRunView, instancesFromRunView} from '@/lib/extraction/runViewAdapters';
import {errorTracker} from '@/services/errorTracking';
import {ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable';
import {Button} from '@/components/ui/button';
import {Loader2} from 'lucide-react';
import {
  HITLStatusBadges,
} from '@/components/runs/HITLStatusBadges';
import {buildExtractionTransition} from '@/lib/extraction/stageTransition';

// Hooks
import {useExtractionData} from '@/hooks/extraction/useExtractionData';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {useExtractedValues} from '@/hooks/extraction/useExtractedValues';
import {useExtractionSession} from '@/hooks/extraction/useExtractionSession';
import {useFinalizedExtractionRun} from '@/hooks/extraction/useFinalizedExtractionRun';
import {useExtractionProgress} from '@/hooks/extraction/useExtractionProgress';
import {useAutoAdvanceToReview} from '@/hooks/extraction/useAutoAdvanceToReview';
import {useAutoSaveProposals} from '@/hooks/runs';
import {useAISuggestions} from '@/hooks/extraction/ai/useAISuggestions';
import {useComparisonPermissions} from '@/hooks/shared/useComparisonPermissions';
import {
  useAdvanceRun,
  useCreateConsensus,
  useReopenRun,
  useReviewerSummary,
  useRun,
  useRunReviewers,
} from '@/hooks/runs';
import {ConsensusPanel} from '@/components/runs/ConsensusPanel';
import {ReviewerProgressBadge} from '@/components/runs/ReviewerProgressBadge';

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
import {ViewerProvider, createViewerStore} from '@prumo/pdf-viewer';

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
  const [submitting, setSubmitting] = useState(false);
  // Current reviewer id from AuthContext (zero network) — was a
  // supabase.auth.getUser() round-trip + a serial gate on run open.
  const { userId } = useCurrentUser();
  const currentUserId = userId ?? '';

  // UI state
  const [showPDF, setShowPDF] = useState(false);
  const [viewMode, setViewMode] = useState<'extract' | 'compare'>('extract');

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
  const { data: runDetail, refetch: refetchRun } = useRun(
    activeRunId ?? null,
    { enabled: !!activeRunId },
  );

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
    proposals,
    currentValues: runDetail?.current_values,
    currentUserId,
    enabled: !!activeRunId,
  });

  // Reopen wiring: when the active run is finalized, surface the reopen
  // affordance. The reopen mutation creates a new REVIEW-stage run with
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

  const inConsensusStage = runDetail?.run.stage === 'consensus';

  // {instance::field} → "Section · Field" label map for ConsensusPanel.
  // Built from the loaded entity_types + their child fields. entity_types
  // and fields now come from RunView (runDetail) via the adapters — not
  // from useExtractionData. We use the instance label (entityType.label)
  // plus a truncated field id from the run detail's decisions when available.
  const fieldLabelByCoordMap: Record<string, string> = {};
  for (const inst of instances) {
    const et = entityTypes.find((e) => e.id === inst.entity_type_id);
    const sectionLabel = et?.label ?? et?.name ?? 'Section';
    // Decisions + proposals carry the field id but not the label;
    // fall back to the field id when nothing else is known. The
    // ConsensusPanel still renders correctly — just shows the id.
    const seenFields = new Set<string>();
    for (const d of runDetail?.decisions ?? []) {
      if (d.instance_id !== inst.id || seenFields.has(d.field_id)) continue;
      seenFields.add(d.field_id);
      fieldLabelByCoordMap[`${inst.id}::${d.field_id}`] = `${sectionLabel} · ${d.field_id.slice(0, 8)}…`;
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

  const handleFinalizeFromConsensus = async () => {
    if (!activeRunId) return;
    // The backend completeness/consensus gate (ADR 0009) can reject this
    // advance. useAdvanceRun's onError already toasts the message; we just
    // need to skip the success path instead of throwing an unhandled
    // rejection (the panel calls this via `void onFinalize()`).
    const ok = await advanceMutation
      .mutateAsync({ target_stage: 'finalized' })
      .then(() => true)
      .catch(() => false);
    if (!ok) return;
    await Promise.all([refetchRun(), refreshValues(), refreshFinalizedRun()]);
    toast.success('Extraction finalized.');
  };

  // Plain-identifier dep so the compiler can track this dep without
  // optional-chaining (optional-chained deps like `finalizedRun?.id` defeat it).
  const finalizedRunId = finalizedRun?.id;
  const handleReopen = async () => {
    if (!finalizedRunId) return;
    setReopening(true);
    await reopenMutation.mutateAsync(finalizedRunId).then(async () => {
      // The reopen endpoint creates a fresh REVIEW-stage run linked via
      // parameters.parent_run_id. We refetch the HITL session first so
      // activeRunId points at the new child run; only then do the
      // value / runDetail / finalized-run reads run against the new
      // coordinate. Without the session refetch the banner stays stuck
      // on the finalized run and the revision badge never appears.
      await sessionResult.refetch();
      await Promise.all([refreshValues(), refreshFinalizedRun(), refetchRun()]);
      toast.success('Extraction reopened for revision.');
    }).catch((err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to reopen extraction',
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
    values,
    // Server-loaded values are the baseline — opening a run must not re-POST
    // them as fresh proposals (the re-record-on-mount duplication).
    baselineValues: loadedValues,
    // Only PROPOSAL and REVIEW accept autosave writes. Past that
    // (consensus, finalized, pending) the backend rejects proposal
    // writes, which surfaced as a spurious "Error saving data
    // automatically" toast on opening a consolidated run. Mirrors the
    // QA full-screen gate; ``!isFinalized`` alone let ``consensus``
    // through.
    enabled:
      !!activeRunId &&
      !loading &&
      valuesInitialized &&
      (stage === 'proposal' || stage === 'review'),
  });

  // "Submit for review" — flush pending edits and advance the run from
  // PROPOSAL to REVIEW so other reviewers can pick up. Mirrors QA's
  // ``handlePublish`` shape but stops at REVIEW because Data Extraction
  // expects multi-reviewer accept/reject before consensus + finalize.
  // Declared after `useAutoSaveProposals` so the closure picks up the
  // already-initialized `saveNow` (avoids the temporal-dead-zone crash
  // on first render).
  // Cross PROPOSAL -> REVIEW: flush pending edits so the proposer's typed
  // values are persisted, advance the run (which materializes those human
  // proposals into that reviewer's own decisions), then refetch. Quiet (no
  // toast) so it can be driven automatically by ``useAutoAdvanceToReview``;
  // ``handleSubmitForReview`` wraps it for the explicit header button.
  const ensureReviewStage = async () => {
    if (!activeRunId || stage !== 'proposal') return;
    await saveNow();
    await advanceMutation.mutateAsync({ target_stage: 'review' });
    await Promise.all([refetchRun(), refreshValues()]);
  };

  const handleSubmitForReview = async () => {
    await ensureReviewStage();
    toast.success('Submitted for review.');
  };

  // Auto-advance PROPOSAL -> REVIEW the moment the run has content to review:
  // AI seeded proposals, or the reviewer made their first edit. This is what
  // makes per-user decisions, the reviewer counter, and "0% until you accept"
  // correct — the run no longer lingers in PROPOSAL (the multi-user bug class).
  // Idempotent: the hook never fires outside PROPOSAL and at most once per
  // transition. Also remediates pre-existing stuck runs the moment they open.
  const hasProposals = (proposals?.length ?? 0) > 0;
  useAutoAdvanceToReview({
    stage,
    shouldAdvance: hasProposals || hasUnsavedChanges,
    enabled: !!activeRunId && !loading && valuesInitialized,
    onAdvance: ensureReviewStage,
  });

    // "Reconcile" — flush any pending edits and advance REVIEW →
    // CONSENSUS so the ``ConsensusPanel`` becomes reachable. This
    // closes the Layer 2 gap where the extraction page had no UI to
    // hand the run over to the consensus phase (previously only QA's
    // ``handlePublish`` advanced past REVIEW). Gate at the call site
    // on ``permissions.canResolveConflicts`` (manager / consensus
    // roles) so reviewers don't accidentally trigger it.
  const handleReconcile = async () => {
    if (!activeRunId) return;
    await saveNow();
    await advanceMutation.mutateAsync({ target_stage: 'consensus' });
    await Promise.all([refetchRun(), refreshValues()]);
    toast.success('Reviewers reconciled. Resolve any divergences below.');
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
  const canCompare =
    permissions.canSeeOthers && reviewerSummary.decisionsByCoord.size > 0;

    // Hook for AI suggestions with callbacks to fill/clear field
  const handleAISuggestionAccepted = async (instanceId: string, fieldId: string, value: any) => {
      // Fill field automatically when suggestion is accepted
      console.warn('Accepting AI suggestion:', {instanceId, fieldId, value});
      // updateValue updates local state immediately
      // AISuggestionService.acceptSuggestion already saves to DB
      // No need to reload all values (refreshValues caused full page reload)
    updateValue(instanceId, fieldId, value);
  };

  const handleAISuggestionRejected = async (instanceId: string, fieldId: string) => {
      // Clear field when suggestion is rejected
      console.warn('Rejecting AI suggestion - clearing field:', {instanceId, fieldId});
      // updateValue updates local state immediately
      // AISuggestionService.rejectSuggestion already updates status in DB
      // No need to reload all values (refreshValues caused full page reload)
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

  const handleFinalize = async () => {
    if (!isComplete) {
        toast.error(t('pages', 'extractionScreenCompleteRequiredFields'));
      return;
    }

      // Validate required data
    if (!articleId || !projectId) {
        extractionLogger.error('handleFinalize', 'Incomplete data to finalize extraction', undefined, {
        articleId,
        projectId
      });
        toast.error(t('pages', 'extractionScreenErrorArticleNotFound'));
      return;
    }

      // Validate that there are instances to update
    if (!instances || instances.length === 0) {
        extractionLogger.warn('handleFinalize', 'No instances found to finalize', {
        articleId,
        projectId
      });
        toast.error(t('pages', 'extractionScreenErrorNoInstances'));
      return;
    }

    setSubmitting(true);

    const logger = extractionLogger;
    logger.info('handleFinalize', 'Starting extraction finalization', {
      articleId,
      projectId,
      instancesCount: instances.length,
      instanceIds: instances.map(i => i.id)
    });

    // Step 1: flush pending saves — translate save errors into a user-visible
    // message and bail out early so the run is not left half-progressed.
    logger.debug('handleFinalize', 'Salvando valores pendentes...', {
      valuesCount: Object.keys(values).length
    });
    let saveOk = true;
    await saveNow().catch((saveError: unknown) => {
      saveOk = false;
      const err = saveError instanceof Error
        ? saveError
        : new Error((saveError as any)?.message || 'Erro desconhecido ao salvar valores');
      logger.error('handleFinalize', 'Erro ao salvar valores pendentes', err, {
        errorMessage: err.message,
        errorCode: (saveError as any)?.code,
      });
      errorTracker.captureError(err, {
        component: 'ExtractionFullScreen',
        action: 'handleFinalize',
        projectId,
        articleId,
        metadata: {
          step: 'saveValues',
          errorCode: (saveError as any)?.code,
          errorDetails: (saveError as any)?.details,
        },
      });
      const msg = `${t('extraction', 'errors_saveValues')}: ${err.message || t('common', 'errors_unknownError')}`;
      logger.error('handleFinalize', 'Failed to finalize extraction', err, {articleId, projectId, finalError: msg});
      toast.error(msg, {duration: 6000});
      setSubmitting(false);
    });
    if (!saveOk) return;
    logger.info('handleFinalize', 'Valores salvos com sucesso');

    // Step 2: mark instances completed — markInstancesCompleted returns ErrorResult
    // so no throw/catch needed; branch on .ok.
    const instanceIds = instances.map(i => i.id);
    logger.debug('handleFinalize', 'Updating instance statuses...', {
      instanceIds,
      instancesCount: instanceIds.length
    });

    const markResult = await markInstancesCompleted(articleId!, instanceIds);
    if (!markResult.ok) {
      const updateError = markResult.error;
      logger.error('handleFinalize', 'Error updating instance statuses', updateError, {
        instanceIds,
        articleId,
      });
      errorTracker.captureError(updateError, {
        component: 'ExtractionFullScreen',
        action: 'handleFinalize',
        projectId,
        articleId,
        metadata: {step: 'updateInstances', instanceIds},
      });
      const errorMessage = updateError.message || t('pages', 'extractionScreenErrorFinalizeUnknown');
      logger.error('handleFinalize', 'Failed to finalize extraction', updateError, {articleId, projectId, finalError: errorMessage});
      toast.error(errorMessage, {duration: 6000});
      setSubmitting(false);
      return;
    }

    const updatedIds = markResult.data.updatedIds;
    const updatedCount = updatedIds.length;
    if (updatedCount === 0) {
      logger.warn('handleFinalize', 'No instances were updated', {instanceIds, articleId});
      const noUpdateMsg = t('pages', 'extractionScreenNoInstanceUpdated');
      logger.error('handleFinalize', 'Failed to finalize extraction', new Error(noUpdateMsg), {articleId, projectId, finalError: noUpdateMsg});
      toast.error(noUpdateMsg, {duration: 6000});
      setSubmitting(false);
      return;
    }
    if (updatedCount < instanceIds.length) {
      logger.warn('handleFinalize', 'Some instances were not updated', {
        expected: instanceIds.length,
        actual: updatedCount,
        instanceIds,
      });
    }

    logger.info('handleFinalize', 'Extraction finalized successfully', {
      articleId,
      instancesUpdated: updatedCount,
      totalInstances: instanceIds.length
    });

    toast.success(t('pages', 'extractionScreenFinalizeSuccess'));
    setSubmitting(false);
    handleBack();
  };

  // Loading state
  if (loading || valuesLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">{t('pages', 'extractionScreenLoading')}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (!article || !template) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
            <p className="text-destructive">{t('pages', 'extractionScreenErrorLoad')}</p>
            <Button onClick={handleBack}>{t('common', 'back')}</Button>
        </div>
      </div>
    );
  }

  // Template sem campos configurados
  if (entityTypes.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center">
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
  // buildExtractionTransition() owns all label/gate logic; the legacy
  // onFinalize/finalizeLabel block is removed.
  const transition = buildExtractionTransition({
    stage,
    canResolveConflicts: permissions.canResolveConflicts,
    isComplete,
    completed: completedFields,
    total: totalFields,
    onSubmit: handleSubmitForReview,
    onReconcile: handleReconcile,
    onFinalize: handleFinalize,
    onGuide,
  });

  // Reopen is surfaced via the header Menu instead of the orphaned banner.
  const canReopen = isFinalized || (!activeRunId && !!finalizedRun);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header — RunHeader compound via ExtractionHeader */}
      <ExtractionHeader
        projectId={projectId || ''}
        projectName={project?.name || t('pages', 'extractionScreenProjectFallback')}
        articleTitle={article.title}
        onBack={handleBack}
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
        onFinalize={handleFinalize}
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
        }}
        canReveal={false}
        onJumpToDivergence={() => setViewMode('compare')}
        // AI extraction seeds proposals and only works in PROPOSAL; once the
        // run is in REVIEW it's a one-time-done step (re-running would error).
        canRunAI={stage === 'proposal' || stage == null}
        onExtractionComplete={handleExtractionComplete}
        aiSuggestions={aiSuggestions}
        aiPendingCount={Object.keys(aiSuggestions).length}
        onAISuggestionsClick={() => {
          // P1: scroll to first suggestion or open panel
          console.warn('Clicked AI badge - scrolling to first suggestion');
        }}
        onRefreshInstances={handleRefreshInstances}
        onExtractionStateChange={setAiExtractionState}
        // Reopen moved into the header Menu
        canReopen={canReopen}
        onReopen={() => void handleReopen()}
        reopening={reopening}
      />

        {/* AI extraction progress - Rendered at page level to avoid conflicts */}
      {(aiExtractionState?.loading && aiExtractionState?.progress) || isProgressMinimized ? (
        <div className="fixed bottom-6 right-6 z-[9999] w-96 max-w-[calc(100vw-3rem)]">
          <FullAIExtractionProgress
            progress={aiExtractionState?.progress || { stage: 'extracting_models' }}
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

      {/* HITL revision/finalized status badges — now shown inline below header,
          without the orphaned banner wrapper. Reopen moved to header Menu.
          ReviewerProgressBadge stays here (it's informational, not an action). */}
      {(parentRunId || (!activeRunId && finalizedRun) || runDetail) ? (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs">
          <HITLStatusBadges
            kind="extraction"
            finalized={isFinalized || (!activeRunId && !!finalizedRun)}
            parentRunId={parentRunId}
          />
          {runDetail && stage !== 'proposal' ? (
            // Reviewer decisions only exist from REVIEW onward; showing the
            // counter during PROPOSAL always read "0/N" and confused users
            // who were actively filling the form.
            <ReviewerProgressBadge
              reviewerCount={reviewerSummary.reviewers.length}
              requiredReviewerCount={reviewerSummary.requiredReviewerCount}
              divergentCount={reviewerSummary.divergentCoords.size}
            />
          ) : null}
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
            onFinalize={handleFinalizeFromConsensus}
            isComplete={isComplete}
            isResolving={consensusMutation.isPending}
            isFinalizing={advanceMutation.isPending}
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
            {/* PDF Viewer (optional) - Extracted to isolated component */}
          <ExtractionPDFPanel
            articleId={articleId || ''}
            projectId={projectId || ''}
            showPDF={showPDF}
            store={viewerStore}
          />

            {/* Extraction form - Extracted to isolated component */}
          <ResizablePanel
            id="extraction-form"
            order={2}
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

