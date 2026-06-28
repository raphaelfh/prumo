/**
 * Quality Assessment full-screen page (PROBAST / QUADAS-2 / future tools).
 *
 * Flow:
 * 1. Open (or resume) a session via `POST /api/v1/hitl/sessions` with
 *    `kind=quality_assessment` — clones the global QA template into the
 *    project, ensures one instance per domain for the article, and parks
 *    a Run in the PROPOSAL stage.
 * 2. Render the cloned template tree (entity_types + fields use the cloned
 *    ids, so proposal writes coordinate-cohere with the Run's version).
 * 3. Each field change becomes a `human` proposal on the Run; reloading
 *    the page rehydrates from the latest proposal per (instance, field).
 *
 * Final publish (advance review → consensus → finalize) is wired to the
 * "Publish assessment" button, which posts a manual_override consensus per
 * field to materialize PublishedState rows.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Loader2 } from "lucide-react";

import { RunSplitShell } from "@/components/runs/RunSplitShell";
import { QASectionAccordion } from "@/components/assessment/QASectionAccordion";
import { RunReviewerComparison } from "@/components/runs/RunReviewerComparison";
import type {
  ComparisonEntityType,
  ComparisonInstance,
} from "@/components/runs/RunReviewerComparison";
import { createViewerStore, subscribeReaderLocate } from "@prumo/pdf-viewer";
import { RunPdfContent } from "@/components/runs/RunPdfContent";
import { Badge } from "@/components/ui/badge";
import { useProjectQATemplate } from "@/hooks/qa/useProjectQATemplate";
import { resolveQATemplateKind } from "@/services/projectSettingsService";
import { useQAAssessmentSession } from "@/hooks/qa/useQAAssessmentSession";
import { useAISuggestions } from "@/hooks/extraction/ai/useAISuggestions";
import { useRunAIExtraction } from "@/hooks/extraction/ai/useRunAIExtraction";
import {
  useAdvanceRun,
  useAutoSaveProposals,
  useCreateConsensus,
  useReopenRun,
  useReviewerSummary,
  useRun,
  useRunReviewers,
} from "@/hooks/runs";
import { ConsensusPanel } from "@/components/runs/ConsensusPanel";
import { RunHeader } from "@/components/runs/header";
import { buildQaTransition } from "@/lib/qa/qaTransition";
import { usePdfPanel } from "@/hooks/usePdfPanel";
import { setManagerReviewVisibility } from "@/services/hitlConfigService";
import type { ExtractionRunStage } from "@/types/ai-extraction";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { useSidebar } from "@/contexts/SidebarContext";
import { t } from "@/lib/copy";

interface FieldKey {
  instanceId: string;
  fieldId: string;
}

// Key shape ``${instanceId}_${fieldId}`` is shared with the autosave
// hook (``useAutoSaveProposals``) which splits on ``_``. UUIDs use
// hyphens, so the underscore split is unambiguous.
function keyOf(k: FieldKey): string {
  return `${k.instanceId}_${k.fieldId}`;
}

export default function QualityAssessmentFullScreen() {
  const { projectId, articleId, templateId } = useParams<{
    projectId: string;
    articleId: string;
    templateId: string;
  }>();
  const navigate = useNavigate();

  // The ``:templateId`` URL segment may point at either a project-level
  // ``project_extraction_templates`` row (when the user landed here from
  // the QA articles table — that table already operates on a project
  // clone) or a global ``extraction_templates_global`` row (when the
  // user opened QA from the data-extraction header menu, which lists
  // the global pool). Resolve once before opening the session so we can
  // route the id to the correct request field.
  const [resolvedTemplate, setResolvedTemplate] = useState<
    | { kind: "project"; id: string }
    | { kind: "global"; id: string }
    | { kind: "missing" }
    | null
  >(null);

  // Reset the resolution whenever the URL segment changes (during render,
  // so the lookup effect below never sets state synchronously).
  const [prevTemplateId, setPrevTemplateId] = useState(templateId);
  if (templateId !== prevTemplateId) {
    setPrevTemplateId(templateId);
    setResolvedTemplate(null);
  }

  useEffect(() => {
    if (!templateId) {
      return;
    }
    let cancelled = false;
    resolveQATemplateKind(templateId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setResolvedTemplate({kind: "missing"});
        return;
      }
      const {projectId: projId, globalId} = result.data;
      if (projId) {
        setResolvedTemplate({kind: "project", id: projId});
      } else if (globalId) {
        setResolvedTemplate({kind: "global", id: globalId});
      } else {
        setResolvedTemplate({kind: "missing"});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const {
    session,
    loading: sessionLoading,
    error: sessionError,
    refetch: refetchSession,
  } = useQAAssessmentSession({
    projectId,
    articleId,
    globalTemplateId:
      resolvedTemplate?.kind === "global" ? resolvedTemplate.id : undefined,
    projectTemplateId:
      resolvedTemplate?.kind === "project" ? resolvedTemplate.id : undefined,
    enabled: resolvedTemplate?.kind === "global"
      || resolvedTemplate?.kind === "project",
  });

  const {
    template,
    domains,
    loading: templateLoading,
    error: templateError,
  } = useProjectQATemplate({
    projectTemplateId: session?.projectTemplateId,
    enabled: !!session,
  });

  const { data: runDetail, refetch: refetchRun } = useRun(session?.runId ?? "", {
    enabled: !!session?.runId,
  });

  const advanceMutation = useAdvanceRun(session?.runId ?? "");
  const consensusMutation = useCreateConsensus(session?.runId ?? "");
  const reopenMutation = useReopenRun();
  const reviewerSummary = useReviewerSummary(runDetail);
  const reviewerProfiles = useRunReviewers(session?.runId ?? null, {
    enabled: !!session?.runId,
  });

  // Assess vs. compare view. Compare renders the shared, server-blinded
  // RunReviewerComparison (same component the extraction screen uses).
  const [viewMode, setViewMode] = useState<"assess" | "compare">("assess");
  const { userId } = useCurrentUser();
  const permissions = useComparisonPermissions(
    projectId ?? "",
    userId ?? "",
    "quality_assessment",
  );
  // Peer values come from the server-blinded runDetail
  // (reviewerSummary.decisionsByCoord) — no separate fetch. Compare is offered
  // only when the caller may see peers (manager/consensus, per the live
  // per-kind setting) AND peers actually exist.
  const canCompare =
    permissions.canSeeOthers && reviewerSummary.decisionsByCoord.size > 0;
  // Never strand the user on the compare view if the toggle disappears
  // (e.g. peers drop out or the setting flips off).
  const effectiveViewMode = canCompare ? viewMode : "assess";

  // Local input state for the form. Hydrated from the latest proposal per
  // (instance, field) once the Run detail loads.
  const [values, setValues] = useState<Record<string, unknown>>({});

  // Hydrate during render when a new Run detail lands (instead of a
  // synchronous setState in an effect).
  const [prevRunDetail, setPrevRunDetail] = useState(runDetail);
  if (runDetail !== prevRunDetail) {
    setPrevRunDetail(runDetail);
    if (runDetail) {
      const latestByCoord = new Map<string, unknown>();
      // Proposals are returned newest-first by the API; iterate so the LAST
      // write wins per coord regardless of order.
      for (const p of runDetail.proposals) {
        const k = keyOf({ instanceId: p.instance_id, fieldId: p.field_id });
        const value =
          p.proposed_value &&
          typeof p.proposed_value === "object" &&
          "value" in p.proposed_value
            ? (p.proposed_value.value as unknown)
            : (p.proposed_value as unknown);
        latestByCoord.set(k, value);
      }
      setValues((prev) => {
        const next: Record<string, unknown> = { ...prev };
        for (const [k, v] of latestByCoord) {
          if (!(k in next)) next[k] = v;
        }
        return next;
      });
    }
  }

  // The autosave hook below watches ``values`` and debounces writes;
  // ``handleValueChange`` only needs to update local state. Lifecycle
  // handlers in the hook (unmount flush, ``pagehide``, visibility) carry
  // the write through any navigation that happens mid-debounce.
  const handleValueChange = (instanceId: string, fieldId: string, value: unknown) => {
    const k = keyOf({ instanceId, fieldId });
    setValues((prev) => ({ ...prev, [k]: value }));
  };

  // Server baseline for autosave — the same per-coord map the hydration
  // effect applies, computed inline from ``runDetail`` so it is present when
  // the hydrated ``values`` arrive. Stops opening an assessment from
  // re-POSTing loaded values as fresh proposals.
  const loadedValuesMap: Record<string, unknown> = {};
  for (const p of runDetail?.proposals ?? []) {
    const k = keyOf({ instanceId: p.instance_id, fieldId: p.field_id });
    const value =
      p.proposed_value &&
      typeof p.proposed_value === "object" &&
      "value" in p.proposed_value
        ? (p.proposed_value.value as unknown)
        : (p.proposed_value as unknown);
    loadedValuesMap[k] = value;
  }
  const loadedValues = loadedValuesMap;

  const { saveState, lastSavedAt, saveNow } =
    useAutoSaveProposals({
      runId: session?.runId ?? null,
      values,
      baselineValues: loadedValues,
      enabled:
        !!session && !!runDetail && runDetail.run.stage === "extract",
    });

  // AI suggestions wiring — kind-agnostic hooks reused from Data
  // Extraction. Two key adaptations for QA:
  //  - ``runId`` scopes the suggestion query so a parallel extraction
  //    run on the same article doesn't leak in.
  //  - ``acceptStrategy: 'human-proposal'`` keeps the run in PROPOSAL
  //    (no ReviewerDecision write). Accept just bubbles the value to
  //    ``handleValueChange``, which records a fresh ``human`` proposal
  //    via the existing form pipeline.
  const sessionInstanceIds = Object.values(session?.instancesByEntityType ?? {});

  const {
    suggestions: aiSuggestions,
    acceptSuggestion: acceptAISuggestion,
    rejectSuggestion: rejectAISuggestion,
    getSuggestionsHistory: getAISuggestionsHistory,
    isActionLoading: isAIActionLoading,
    refresh: refreshAISuggestions,
  } = useAISuggestions({
    articleId: articleId ?? "",
    projectId: projectId ?? "",
    runId: session?.runId,
    instanceIds: sessionInstanceIds,
    acceptStrategy: "human-proposal",
    enabled: !!session,
    onSuggestionAccepted: (instanceId, fieldId, value) => {
      handleValueChange(instanceId, fieldId, value);
    },
    onSuggestionRejected: (instanceId, fieldId) => {
      // Clear the field locally — does not need a backend write because
      // QA hides AI suggestions from the form on reject.
      handleValueChange(instanceId, fieldId, null);
    },
  });

  const { extractForRun, loading: extractingAI } = useRunAIExtraction({
    onSuccess: async () => {
      await refetchRun();
      await refreshAISuggestions();
    },
  });

  const finalized = runDetail?.run.stage === "finalized";
  const parentRunId =
    runDetail?.run.parameters &&
    typeof runDetail.run.parameters === "object" &&
    "parent_run_id" in runDetail.run.parameters
      ? String(runDetail.run.parameters.parent_run_id)
      : null;

  const [publishing, setPublishing] = useState(false);
  const [reopening, setReopening] = useState(false);

  // PDF panel state — lifted so RunHeader.PanelToggle can share the same toggle.
  const pdfPanelState = usePdfPanel({ initialOpen: false });

  // ONE stable viewer store shared by the form panel (evidence popover) and the
  // PDF reader — the prerequisite for citation locate + highlight. RunSplitShell
  // wraps both panels in one ViewerProvider via `viewerStore`, and RunPdfContent
  // receives `store={viewerStore}`, so both resolve the SAME store.
  const [viewerStore] = useState(createViewerStore);

  // Citation-locate reveals the (collapsed) PDF panel; ref so we subscribe once.
  const openPdfRef = useRef(pdfPanelState.open);
  useEffect(() => {
    openPdfRef.current = pdfPanelState.open;
  }, [pdfPanelState.open]);
  useEffect(
    () => subscribeReaderLocate(viewerStore, () => openPdfRef.current()),
    [viewerStore],
  );

  // App navigation sidebar (provided by RunWorkspaceShell). SidebarToggle + ⌘B
  // collapse the desktop sidebar (lg+); toggleMobile opens the drawer below lg.
  const { sidebarCollapsed, toggleSidebar, toggleMobile } = useSidebar();

  // "\" toggles the source (PDF) panel. No J/K — QA has a single article.
  // ``usePdfPanel`` returns a fresh object each render, so hold the toggle in a
  // ref and register the listener ONCE (empty deps) to avoid re-binding every
  // render. Cleanup via return, NOT try/finally (React Compiler).
  const togglePdfRef = useRef(pdfPanelState.toggle);
  useEffect(() => {
    togglePdfRef.current = pdfPanelState.toggle;
  }, [pdfPanelState.toggle]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement || tgt.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "\\") {
        e.preventDefault();
        togglePdfRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Reveal: manager can un-blind QA reviewer identities for this project.
  const canReveal = permissions.userRole === "manager" && permissions.isBlindMode;
  const onReveal = () => {
    void setManagerReviewVisibility(projectId ?? "", "quality_assessment", true)
      .then(() => permissions.refresh())
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : String(e)),
      );
  };

  const fieldLabelByCoordMap: Record<string, string> = {};
  if (session) {
    for (const domain of domains) {
      const instanceId = session.instancesByEntityType[domain.entityType.id];
      if (instanceId) {
        for (const f of domain.fields) {
          fieldLabelByCoordMap[`${instanceId}::${f.id}`] = `${domain.entityType.label} · ${f.label}`;
        }
      }
    }
  }
  const fieldLabelByCoord = fieldLabelByCoordMap;

  const inConsensusStage = runDetail?.run.stage === "consensus";

  const handleSelectExisting = async (params: {
    instanceId: string;
    fieldId: string;
    decisionId: string;
  }) => {
    await consensusMutation.mutateAsync({
      instance_id: params.instanceId,
      field_id: params.fieldId,
      mode: "select_existing",
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
      mode: "manual_override",
      value: { value: params.value },
      rationale: params.rationale,
    });
    await refetchRun();
  };

  const handleFinalizeFromConsensus = async () => {
    if (!session) return;
    await advanceMutation.mutateAsync({ target_stage: "finalized" });
    await refetchRun();
    toast.success(t("qa", "finalizationSuccess"));
  };

  // Plain-identifier dep so the compiler can track this dep without
  // optional-chaining (optional-chained deps like `session?.runId` defeat it).
  const sessionRunId = session?.runId;
  const handleReopen = async () => {
    if (!sessionRunId) return;
    setReopening(true);
    await reopenMutation.mutateAsync(sessionRunId).then(async () => {
      // The new run is now the latest non-terminal one for this triple,
      // so refetching the session picks it up. Local form state is reset
      // since the new run carries its own seeded proposals.
      setValues({});
      await refetchSession();
      toast.success(t("qa", "reopenSuccess"));
    }).catch((err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : t("qa", "reopenError"),
      );
    });
    setReopening(false);
  };
  const handlePublish = async () => {
    if (!session || !runDetail) return;

    // Preflight: an empty publish has no semantic meaning — the run would
    // reach FINALIZED with zero PublishedState rows. Bail out before any
    // stage-advance side-effect so the run is not left half-progressed.
    const filled = Object.entries(values).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    );
    if (filled.length === 0) {
      toast.error(t("qa", "publishEmptyError"));
      return;
    }

    setPublishing(true);
    const doPublish = async () => {
      // Flush any pending debounced edits before the stage advances —
      // otherwise the consensus loop below would publish stale values.
      await saveNow();

      // Collapsed lifecycle: the run sits in the editable EXTRACT stage; the
      // publish walks it straight to CONSENSUS (no separate review stage).
      const stage = runDetail.run.stage;
      if (stage === "extract") {
        await advanceMutation.mutateAsync({ target_stage: "consensus" });
      }

      // Manual-override consensus per filled (instance, field) — writes the
      // value directly to PublishedState without requiring a per-field
      // ReviewerDecision row.
      for (const [k, v] of filled) {
        const [instanceId, fieldId] = k.split("_");
        await consensusMutation.mutateAsync({
          instance_id: instanceId,
          field_id: fieldId,
          mode: "manual_override",
          value: { value: v },
          rationale: "Published from Quality-Assessment form",
        });
      }

      await advanceMutation.mutateAsync({ target_stage: "finalized" });
      await refetchRun();
      toast.success(t("qa", "publishSuccess"));
    };
    await doPublish().catch((err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : t("qa", "publishError"),
      );
    });
    setPublishing(false);
  };

  const sortedDomains = domains;

  // Compare-view inputs derived from the QA template tree: one instance per
  // domain (session.instancesByEntityType), shaped for the shared
  // RunReviewerComparison. ownValues is the form's `_`-keyed map; decisions
  // come in `::`-keyed via reviewerSummary — the component bridges the two.
  const compareEntityTypes: ComparisonEntityType[] = sortedDomains.map(
    (domain) => ({
      id: domain.entityType.id,
      label: domain.entityType.label,
      fields: domain.fields.map((f) => ({ id: f.id, label: f.label })),
    }),
  );
  const compareInstances: ComparisonInstance[] = sortedDomains
    .map((domain): ComparisonInstance | null => {
      const instanceId = session?.instancesByEntityType[domain.entityType.id];
      return instanceId
        ? {
            id: instanceId,
            entity_type_id: domain.entityType.id,
            parent_instance_id: null,
            label: null,
          }
        : null;
    })
    .filter((i): i is ComparisonInstance => i !== null);

  if (!projectId || !articleId || !templateId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {t("qa", "missingRouteParams")}
      </div>
    );
  }

  const loading =
    resolvedTemplate === null || sessionLoading || templateLoading;
  const error =
    resolvedTemplate?.kind === "missing"
      ? t("qa", "templateNotFound").replace("{{templateId}}", templateId ?? "")
      : (sessionError ?? templateError);

  // The API returns stage as `string`; cast to the narrow union the header lib expects.
  const runStage = (runDetail?.run.stage ?? null) as ExtractionRunStage | null;

  // Stage-driven transition for RunHeader.PrimaryAction.
  const qaTransition = buildQaTransition({
    stage: runStage,
    canResolveConflicts: permissions.canResolveConflicts,
    onPublish: handlePublish,
    onFinalize: handleFinalizeFromConsensus,
  });

  // AI extract callback — called by RunHeader.AIActions.
  const onExtractWithAI = () => {
    if (!session || !projectId || !articleId) return;
    void extractForRun({
      projectId,
      articleId,
      templateId: session.projectTemplateId,
      runId: session.runId,
      skipFieldsWithHumanProposals: true,
      autoAdvanceToReview: false,
    });
  };

  // Per-domain AI extract completion: refetch session + run + suggestions so
  // accepted proposals and their evidence surface (run may have re-resolved).
  const handleSectionExtractionComplete = async () => {
    await refetchSession();
    await refetchRun();
    await refreshAISuggestions();
  };

  const versionLabel = template ? `v${template.version}` : "";

  const header = (
    // HeaderShell (inside RunHeader) owns the @container/headerbar — no consumer wrapper.
      <RunHeader
        value={{
          kind: "qa",
          stage: runStage,
          isRevision: !!parentRunId,
          role: permissions.userRole,
          isBlind: permissions.isBlindMode,
          canReveal,
          onReveal,
          progress: { completed: 0, total: 0, pct: 0 },
          reviewers: {
            count: reviewerSummary.reviewers.length,
            required: reviewerSummary.requiredReviewerCount,
            divergent: reviewerSummary.divergentCoords.size,
          },
          transition: qaTransition,
          submitting: publishing,
          onJumpToDivergence: canCompare
            ? () => setViewMode("compare")
            : undefined,
        }}
      >
        <RunHeader.Left>
          <RunHeader.MobileNav onOpen={toggleMobile} />
          <RunHeader.SidebarToggle pressed={!sidebarCollapsed} onToggle={toggleSidebar} />
          <RunHeader.Breadcrumb
            onBack={() => navigate(`/projects/${projectId}`)}
            crumbs={[{ label: template?.name ?? "" }]}
          />
          {/* QA kind badge — compact identifier next to breadcrumb */}
          <Badge
            variant="outline"
            className="border-warning/30 bg-warning/10 text-warning shrink-0"
            data-testid="qa-kind-badge"
          >
            {t("qa", "badge")}
          </Badge>
          {/* Version */}
          {versionLabel ? (
            <span
              className="text-xs text-muted-foreground shrink-0"
              data-testid="qa-template-name"
            >
              {versionLabel}
            </span>
          ) : null}
          {runStage != null && <RunHeader.StageRail />}
          <RunHeader.Save
            state={saveState ?? "idle"}
            lastSavedAt={lastSavedAt ?? null}
            hidden={!session || finalized}
          />
        </RunHeader.Left>

        <RunHeader.Center>
          <RunHeader.Reviewers />
          <RunHeader.RoleChip />
        </RunHeader.Center>

        <RunHeader.Right>
          <RunHeader.AIActions
            pendingCount={Object.keys(aiSuggestions).length}
            canExtract={!!(session && !finalized)}
            extracting={extractingAI}
            onExtract={onExtractWithAI}
          />
          <RunHeader.PrimaryAction />
          <span className="mx-1 hidden h-5 w-px bg-border/60 @[40rem]/headerbar:block" aria-hidden="true" />
          <span className="hidden @[40rem]/headerbar:inline-flex">
            <RunHeader.Help />
          </span>
          <RunHeader.Menu>
            {canCompare && (
              <RunHeader.MenuItem
                onSelect={() =>
                  setViewMode((m) => (m === "assess" ? "compare" : "assess"))
                }
              >
                {effectiveViewMode === "assess"
                  ? t("qa", "compareToggle")
                  : t("qa", "assessToggle")}
              </RunHeader.MenuItem>
            )}
            {finalized && (
              <RunHeader.MenuItem
                onSelect={() => void handleReopen()}
              >
                {reopening
                  ? t("qa", "reopenProgress")
                  : t("qa", "reopenButton")}
              </RunHeader.MenuItem>
            )}
          </RunHeader.Menu>
          <RunHeader.PanelToggle
            pressed={pdfPanelState.isOpen}
            onToggle={pdfPanelState.toggle}
          />
        </RunHeader.Right>
      </RunHeader>
  );

  const pdfPanel = (
    <RunPdfContent articleId={articleId} projectId={projectId} store={viewerStore} />
  );

  // Single source for the form-panel stage gates (avoids repeating the same
  // 5-term chain across the consensus / compare / assess branches).
  const ready = !loading && !error && !!template && !!session;
  const showConsensusPanel = ready && inConsensusStage && !!runDetail;
  const showFormStage = ready && !inConsensusStage;

  // Completeness signal for ConsensusPanel's no-divergence finalize fast-path.
  // QA has no required-field gate (its publish preflight only requires at
  // least one filled value — see handlePublish), so mirror that here: without
  // this the panel never receives isComplete, canFinalize stays false, and a
  // no-divergence QA run shows a wrong "incomplete" message with finalize
  // disabled.
  const qaIsComplete = Object.values(values).some(
    (v) => v !== undefined && v !== null && v !== "",
  );

  const formPanel = (
    <div className="space-y-3 p-4" data-testid="qa-form-panel">
      {error ? (
        <div
          className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          data-testid="qa-error"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("qa", "loadingTemplate")}
        </div>
      ) : null}

      {showConsensusPanel && runDetail ? (
        <ConsensusPanel
          runDetail={runDetail}
          summary={reviewerSummary}
          fieldLabelByCoord={fieldLabelByCoord}
          reviewerLabelById={reviewerProfiles.labelById}
          avatarById={reviewerProfiles.avatarById}
          onSelectExisting={handleSelectExisting}
          onManualOverride={handleManualOverride}
          onFinalize={handleFinalizeFromConsensus}
          isResolving={consensusMutation.isPending}
          isFinalizing={advanceMutation.isPending}
          isComplete={qaIsComplete}
          requiredCoords={[]}
          peersRevealed={!!runDetail.peers_revealed}
        />
      ) : null}

      {showFormStage && effectiveViewMode === "compare" ? (
        <div data-testid="qa-compare-view">
          <RunReviewerComparison
            decisionsByCoord={reviewerSummary.decisionsByCoord}
            entityTypes={compareEntityTypes}
            instances={compareInstances}
            ownValues={values}
            reviewerLabelById={reviewerProfiles.labelById}
            reviewerAvatarById={reviewerProfiles.avatarById}
          />
        </div>
      ) : null}

      {showFormStage && template && session && effectiveViewMode === "assess" ? (
        <>
          {template.description ? (
            <p className="text-sm text-muted-foreground">
              {template.description}
            </p>
          ) : null}

          {sortedDomains.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This template has no domains defined.
            </p>
          ) : (
            <div data-testid="qa-domains">
              {sortedDomains.map((domain, idx) => {
                const instanceId =
                  session.instancesByEntityType[domain.entityType.id];
                if (!instanceId) return null;
                const valuesForDomain: Record<string, unknown> = {};
                for (const f of domain.fields) {
                  const k = keyOf({ instanceId, fieldId: f.id });
                  if (k in values) valuesForDomain[f.id] = values[k];
                }
                return (
                  <QASectionAccordion
                    key={domain.entityType.id}
                    domain={domain}
                    values={valuesForDomain}
                    onValueChange={(fieldId, value) =>
                      handleValueChange(instanceId, fieldId, value)
                    }
                    projectId={projectId}
                    articleId={articleId}
                    templateId={session.projectTemplateId}
                    runId={session.runId}
                    onExtractionComplete={handleSectionExtractionComplete}
                    defaultOpen={idx === 0}
                    reviewerActivity={{
                      decisionsByCoord: reviewerSummary.decisionsByCoord,
                      labelById: reviewerProfiles.labelById,
                      avatarById: reviewerProfiles.avatarById,
                      instanceId,
                    }}
                    instanceId={instanceId}
                    aiSuggestions={aiSuggestions}
                    onAcceptAI={acceptAISuggestion}
                    onRejectAI={rejectAISuggestion}
                    getSuggestionsHistory={getAISuggestionsHistory}
                    isAIActionLoading={isAIActionLoading}
                  />
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </div>
  );

  return (
    <RunSplitShell
      pdfPanel={pdfPanel}
      formPanel={formPanel}
      header={header}
      pdfState={pdfPanelState}
      viewerStore={viewerStore}
    />
  );
}
