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
 * Stage flow mirrors extraction (staged, never one-shot): reviewers flag
 * "Finish assessment" (advisory mark-ready), an arbitrator opens consensus
 * (extract → consensus; the backend materializes reviewer decisions, D8-c),
 * divergences are resolved in the ConsensusResolutionPanel, and
 * "Approve & finalize" publishes every agreed value then finalizes —
 * consensus is a real, visitable stage, never skipped.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { nextArticleTarget } from "@/lib/extraction/worklistNav";
import { toast } from "sonner";

import { Loader2 } from "lucide-react";

import { RunSplitShell } from "@/components/runs/RunSplitShell";
import { RunEditabilityProvider } from "@/components/runs/RunEditabilityContext";
import { HITLPublishedBanner } from "@/components/runs/HITLStatusBadges";
import { OverallJudgmentBanner } from "@/components/assessment/OverallJudgmentBanner";
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
import { useQAWorklist } from "@/hooks/qa/useQAWorklist";
import { useAISuggestions } from "@/hooks/extraction/ai/useAISuggestions";
import { useRunAIExtraction } from "@/hooks/extraction/ai/useRunAIExtraction";
import { countActionableSuggestions } from "@/lib/ai-extraction/suggestionUtils";
import {
  useAdvanceRun,
  useApproveFinalize,
  useAutoSaveProposals,
  useCreateConsensus,
  useMarkReady,
  useRefetchOnSave,
  useReopenRun,
  useReviewerSummary,
  useRun,
  useRunReviewers,
} from "@/hooks/runs";
// Direct import (not via the barrel): reaches the supabase client through
// useProjectMembers, which the barrel deliberately keeps out.
import { useExpectedReviewerCount } from "@/hooks/runs/useExpectedReviewerCount";
import { ConsensusResolutionPanel } from "@/components/runs/ConsensusResolutionPanel";
import { toConsensusValueEnvelope } from "@/lib/extraction/valueSemantics";
import { RunHeader } from "@/components/runs/header";
// Imported directly (not via the RunHeader compound) so the shared compound
// stays free of the supabase-reaching NotificationCenter/feedback deps.
import { Utility } from "@/components/runs/header/Utility";
import { buildQaTransition } from "@/lib/qa/qaTransition";
import { usePdfPanel } from "@/hooks/usePdfPanel";
import { setManagerReviewVisibility } from "@/services/hitlConfigService";
import type { ExtractionRunStage } from "@/types/ai-extraction";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { useSidebar } from "@/contexts/SidebarContext";
import { t } from "@/lib/copy";
import { isRunEditable } from "@/lib/runs/editability";
import { useAiLinkMaps } from "@/hooks/runs/useAiLinkMaps";
import { useRunShortcuts } from "@/hooks/runs/useRunShortcuts";
import { firstPendingInstanceId, scrollToSectionById } from "@/lib/runs/suggestionLocate";
import {
  currentValuesToValuesMap,
  publishedStatesToValuesMap,
} from "@/lib/extraction/publishedValues";

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

  // The project's article list, so finishing a form can open the next one.
  const worklist = useQAWorklist(projectId);

  const advanceMutation = useAdvanceRun(session?.runId ?? "");
  const consensusMutation = useCreateConsensus(session?.runId ?? "");
  const markReady = useMarkReady(session?.runId ?? "");
  const approveFinalize = useApproveFinalize(session?.runId ?? "");
  const reopenMutation = useReopenRun();
  const reviewerSummary = useReviewerSummary(runDetail);
  // Role-derived "N of M reviewers" denominator — same source as the
  // extraction header (never the run's inert hitl_config_snapshot).
  const expectedReviewerCount = useExpectedReviewerCount(
    projectId,
    reviewerSummary.reviewers.length,
  );
  const reviewerProfiles = useRunReviewers(session?.runId ?? null, {
    enabled: !!session?.runId,
  });

  // Assess vs. compare view. Compare renders the shared, server-blinded
  // RunReviewerComparison (same component the extraction screen uses).
  const [viewMode, setViewMode] = useState<"assess" | "compare">("assess");
  // ⌘K palette + the status popover it can open (the palette's "View run
  // status" action drives the controlled RunStatus).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
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

  // Local input state for the form. Hydrated from the caller-scoped
  // ``current_values`` per (instance, field) once the Run detail loads.
  const [values, setValues] = useState<Record<string, unknown>>({});

  // The ONE ``current_values`` map (D8): hydration merges from it below and
  // autosave receives the same object as ``baselineValues``, so a hydrated
  // coord is never re-POSTed as a fresh decision on mount — sameness by
  // construction, not by parallel derivation.
  const loadedValues = useMemo(
    () => currentValuesToValuesMap(runDetail?.current_values),
    [runDetail?.current_values],
  );

  // Hydrate during render when a new Run detail lands (instead of a
  // synchronous setState in an effect).
  const [prevRunDetail, setPrevRunDetail] = useState(runDetail);
  if (runDetail !== prevRunDetail) {
    setPrevRunDetail(runDetail);
    if (runDetail) {
      if (runDetail.run.stage === "finalized") {
        // Published truth replaces any local/proposal state (spec
        // 2026-07-02 D3): the read-only form shows what was published,
        // never the latest decision stream.
        setValues(publishedStatesToValuesMap(runDetail.published_states));
      } else {
        // D8: hydrate from the caller-scoped ``current_values`` resolution
        // (own decisions over own human proposals over system seeds) — the
        // backend's Layer-1 keeps old proposals-only runs hydrating, so no
        // frontend fallback branch on raw proposals exists.
        setValues((prev) => {
          const next: Record<string, unknown> = { ...prev };
          for (const [k, v] of Object.entries(loadedValues)) {
            if (!(k in next)) next[k] = v;
          }
          return next;
        });
      }
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

  // AI suggestions wiring — kind-agnostic hooks reused from Data
  // Extraction. ``runId`` scopes the suggestion query so a parallel
  // extraction run on the same article doesn't leak in. Accept/reject
  // never write from the hook: the value bubbles to ``handleValueChange``,
  // and autosave persists it as a per-reviewer ``edit`` decision (D8) —
  // linked to its AI basis via ``linkByKey`` below. Declared BEFORE
  // useAutoSaveProposals: autosave consumes the sessionAdoption-derived
  // link maps.
  const sessionInstanceIds = Object.values(session?.instancesByEntityType ?? {});

  const {
    suggestions: aiSuggestions,
    suggestionsReady: aiSuggestionsReady,
    sessionAdoption,
    acceptSuggestion: acceptAISuggestion,
    selectSuggestion: selectAISuggestion,
    rejectSuggestion: rejectAISuggestion,
    getSuggestionsHistory: getAISuggestionsHistory,
    refresh: refreshAISuggestions,
  } = useAISuggestions({
    articleId: articleId ?? "",
    runId: session?.runId,
    instanceIds: sessionInstanceIds,
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

  // D0 on QA (D8 parity): coords whose value has a traceable AI basis — see
  // useAiLinkMaps for the layer semantics and the never-from-status invariant.
  const { aiLinkByKey, persistedAiLinkByKey } = useAiLinkMaps({
    decisions: runDetail?.decisions,
    currentUserId: userId,
    sessionAdoption,
  });

  const { saveState, lastSavedAt, saveNow } =
    useAutoSaveProposals({
      runId: session?.runId ?? null,
      stage: runDetail?.run.stage ?? null,
      values,
      baselineValues: loadedValues,
      linkByKey: aiLinkByKey,
      baselineLinkByKey: persistedAiLinkByKey,
      enabled:
        !!session &&
        !!runDetail &&
        isRunEditable(runDetail.run.stage) &&
        // Viewer writes 403 server-side; never fire them (forms render
        // read-only via forceReadOnly, this is the flush-path belt).
        permissions.userRole !== "viewer",
    });

  // The overall-judgment banner is computed SERVER-side from the persisted
  // domain judgments, and autosave deliberately never invalidates
  // `runs.detail` (that would cost a run-view GET per debounce tick on every
  // screen). Without this sync the banner keeps its page-load value while the
  // reviewer edits, contradicting the domain judgments rendered right below
  // it. Scoped to the QA page, and gated on the template actually declaring
  // computed overalls so PROBAST / QUADAS-2 pay nothing.
  useRefetchOnSave({
    enabled: (runDetail?.derived_judgments?.length ?? 0) > 0,
    lastSavedAt,
    refetch: refetchRun,
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

  // ONE place that knows the QA route shape. The :templateId segment is
  // carried through verbatim — it may name either a project or a global
  // template (see resolveQATemplateKind above), so reconstructing it from the
  // resolved template would silently rewrite the URL the user arrived on.
  const qaArticleRoute = (targetArticleId: string) =>
    `/projects/${projectId}/articles/${targetArticleId}/quality-assessment/${templateId}`;

  const goToArticle = (targetArticleId: string) =>
    navigate(qaArticleRoute(targetArticleId));

  // Every run-screen keyboard binding (J/K, "\", ⌘K, Escape) lives in the one
  // shared hook, which owns the not-while-typing / no-modifier / end-of-list
  // guards — never re-stated here. Declared after goToArticle: the handler
  // object is built during render, so a call above it would hit the TDZ.
  useRunShortcuts({
    articles: worklist,
    currentArticleId: articleId ?? "",
    onNavigateToArticle: goToArticle,
    onTogglePanel: pdfPanelState.toggle,
    onTogglePalette: () => setPaletteOpen((prev) => !prev),
    onClosePalette: () => setPaletteOpen(false),
  });

  // Reveal (the persistent project-toggle): offered only to a blind manager
  // DURING extract, mirroring the extraction screen. Once the run reaches
  // consensus the run-scoped auto-reveal covers it (ADR-0015), so the
  // persistent toggle is no longer surfaced.
  const canReveal =
    permissions.userRole === "manager" &&
    permissions.isBlindMode &&
    runDetail?.run.stage === "extract" &&
    !runDetail.peers_revealed;
  const onReveal = () => {
    void setManagerReviewVisibility(projectId ?? "", "quality_assessment", true)
      .then(() => permissions.refresh())
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : String(e)),
      );
  };

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
      value: toConsensusValueEnvelope(params.value),
      rationale: params.rationale,
    });
    await refetchRun();
  };

  // Plain-identifier dep so the compiler can track this dep without
  // optional-chaining (optional-chained deps like `session?.runId` defeat it).
  const sessionRunId = session?.runId;

  // Where a finished form lands: the next article in the worklist, or the
  // project's quality tab at end-of-queue. Shared by the reviewer's mark-ready
  // and the arbitrator's terminal approve-finalize — both mean "done with this
  // article". Routes through the same qaArticleRoute the header pager uses.
  const goToNextArticle = () => {
    const nextId = nextArticleTarget(worklist, articleId ?? "");
    navigate(
      nextId ? qaArticleRoute(nextId) : `/projects/${projectId}?tab=quality`,
    );
  };

  // "Finish assessment" (reviewer) — flush pending autosave, then set the
  // advisory per-reviewer ready flag. The run stays in EXTRACT; the manager
  // opens consensus separately (extraction-HITL parity). Promise-chain
  // guards (no try/finally) keep the React Compiler happy; the mutation
  // hooks toast their own errors.
  const onMarkReady = async () => {
    if (!sessionRunId) return;
    const saved = await saveNow().then(() => true).catch(() => false);
    if (!saved) return;
    const ok = await markReady
      .mutateAsync({ ready: true })
      .then(() => true)
      .catch(() => false);
    if (!ok) return;
    await refetchRun();
    toast.success(t("qa", "markReadySuccess"));
    goToNextArticle();
  };

  // "Start consensus" (manager/consensus) — flush autosave, then advance
  // EXTRACT → CONSENSUS so the resolve surface becomes reachable. The
  // backend materializes each reviewer's proposals as decisions on this
  // transition (D8-c) and auto-reveals a blind manager (run-scoped).
  const onOpenConsensus = async () => {
    if (!sessionRunId) return;
    const saved = await saveNow().then(() => true).catch(() => false);
    if (!saved) return;
    const ok = await advanceMutation
      .mutateAsync({ target_stage: "consensus" })
      .then(() => true)
      .catch(() => false);
    if (!ok) return;
    await refetchRun().catch(() => undefined);
  };

  // "Approve & finalize" — one backend-atomic action: publish every agreed
  // value, then advance consensus → finalized. Gate rejections (unresolved
  // divergence / zero decisions) surface via useApproveFinalize's toast.
  const handleApproveFinalize = async () => {
    if (!sessionRunId) return;
    const ok = await approveFinalize
      .mutateAsync()
      .then(() => true)
      .catch(() => false);
    if (!ok) return;
    await refetchRun();
    toast.success(t("qa", "finalizationSuccess"));
    goToNextArticle();
  };

  // Blocked-click affordance for the gated Approve & finalize button.
  const onGuide = (message?: string) => {
    toast.error(message ?? t("qa", "runHeaderApproveBlocked"));
  };

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
  const sortedDomains = domains;

  // Compare-view inputs derived from the QA template tree: one instance per
  // domain (session.instancesByEntityType), shaped for the shared
  // RunReviewerComparison. ownValues is the form's `_`-keyed map; decisions
  // come in `::`-keyed via reviewerSummary — the component bridges the two.
  const compareEntityTypes: ComparisonEntityType[] = sortedDomains.map(
    (domain) => ({
      id: domain.entityType.id,
      label: domain.entityType.label,
      // Editor-relevant attributes so the resolve-mode override renders the
      // right typed input per field (not a bare text box).
      fields: domain.fields.map((f) => ({
        id: f.id, label: f.label, field_type: f.field_type,
        allowed_values: f.allowed_values, unit: f.unit, allowed_units: f.allowed_units,
        allow_other: f.allow_other, other_label: f.other_label, other_placeholder: f.other_placeholder,
      })),
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

  // Stage-driven transition for RunHeader.PrimaryAction (extraction parity:
  // Finish assessment / Start consensus / Approve & finalize).
  //
  // divergencesResolved: every diverging coord carries a consensus decision
  // (a no-divergence run is trivially resolved). isReady: the caller already
  // flagged themselves ready.
  const resolvedCoordKeys = new Set(
    (runDetail?.consensus_decisions ?? []).map(
      (c) => `${c.instance_id}::${c.field_id}`,
    ),
  );
  const divergencesResolved = [...reviewerSummary.divergentCoords].every((c) =>
    resolvedCoordKeys.has(c),
  );
  const isReady = (runDetail?.reviewers_ready ?? []).includes(userId ?? "");
  const qaTransition = buildQaTransition({
    stage: runStage,
    canResolveConflicts: permissions.canResolveConflicts,
    isReady,
    divergencesResolved,
    onMarkReady,
    onOpenConsensus,
    onApproveFinalize: handleApproveFinalize,
    onGuide,
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

  // ⌘K palette actions — the same vocabulary the extraction palette offers, so
  // one muscle memory covers both run screens. Each entry mirrors a control
  // that is actually reachable in the current stage/role, never a dead one.
  const paletteActions: { id: string; label: string; run: () => void }[] = [];
  if (canCompare && !inConsensusStage) {
    paletteActions.push({
      id: "compare",
      label: t("runs", "compareToggleLabel"),
      run: () => setViewMode((m) => (m === "assess" ? "compare" : "assess")),
    });
  }
  paletteActions.push({
    id: "panel",
    label: t("runs", "togglePanel"),
    run: () => pdfPanelState.toggle(),
  });
  if (canReveal) {
    paletteActions.push({
      id: "reveal",
      label: t("runs", "reveal"),
      run: () => onReveal(),
    });
  }
  if (runStage != null) {
    paletteActions.push({
      id: "status",
      label: t("runs", "viewRunStatus"),
      run: () => setStatusOpen(true),
    });
  }

  // HeaderShell (inside RunHeader) owns the @container/headerbar — no consumer
  // wrapper. The palette is a SIBLING of the header, not a child: it must
  // render above it.
  const header = (
    <>
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
            required: expectedReviewerCount,
            divergent: reviewerSummary.divergentCoords.size,
          },
          transition: qaTransition,
          submitting:
            markReady.isPending ||
            advanceMutation.isPending ||
            approveFinalize.isPending,
          // D6: the consensus branch ignores viewMode, so the jump would be
          // inert there — offer it only while the compare view is reachable.
          onJumpToDivergence: canCompare && !inConsensusStage
            ? () => setViewMode("compare")
            : undefined,
        }}
      >
        <RunHeader.Left>
          <RunHeader.MobileNav onOpen={toggleMobile} />
          <RunHeader.SidebarToggle pressed={!sidebarCollapsed} onToggle={toggleSidebar} />
          <RunHeader.Breadcrumb
            onBack={() => navigate(`/projects/${projectId}?tab=quality`)}
            title={template?.name ?? ""}
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
          <RunHeader.Save
            state={saveState ?? "idle"}
            lastSavedAt={lastSavedAt ?? null}
            hidden={!session || finalized}
          />
        </RunHeader.Left>

        <RunHeader.Center>
          {/* Worklist self-guards: it renders null below two articles or on an
              unknown current id, so no length check belongs here. */}
          <RunHeader.Worklist
            articles={worklist}
            currentId={articleId ?? ""}
            onNavigate={goToArticle}
          />
        </RunHeader.Center>

        <RunHeader.Right>
          {runStage != null && (
            <RunHeader.RunStatus open={statusOpen} onOpenChange={setStatusOpen} />
          )}
          {/* D6: no dead toggle during consensus (the resolve table always renders there). */}
          {canCompare && !inConsensusStage && (
            <RunHeader.CompareToggle
              active={effectiveViewMode === "compare"}
              onToggle={() => setViewMode((m) => (m === "assess" ? "compare" : "assess"))}
              label={t("runs", "compareToggleLabel")}
            />
          )}
          <RunHeader.AIActions
            pendingCount={finalized ? 0 : countActionableSuggestions(aiSuggestions)}
            canExtract={!!(session && runDetail && isRunEditable(runDetail.run.stage))}
            extracting={extractingAI}
            onExtract={onExtractWithAI}
            onOpenSuggestions={() => {
              // Header "Review N pending suggestions": scroll to the domain
              // holding the first pending suggestion.
              const instanceId = firstPendingInstanceId(aiSuggestions);
              const domain = instanceId
                ? sortedDomains.find(
                    (d) => session?.instancesByEntityType[d.entityType.id] === instanceId,
                  )
                : undefined;
              if (domain) scrollToSectionById(domain.entityType.id);
            }}
          />
          <RunHeader.PrimaryAction />
          <Utility>
            {finalized && (
              <RunHeader.MenuItem
                onSelect={() => void handleReopen()}
              >
                {reopening
                  ? t("qa", "reopenProgress")
                  : t("qa", "reopenButton")}
              </RunHeader.MenuItem>
            )}
          </Utility>
          <RunHeader.PanelToggle
            pressed={pdfPanelState.isOpen}
            onToggle={pdfPanelState.toggle}
          />
        </RunHeader.Right>
      </RunHeader>

      <RunHeader.CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        actions={paletteActions}
        articles={worklist.length > 1 ? worklist : undefined}
        onNavigate={worklist.length > 1 ? goToArticle : undefined}
      />
    </>
  );

  const pdfPanel = (
    <RunPdfContent articleId={articleId} projectId={projectId} store={viewerStore} />
  );

  // Single source for the form-panel stage gates (avoids repeating the same
  // 5-term chain across the consensus / compare / assess branches).
  const ready = !loading && !error && !!template && !!session;
  const showConsensusPanel = ready && inConsensusStage && !!runDetail;
  const showFormStage = ready && !inConsensusStage;

  const formPanel = (
    // showPeerIdentity (D3): mirrors the extraction screen — identity-visible
    // callers get "Run by {name}" popover headers; blind reviewers stay
    // timestamp-only.
    <RunEditabilityProvider
      stage={runDetail?.run.stage ?? null}
      showPeerIdentity={!!runDetail?.peers_revealed || permissions.canSeeOthers}
      forceReadOnly={permissions.userRole === "viewer"}
    >
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
        <ConsensusResolutionPanel
          runDetail={runDetail}
          summary={reviewerSummary}
          entityTypes={compareEntityTypes}
          instances={compareInstances}
          ownValues={values}
          reviewerLabelById={reviewerProfiles.labelById}
          reviewerAvatarById={reviewerProfiles.avatarById}
          // Resolving/publishing consensus is an arbitrator action (QA mirrors
          // extraction as of 2026-07-09; the backend 403s non-arbitrators on
          // /consensus). Gate the chrome on canResolveConflicts so a plain
          // reviewer/viewer never gets buttons whose every click would fail.
          canResolve={permissions.canResolveConflicts}
          // Consensus AI trace (D2): a single top-level channel. showPeerIdentity
          // + currentUserId gate field-level peer cross-marks to self in blind
          // review (server already strips peer rows — this is the second layer).
          aiTrace={{
            articleId: articleId ?? "",
            getHistory: (i, f) => getAISuggestionsHistory(i, f, 50),
            aiSuggestions: aiSuggestionsReady ? aiSuggestions : null,
            showPeerIdentity: !!runDetail.peers_revealed || permissions.canSeeOthers,
            currentUserId: userId ?? null,
          }}
          onSelectExisting={handleSelectExisting}
          onManualOverride={handleManualOverride}
          onFinalize={handleApproveFinalize}
          isResolving={consensusMutation.isPending}
          isFinalizing={approveFinalize.isPending}
          requiredCoords={[]}
          peersRevealed={!!runDetail.peers_revealed}
          showFinalize={false}
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

          <OverallJudgmentBanner
            judgments={runDetail?.derived_judgments ?? []}
          />

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
                    selectSuggestion={selectAISuggestion}
                    getSuggestionsHistory={getAISuggestionsHistory}
                  />
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </div>
    </RunEditabilityProvider>
  );

  // Published/revision banner between header and panels (shared component,
  // spec 2026-07-02 D4).
  const qaSubHeader = (
    <HITLPublishedBanner
      kind="qa"
      finalized={finalized}
      parentRunId={parentRunId}
      onReopen={() => void handleReopen()}
      reopening={reopening}
    />
  );

  return (
    <RunSplitShell
      pdfPanel={pdfPanel}
      formPanel={formPanel}
      header={header}
      subHeader={qaSubHeader}
      pdfState={pdfPanelState}
      viewerStore={viewerStore}
    />
  );
}
