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

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { ArrowLeft, Loader2, Sparkles } from "lucide-react";

import { AssessmentShell } from "@/components/assessment/AssessmentShell";
import { QASectionAccordion } from "@/components/assessment/QASectionAccordion";
import { PrumoPdfViewer, articleFileSource } from "@prumo/pdf-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useProjectQATemplate } from "@/hooks/qa/useProjectQATemplate";
import { useQAAssessmentSession } from "@/hooks/qa/useQAAssessmentSession";
import { useAISuggestions } from "@/hooks/extraction/ai/useAISuggestions";
import { useRunAIExtraction } from "@/hooks/extraction/ai/useRunAIExtraction";
import {
  useAdvanceRun,
  useCreateConsensus,
  useCreateProposal,
  useReopenRun,
  useReviewerSummary,
  useRun,
  useRunReviewers,
} from "@/hooks/runs";
import { ReviewerProgressBadge } from "@/components/runs/ReviewerProgressBadge";
import {
  HITLReopenButton,
  HITLStatusBadges,
} from "@/components/runs/HITLStatusBadges";
import { ConsensusPanel } from "@/components/runs/ConsensusPanel";
import { HeaderAIActions } from "@/components/hitl/HeaderAIActions";

interface FieldKey {
  instanceId: string;
  fieldId: string;
}

