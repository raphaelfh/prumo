/**
 * Full-screen data extraction: the extraction residue of the shared run
 * screen. The lifecycle (stage commands, consensus, reveal, reopen, compare)
 * is `useRunLifecycleScreen`, the chrome is `RunScreenShell`; this page owns
 * what only extraction has — the bootstrap (active template + worklist), the
 * section/entry form tree with its entry dialogs, values, AI suggestions and
 * the form's progress.
 *
 * @page
 */

import {useEffect, useMemo, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {useNavigate, useParams} from 'react-router';
import {toast} from 'sonner';
import {Loader2} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {RunScreenShell} from '@/components/runs/RunScreenShell';
import type {SectionNavHandle} from '@/components/runs/SectionNavLayout';
import {ExtractionFormPanel} from '@/components/extraction/ExtractionFormPanel';
import {RemoveEntryDialog} from '@/components/extraction/entries/RemoveEntryDialog';
import {
  AddEntryDialog,
  RenameEntryDialog,
  type EntryIdentityChanges,
} from '@/components/extraction/AddEntryDialog';

import {useProjectTemplates} from '@/hooks/hitl/useProjectTemplates';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {useExtractedValues} from '@/hooks/extraction/useExtractedValues';
import {useExtractionSession} from '@/hooks/extraction/useExtractionSession';
import {useFinalizedExtractionRun} from '@/hooks/extraction/useFinalizedExtractionRun';
import {useExtractionProgress} from '@/hooks/extraction/useExtractionProgress';
import {useProposalDecision} from '@/hooks/extraction/useProposalDecision';
import {useAISuggestions} from '@/hooks/extraction/ai/useAISuggestions';
import {useRunAIExtraction} from '@/hooks/extraction/ai/useRunAIExtraction';
import {useAddEntry} from '@/hooks/extraction/useAddEntry';
import {useDeleteEntries} from '@/hooks/extraction/useDeleteEntries';
import {useUpdateInstanceIdentity} from '@/hooks/extraction/useUpdateInstanceIdentity';
import {useComparisonPermissions} from '@/hooks/shared/useComparisonPermissions';
import {useAiLinkMaps} from '@/hooks/runs/useAiLinkMaps';
import {useRunReader} from '@/hooks/runs/useRunReader';
import {
  useRunLifecycleScreen,
  useRunView,
  useRunWorklist,
} from '@/hooks/runs/useRunLifecycleScreen';

import {extractionInstanceService} from '@/services/extractionInstanceService';
import {extractionLogger} from '@/lib/extraction/observability';
import {DEFAULT_ENTRY_NOUN, displayEntryKey, entryKeyOf, keyFieldOf} from '@/lib/extraction/entryKey';
import {entrySlotKey, entrySlotsShowing} from '@/lib/extraction/entrySlots';
import {entityTypesFromRunView, instancesFromRunView} from '@/lib/extraction/runViewAdapters';
import {resolveExtractionViewState} from '@/lib/extraction/extractionViewState';
import {withReviewDecisionStatus} from '@/lib/extraction/proposalDecisionState';
import {isValueEmpty} from '@/lib/extraction/valueSemantics';
import {countActionableSuggestions} from '@/lib/ai-extraction/suggestionUtils';
import {isRunEditable} from '@/lib/runs/editability';
import {requiredCoordKeys} from '@/lib/runs/extractionFinalizeGate';
import {firstPendingInstanceId} from '@/lib/runs/suggestionLocate';
import {t} from '@/lib/copy';
import type {ExtractionRunStage} from '@/types/ai-extraction';
import {coordKey, parseCoordKey} from '@/lib/runs/coord';

export default function ExtractionFullScreen() {
  const { projectId, articleId } = useParams();

  // Page bootstrap, through the typed API client (ADR-0007): the project's
  // extraction templates, server-ordered newest first and narrowed to the
  // active rows, so [0] is the newest active template — the same pick as the
  // Configuration view's picker (useActiveTemplateSelection); and the
  // project's article worklist (header pager, next-article, the title on
  // screen). Entity types + instances come from the run view below.
  const templatesQuery = useProjectTemplates({projectId: projectId ?? '', kind: 'extraction'});
  const template = templatesQuery.data?.[0] ?? null;
  const worklist = useRunWorklist({
    kind: 'extraction',
    projectId,
    articleId,
    articleRoute: (id) => `/projects/${projectId}/extraction/${id}`,
  });
  // Null when the article is not in the project (or not visible to the
  // caller): the page renders its "not found" state with a Back affordance.
  const article = worklist.articles.find((a) => a.id === articleId) ?? null;
  const loading = templatesQuery.isLoading || worklist.isLoading;
  // A failed read, or a project with no active extraction template, surfaces
  // one toast and bounces to the project's extraction tab (effect below).
  // Only a read that left NO rows counts: both queries refetch in the
  // background, and a failed refetch keeps the rows the form opened with —
  // it must not throw the reviewer out mid-edit.
  const templatesError = templatesQuery.data === undefined ? templatesQuery.error : null;
  const bootstrapError = templatesError ?? worklist.error;
  const dataError = bootstrapError
    ? bootstrapError.message || t('extraction', 'errors_loadExtractionData')
    : templatesQuery.isSuccess && !template
      ? t('common', 'errors_templateNotFound')
      : null;

  // Current reviewer id from AuthContext (zero network).
  const { userId } = useCurrentUser();
  const currentUserId = userId ?? '';

  // The form's section layout: the header's suggestion locate opens a section through it.
  const sectionNavRef = useRef<SectionNavHandle>(null);

  const [modelToRemove, setModelToRemove] = useState<{
    id: string;
    name: string;
    hasData: boolean;
    fieldsCount: number;
  } | null>(null);

  // Open / resume the HITL session for this (article × project_template): the
  // backend ensures an extraction Run exists, seeds top-level instances, and
  // parks it in `extract` so autosave can fire immediately.
  const sessionResult = useExtractionSession({
    projectId,
    articleId,
    projectTemplateId: template?.id,
    enabled: !!projectId && !!articleId && !!template?.id,
  });
  const activeRunId = sessionResult.session?.runId ?? null;

  // The run view: frozen-snapshot entity types + materialised instances (the
  // form's single source of truth), the stage, reviewers and consensus rows.
  // The session embed seeds this cache, so it is present on first paint.
  const {
    data: runDetail,
    refetch: refetchRun,
    isError: runIsError,
    error: runErrorObj,
  } = useRunView(activeRunId);

  const entityTypes = useMemo(
    () => (runDetail ? entityTypesFromRunView(runDetail) : []),
    [runDetail],
  );
  const instances = useMemo(
    () => (runDetail ? instancesFromRunView(runDetail) : []),
    [runDetail],
  );

  const stage = (runDetail?.run.stage ?? null) as ExtractionRunStage | null;
  const isFinalized = stage === 'finalized';

  // Extracted values — the read path branches on stage.
  const {
    values,
    loadedValues,
    updateValue,
    reconcileValue,
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

  // The finalized run of this article, when the open run is not it: the
  // reopen target.
  const {
    finalizedRun,
    refresh: refreshFinalizedRun,
  } = useFinalizedExtractionRun({
    articleId: articleId || '',
    projectTemplateId: template?.id ?? null,
    enabled: !!articleId && !!template?.id && (!activeRunId || isFinalized),
  });

  // Progress over the materialised instances, so optional cardinality='many'
  // entities with no instances don't strand the form below the gate.
  const { completedFields, totalFields, completionPercentage, isComplete } =
    useExtractionProgress(values, entityTypes, instances);

  // Comparison access + the viewer write gate.
  const permissions = useComparisonPermissions(projectId || '', currentUserId, 'extraction');

  // AI suggestions over the run's own instances. A rejected suggestion clears
  // the field: updateValue writes null and autosave persists it (the coord's
  // AI link severed via the sessionAdoption tombstone).
  const {
    suggestions: aiSuggestions,
    sessionAdoption,
    suggestionsReady: aiSuggestionsReady,
    rejectSuggestion,
    getSuggestionsHistory,
    refresh: refreshAISuggestions,
  } = useAISuggestions({
    articleId: articleId || '',
    runId: activeRunId ?? undefined,
    instanceIds: instances.map((i) => i.id),
    // Wait for the run view: a lookup before it lands would be superseded at once.
    enabled: !!articleId && !!projectId && !!activeRunId && !!runDetail,
    onSuggestionRejected: (instanceId, fieldId) => updateValue(instanceId, fieldId, null),
  });

  // D0: coords whose value has a traceable AI basis — see useAiLinkMaps.
  const { persistedAiLinkByKey } = useAiLinkMaps({
    decisions: runDetail?.decisions,
    currentUserId,
    sessionAdoption,
  });

  // Reviewer decisions autosave in EXTRACT. Pending edits flush on run
  // switches and unmount using the outgoing session's authority.
  const proposalDecisions = useProposalDecision({
    reviewerId: currentUserId,
    decisions: runDetail?.decisions,
    onConfirmed: ({instanceId, fieldId}, value) => reconcileValue(instanceId, fieldId, value),
    runId: activeRunId,
    stage,
    values,
    // Server-loaded values are the baseline — opening a run must not re-POST them.
    baselineValues: loadedValues,
    baselineLinkByKey: persistedAiLinkByKey,
    // Only the editable EXTRACT stage accepts writes; viewer writes 403
    // server-side (forms render read-only — this is the flush-path belt).
    // Bootstrap loading stays out of this gate: the outgoing run-switch flush
    // must keep its captured writable state while the next run loads.
    enabled:
      !!activeRunId &&
      valuesInitialized &&
      isRunEditable(stage) &&
      permissions.userRole !== 'viewer',
  });
  const { saveState, lastSavedAt, saveNow } = proposalDecisions;

  // The editable review table: an editing reviewer's surface.
  const reviewTable = runDetail?.run.kind === 'extraction' && isRunEditable(stage) && permissions.userRole !== 'viewer';
  const reader = useRunReader(
    runDetail && !permissions.loading ? !!reviewTable : null,
  );

  const lifecycle = useRunLifecycleScreen({
    kind: 'extraction',
    formProgress: { isComplete, completed: completedFields, total: totalFields },
    projectId,
    runId: activeRunId,
    runDetail,
    permissions,
    currentUserId,
    saveNow,
    goToNextArticle: worklist.goToNextArticle,
    requiredCoords: requiredCoordKeys(instances, entityTypes),
    refetchSession: sessionResult.refetch,
    refreshReaders: () => Promise.all([refreshValues(), refreshFinalizedRun()]),
    finalizedRunId: finalizedRun?.id ?? null,
    // A blocked primary click scrolls the form back to its top.
    onBlocked: () => {
      const el = document.querySelector('[data-scroll-container="extraction-form"] [data-radix-scroll-area-viewport]');
      if (el) el.scrollTop = 0;
    },
  });

  const selectSuggestion = async (instanceId: string, fieldId: string, id: string, value: unknown) => {
    const field = entityTypes.flatMap(entity => entity.fields).find(item => item.id === fieldId);
    await proposalDecisions.toggle({instanceId, fieldId, id, value,
      allowsNoInformation: field?.allows_no_information !== false});
  };
  const acceptSuggestion = async (instanceId: string, fieldId: string) => {
    const proposal = aiSuggestions[coordKey(instanceId, fieldId)];
    if (proposal) await selectSuggestion(instanceId, fieldId, proposal.id, proposal.value);
  };

  // Shared actionable count (ADR-0016 Phase 4): unresolved AI proposals awaiting
  // a human decision; in the review table, confirmed decisions resolve them.
  const pendingSuggestions = reviewTable ? withReviewDecisionStatus(aiSuggestions, proposalDecisions.isAccepted) : aiSuggestions;
  const aiPendingCount = countActionableSuggestions(pendingSuggestions);

  // After an AI extraction job completes, reload suggestions at once: the job
  // reports completed only after the proposals commit, and AI never writes the
  // caller's values. Suggestions keep the previous map until the new one lands.
  const handleExtractionComplete = () => refreshAISuggestions();

  // AI extraction always runs on the OPEN session run (``extractForRun`` reuses
  // it, preserving human decisions) — never a run-less fork that would shadow
  // the reviewer's saved decisions. The job hook invalidates only the
  // extraction key family, so the run view is re-read here too.
  const { extractForRun, loading: extractingAI } = useRunAIExtraction({
    onSuccess: async () => {
      await Promise.all([refetchRun(), handleExtractionComplete()]);
    },
  });
  const onExtractWithAI = () => {
    if (!articleId || !template?.id || !activeRunId) return;
    void extractForRun({
      projectId: projectId ?? '',
      articleId,
      templateId: template.id,
      runId: activeRunId,
    }).catch((error: unknown) => {
      console.error('[ExtractionFullScreen] Run AI extraction error:', error);
    });
  };

  // Redirect on a critical bootstrap error.
  const navigate = useNavigate();
  const exitRoute = worklist.exitRoute;
  useEffect(() => {
    if (dataError && projectId) {
      toast.error(dataError);
      navigate(exitRoute);
    }
  }, [dataError, projectId, navigate, exitRoute]);

  /**
   * Open the remove dialog for one entry of a repeating section. Any group's
   * entry cascades through its subtree, so the dialog names how much data
   * goes with it — counted from the values in memory.
   */
  const handleOpenRemoveDialog = (instanceId: string) => {
    const instance = instances.find((i) => i.id === instanceId);
    if (!instance) return;
    const subtree = new Set<string>([instanceId]);
    for (const i of instances) {
      if (i.parent_instance_id && subtree.has(i.parent_instance_id)) subtree.add(i.id);
    }
    const fieldsCount = Object.entries(values).filter(
      ([key, value]) =>
        subtree.has(parseCoordKey(key).instanceId) && !isValueEmpty(value),
    ).length;
    setModelToRemove({
      id: instanceId,
      name: instance.label ?? '',
      hasData: fieldsCount > 0,
      fieldsCount,
    });
  };

  const handleConfirmRemoveModel = async () => {
    if (!modelToRemove) return;
    const { id: modelId, name: entryName } = modelToRemove;
    extractionLogger.info('removeModelHandler', 'Starting model removal', {
      modelId,
      entryName,
      hasData: modelToRemove.hasData,
      fieldsCount: modelToRemove.fieldsCount,
    });

    // .then().catch() — no try/catch or throw-in-try in a component function.
    await extractionInstanceService.removeInstance(modelId).then(async () => {
      extractionLogger.info('removeModelHandler', 'Model removed successfully', { modelId, entryName });
      setModelToRemove(null);
      // Reload the run view so child instances leave the UI; the entry is
      // already gone, so a failed reload only logs.
      await refetchRun().catch((refreshError: unknown) => {
        extractionLogger.error('removeModelHandler', 'Error reloading run view after removal', refreshError instanceof Error ? refreshError : undefined, { modelId });
      });
    }).catch((error: unknown) => {
      extractionLogger.error('removeModelHandler', 'Failed to remove model', error instanceof Error ? error : undefined, { modelId, entryName });
      // Propagates to the dialog's onConfirm, which displays it.
      throw error;
    });
  };

  // Which entry each rendered group is showing. Held here, not inside the
  // sections, because the nav rail scopes a nested section's progress to the
  // entry the form is showing.
  const [activeEntries, setActiveEntries] = useState<Record<string, string>>({});
  const setActiveEntry = (slot: string, entryId: string) =>
    setActiveEntries((prev) => (prev[slot] === entryId ? prev : {...prev, [slot]: entryId}));

  // Adding an entry to a repeating section: the dialog and the create live in
  // the hook; the identity is stamped at creation.
  const addEntry = useAddEntry({
    projectId,
    articleId,
    templateId: template?.id,
    entityTypes,
    instances,
    onCreated: refetchRun,
    onEntryCreated: (target, instanceId) =>
      setActiveEntry(
        entrySlotKey(articleId ?? '', target.entityTypeId, target.parentInstanceId),
        instanceId,
      ),
  });

  // Entry deletion, single and bulk — manager only; undefined hides each affordance.
  const {deleteOne: handleRemoveInstance, deleteSelected: handleDeleteEntries} = useDeleteEntries({
    projectId,
    articleId,
    templateId: template?.id,
    onDeleted: refetchRun,
    values,
    canDelete: permissions.userRole === 'manager',
  });

  // Rename / re-key — one write for cards and for the active model.
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
  const modelBeingRenamed = instances.find((i) => i.id === modelToRename) ?? null;
  // The noun and the key field come from the entry's OWN section.
  const renamedEntityType = entityTypes.find((et) => et.id === modelBeingRenamed?.entity_type_id);
  const removedEntityType = entityTypes.find(
    (et) => et.id === instances.find((i) => i.id === modelToRemove?.id)?.entity_type_id,
  );

  // Single render gate. ``no-fields`` only when the run is loaded and carries
  // no entity types — a missing run is an error or a loader, never a false
  // "template has no fields" (the #324 masking regression).
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

  if (viewState.kind === 'load-error') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive">{t('pages', 'extractionScreenErrorLoad')}</p>
          <Button onClick={worklist.exit}>{t('common', 'back')}</Button>
        </div>
      </div>
    );
  }

  // The run could not be opened: surface it with a retry instead of "No fields".
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
            <Button variant="outline" onClick={worklist.exit}>{t('common', 'back')}</Button>
          </div>
        </div>
      </div>
    );
  }

  if (viewState.kind === 'no-fields') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-6 max-w-md">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">{t('pages', 'extractionScreenNoFieldsTitle')}</h3>
            <p className="text-muted-foreground">{t('pages', 'extractionScreenNoFieldsDesc')}</p>
          </div>
          <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
            <p className="font-medium">{t('pages', 'extractionScreenToResolve')}</p>
            <ul className="text-left space-y-1 text-muted-foreground">
              <li>• {t('pages', 'extractionScreenContactManager')}</li>
              <li>• {t('pages', 'extractionScreenRequestConfig')}</li>
              <li>• {t('pages', 'extractionScreenOrConfigureTemplate')}</li>
            </ul>
          </div>
          <Button onClick={worklist.exit}>{t('common', 'back')}</Button>
        </div>
      </div>
    );
  }

  // Only ``ready`` reaches here, where article and template are non-null;
  // the guard narrows them for TypeScript.
  if (!article || !template) {
    return null;
  }

  const formPanel = (
    <ExtractionFormPanel
      viewMode={lifecycle.compare.active ? 'compare' : 'extract'}
      formViewProps={{
        presentation: reviewTable ? 'review-table' : 'default',
        reviewDecisions: proposalDecisions,
        reviewProposals: runDetail?.proposals,
        reviewerId: currentUserId,
        instances,
        values,
        updateValue,
        aiSuggestions,
        acceptSuggestion,
        selectSuggestion,
        rejectSuggestion,
        getSuggestionsHistory,
        onRefreshInstances: async () => {
          await refetchRun();
        },
        entityTypes,
        activeEntries,
        setActiveEntry,
        handleOpenRenameDialog: setModelToRename,
        // The dialog only exists to confirm the delete the hook withheld.
        handleOpenRemoveDialog: handleRemoveInstance ? handleOpenRemoveDialog : undefined,
        handleAddInstance: addEntry.open,
        handleRemoveInstance,
        handleDeleteEntries,
        handleRenameInstance,
        projectId: projectId || '',
        articleId: articleId || '',
        templateId: template.id,
        runId: activeRunId,
        onExtractionComplete: handleExtractionComplete,
        sectionNavRef,
      }}
      compareViewProps={{
        decisionsByCoord: lifecycle.reviewers.summary.decisionsByCoord,
        entityTypes,
        instances,
        ownValues: values,
        reviewerLabelById: lifecycle.reviewers.profiles.labelById,
        reviewerAvatarById: lifecycle.reviewers.profiles.avatarById,
      }}
    />
  );

  return (
    <div className="h-full bg-background">
      <RunScreenShell
        lifecycle={lifecycle}
        runDetail={runDetail}
        permissions={permissions}
        currentUserId={currentUserId}
        worklist={worklist}
        reader={reader}
        projectId={projectId || ''}
        articleId={articleId || ''}
        title={article.title}
        progress={{ completed: completedFields, total: totalFields, pct: completionPercentage }}
        save={{ state: saveState, lastSavedAt }}
        ai={{
          pendingCount: isFinalized ? 0 : aiPendingCount,
          // AI seeds proposals only in EXTRACT (re-running past it errors), and
          // only on an OPEN session run — never a parallel run that would
          // orphan the reviewer's edits.
          canExtract: !!activeRunId && (stage === 'extract' || stage == null),
          extracting: extractingAI,
          onExtract: onExtractWithAI,
          onOpenSuggestions: () => {
            // "Review N pending suggestions": select the entries holding the
            // first pending suggestion and commit that render, so the section
            // revealed is the one holding it.
            const pendingId = firstPendingInstanceId(pendingSuggestions);
            const instance = instances.find((i) => i.id === pendingId);
            if (!instance) return;
            const slots = entrySlotsShowing(articleId ?? '', instance.id, instances, entityTypes);
            flushSync(() => slots.forEach(([slot, entryId]) => setActiveEntry(slot, entryId)));
            sectionNavRef.current?.revealSection(instance.entity_type_id);
          },
        }}
        formPanel={formPanel}
        consensus={{
          entityTypes,
          instances,
          ownValues: values,
          // A deeper history window (50) so adopted versions rarely fall
          // outside it; a not-yet-loaded/failed map passes null so no coord mislabels.
          aiTrace: {
            articleId: articleId || '',
            getHistory: (i, f) => getSuggestionsHistory(i, f, 50),
            aiSuggestions: aiSuggestionsReady ? aiSuggestions : null,
          },
        }}
      />

      <AddEntryDialog {...addEntry.dialogProps} />

      <RenameEntryDialog
        open={modelBeingRenamed !== null}
        entryLabel={renamedEntityType?.entry_label ?? DEFAULT_ENTRY_NOUN}
        keyLabel={renamedEntityType ? (keyFieldOf(renamedEntityType.fields)?.label ?? null) : null}
        initialLabel={modelBeingRenamed?.label ?? ''}
        initialKey={modelBeingRenamed ? displayEntryKey(modelBeingRenamed) : null}
        siblingKeys={instances
          .filter(
            (i) =>
              i.entity_type_id === modelBeingRenamed?.entity_type_id && i.id !== modelToRename,
          )
          .map((i) => entryKeyOf(i) ?? i.label)}
        onConfirm={async (changes) => {
          if (!modelToRename) return;
          await handleRenameInstance(modelToRename, changes);
          setModelToRename(null);
        }}
        onCancel={() => setModelToRename(null)}
      />

      <RemoveEntryDialog
        open={!!modelToRemove}
        entryLabel={removedEntityType?.entry_label ?? DEFAULT_ENTRY_NOUN}
        entryName={modelToRemove?.name || ''}
        hasExtractedData={modelToRemove?.hasData || false}
        extractedFieldsCount={modelToRemove?.fieldsCount || 0}
        onConfirm={handleConfirmRemoveModel}
        onCancel={() => setModelToRemove(null)}
      />
    </div>
  );
}