function keyOf(k: FieldKey): string {
  return `${k.instanceId}::${k.fieldId}`;
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

  useEffect(() => {
    let cancelled = false;
    if (!templateId) {
      setResolvedTemplate(null);
      return;
    }
    setResolvedTemplate(null);
    void (async () => {
      const [projectRes, globalRes] = await Promise.all([
        supabase
          .from("project_extraction_templates")
          .select("id")
          .eq("id", templateId)
          .eq("kind", "quality_assessment")
          .maybeSingle(),
        supabase
          .from("extraction_templates_global")
          .select("id")
          .eq("id", templateId)
          .eq("kind", "quality_assessment")
          .maybeSingle(),
      ]);
      if (cancelled) return;
      if (projectRes.error && globalRes.error) {
        setResolvedTemplate({ kind: "missing" });
        return;
      }
      if (projectRes.data?.id) {
        setResolvedTemplate({ kind: "project", id: projectRes.data.id });
        return;
      }
      if (globalRes.data?.id) {
        setResolvedTemplate({ kind: "global", id: globalRes.data.id });
      } else {
        setResolvedTemplate({ kind: "missing" });
      }
    })();
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

  const proposalMutation = useCreateProposal(session?.runId ?? "");
  const advanceMutation = useAdvanceRun(session?.runId ?? "");
  const consensusMutation = useCreateConsensus(session?.runId ?? "");
  const reopenMutation = useReopenRun();
  const reviewerSummary = useReviewerSummary(runDetail);
  const reviewerProfiles = useRunReviewers(session?.runId ?? null, {
    enabled: !!session?.runId,
  });

  // Local input state for the form. Hydrated from the latest proposal per
  // (instance, field) once the Run detail loads.
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!runDetail) return;
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
  }, [runDetail]);

  const handleValueChange = useCallback(
    (instanceId: string, fieldId: string, value: unknown) => {
      const k = keyOf({ instanceId, fieldId });
      setValues((prev) => ({ ...prev, [k]: value }));
      if (!session) return;
      proposalMutation.mutate(
        {
          instance_id: instanceId,
          field_id: fieldId,
          source: "human",
          source_user_id: undefined,
          proposed_value: { value: value ?? null },
        },
        {
          onError: (err) => {
            toast.error(`Failed to record proposal: ${err.message}`);
          },
        },
      );
    },
    [session, proposalMutation],
  );

  // AI suggestions wiring — kind-agnostic hooks reused from Data
  // Extraction. Two key adaptations for QA:
  //  - ``runId`` scopes the suggestion query so a parallel extraction
  //    run on the same article doesn't leak in.
  //  - ``acceptStrategy: 'human-proposal'`` keeps the run in PROPOSAL
  //    (no ReviewerDecision write). Accept just bubbles the value to
  //    ``handleValueChange``, which records a fresh ``human`` proposal
  //    via the existing form pipeline.
  const sessionInstanceIds = useMemo(
    () => Object.values(session?.instancesByEntityType ?? {}),
    [session],
  );

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

  const fieldLabelByCoord = useMemo(() => {
    const map: Record<string, string> = {};
    if (!session) return map;
    for (const domain of domains) {
      const instanceId = session.instancesByEntityType[domain.entityType.id];
      if (!instanceId) continue;
      for (const f of domain.fields) {
        map[`${instanceId}::${f.id}`] = `${domain.entityType.label} · ${f.label}`;
      }
    }
    return map;
  }, [session, domains]);

  const inConsensusStage = runDetail?.run.stage === "consensus";

  const handleSelectExisting = useCallback(
    async (params: {
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
    },
    [consensusMutation, refetchRun],
  );

  const handleManualOverride = useCallback(
    async (params: {
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
    },
    [consensusMutation, refetchRun],
  );

  const handleFinalizeFromConsensus = useCallback(async () => {
    if (!session) return;
    await advanceMutation.mutateAsync({ target_stage: "finalized" });
    await refetchRun();
    toast.success("Run finalized.");
  }, [session, advanceMutation, refetchRun]);

  const handleReopen = useCallback(async () => {
    if (!session?.runId) return;
    setReopening(true);
    try {
      await reopenMutation.mutateAsync(session.runId);
      // The new run is now the latest non-terminal one for this triple,
      // so refetching the session picks it up. Local form state is reset
      // since the new run carries its own seeded proposals.
      setValues({});
      await refetchSession();
      toast.success("Assessment reopened for revision.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to reopen assessment",
      );
    } finally {
      setReopening(false);
    }
  }, [session?.runId, reopenMutation, refetchSession]);
  const handlePublish = useCallback(async () => {
    if (!session || !runDetail) return;
    setPublishing(true);
    try {
      const stage = runDetail.run.stage;
      if (stage === "proposal") {
        await advanceMutation.mutateAsync({ target_stage: "review" });
      }
      const stageAfterReview =
        stage === "proposal" || stage === "review" ? "review" : stage;
      if (stageAfterReview === "review") {
        await advanceMutation.mutateAsync({ target_stage: "consensus" });
      }

      // Manual-override consensus per filled (instance, field) — writes the
      // value directly to PublishedState without requiring a per-field
      // ReviewerDecision row.
      const filled = Object.entries(values).filter(
        ([, v]) => v !== undefined && v !== null && v !== "",
      );
      for (const [k, v] of filled) {
        const [instanceId, fieldId] = k.split("::");
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
      toast.success("Assessment published.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to publish assessment",
      );
    } finally {
      setPublishing(false);
    }
  }, [
    session,
    runDetail,
    advanceMutation,
    consensusMutation,
    values,
    refetchRun,
  ]);

  const sortedDomains = useMemo(() => domains, [domains]);

  if (!projectId || !articleId || !templateId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Missing route parameters.
      </div>
    );
  }

  const loading =
    resolvedTemplate === null || sessionLoading || templateLoading;
  const error =
    resolvedTemplate?.kind === "missing"
      ? `Quality-Assessment template ${templateId} not found. The link may be stale — pick a template from the list and try again.`
      : (sessionError ?? templateError);

  const header = (
    <div className="flex items-center justify-between border-b bg-background px-4 py-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/projects/${projectId}`)}
          aria-label="Back"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <Badge
          variant="outline"
          className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          data-testid="qa-kind-badge"
        >
          Quality Assessment
        </Badge>
        <h1
          className="truncate text-base font-medium"
          data-testid="qa-template-name"
        >
          {template?.name ?? (loading ? "Loading…" : "—")}
        </h1>
        {template ? (
          <span className="text-xs text-muted-foreground">v{template.version}</span>
        ) : null}
        <HITLStatusBadges
          kind="qa"
          finalized={finalized}
          parentRunId={parentRunId}
        />
        {runDetail ? (
          <ReviewerProgressBadge
            reviewerCount={reviewerSummary.reviewers.length}
            requiredReviewerCount={reviewerSummary.requiredReviewerCount}
            divergentCount={reviewerSummary.divergentCoords.size}
          />
        ) : null}
        <HeaderAIActions suggestions={aiSuggestions} compact />
      </div>
      <div className="flex items-center gap-2">
        <HITLReopenButton
          kind="qa"
          visible={finalized}
          onClick={() => void handleReopen()}
          disabled={!session}
          reopening={reopening}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (!session || !projectId || !articleId) return;
            void extractForRun({
              projectId,
              articleId,
              templateId: session.projectTemplateId,
              runId: session.runId,
              skipFieldsWithHumanProposals: true,
              autoAdvanceToReview: false,
            });
          }}
          disabled={!session || finalized || extractingAI}
          data-testid="qa-extract-ai-button"
        >
          <Sparkles className="mr-1 h-4 w-4" />
          {extractingAI ? "Extracting…" : "Extract with AI"}
        </Button>
        <Button
          size="sm"
          onClick={() => void handlePublish()}
          disabled={publishing || finalized || !session}
          data-testid="qa-publish-button"
        >
          {publishing ? "Publishing…" : finalized ? "Published" : "Publish assessment"}
        </Button>
      </div>
    </div>
  );

  const pdfPanel = (
    <PrumoPdfViewer
      source={articleId ? articleFileSource(articleId) : null}
      className="h-full"
    />
  );

  const formPanel = (
    <div className="space-y-3 p-4" data-testid="qa-form-panel">
      {error ? (
        <div
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          data-testid="qa-error"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading template…
        </div>
      ) : null}

      {!loading && !error && template && session && inConsensusStage && runDetail ? (
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
        />
      ) : null}

      {!loading && !error && template && session && !inConsensusStage ? (
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
    <AssessmentShell
      pdfPanel={pdfPanel}
      formPanel={formPanel}
      header={header}
      initialPdfOpen={false}
    />
  );
}
