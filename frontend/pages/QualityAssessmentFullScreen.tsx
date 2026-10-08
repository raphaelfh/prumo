/**
 * Quality Assessment full-screen page (PROBAST / QUADAS-2 / future tools):
 * the assessment residue of the shared run screen. The lifecycle (stage
 * commands, consensus, reveal, reopen, compare) is `useRunLifecycleScreen`
 * and the chrome is `RunScreenShell` — the same staged flow as extraction
 * (ADR-0018). This page owns what only QA has:
 *
 * 1. Open (or resume) a session via `POST /api/v1/hitl/sessions` with
 *    `kind=quality_assessment` — clones the global QA template into the
 *    project, ensures one instance per domain for the article, and parks a
 *    Run in `extract`.
 * 2. Render the cloned template tree as domain accordions (entity_types +
 *    fields use the cloned ids, so writes coordinate-cohere with the Run).
 * 3. Values — hydration by stage, autosave, the one accept path — are
 *    `useRunValues`, the same module extraction uses.
 */

import { useRef } from "react";
import { useParams } from "react-router";
import { Loader2 } from "lucide-react";

import { OverallJudgmentBanner } from "@/components/assessment/OverallJudgmentBanner";
import { QASectionAccordion } from "@/components/assessment/QASectionAccordion";
import { RunScreenShell } from "@/components/runs/RunScreenShell";
import { SectionNavLayout, type SectionNavHandle } from "@/components/runs/SectionNavLayout";
import {
  RunReviewerComparison,
  type ComparisonEntityType,
  type ComparisonInstance,
} from "@/components/runs/RunReviewerComparison";
import { Badge } from "@/components/ui/badge";
import { useQASectionNav } from "@/hooks/qa/useQASectionNav";
import { useProjectQATemplate } from "@/hooks/qa/useProjectQATemplate";
import { useQATemplateResolution } from "@/hooks/qa/useQATemplateResolution";
import { useQAAssessmentSession } from "@/hooks/qa/useQAAssessmentSession";
import { useAISuggestions } from "@/hooks/extraction/ai/useAISuggestions";
import { useRunAIExtraction } from "@/hooks/extraction/ai/useRunAIExtraction";
import { useRefetchOnSave } from "@/hooks/runs";
import { useRunReader } from "@/hooks/runs/useRunReader";
import {
  useRunLifecycleScreen,
  useRunView,
  useRunWorklist,
} from "@/hooks/runs/useRunLifecycleScreen";
import { useRunValues } from "@/hooks/runs/useRunValues";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { countActionableSuggestions } from "@/lib/ai-extraction/suggestionUtils";
import { t } from "@/lib/copy";
import { withReviewDecisionStatus } from "@/lib/extraction/proposalDecisionState";
import { rationaleGapCoords } from "@/lib/qa/rationaleGaps";
import { outOfScopeSectionsOnForm } from "@/lib/qa/studyTypeScope";
import { coordKey } from "@/lib/runs/coord";
import { isRunEditable } from "@/lib/runs/editability";
import { firstPendingInstanceId } from "@/lib/runs/suggestionLocate";

export default function QualityAssessmentFullScreen() {
  const { projectId, articleId, templateId } = useParams<{
    projectId: string;
    articleId: string;
    templateId: string;
  }>();

  // The ``:templateId`` segment names the project's QA template or a
  // catalogue one; the session-open request takes each in its own field.
  const { resolution: resolvedTemplate } = useQATemplateResolution(projectId, templateId);

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

  const { data: runDetail, refetch: refetchRun } = useRunView(session?.runId);

  // The :templateId segment is carried through verbatim — it may name either
  // a project or a global template, so reconstructing it from the resolved
  // template would silently rewrite the URL the user arrived on.
  const worklist = useRunWorklist({
    kind: "qa",
    projectId,
    articleId,
    articleRoute: (id) => `/projects/${projectId}/articles/${id}/quality-assessment/${templateId}`,
  });

  const { userId } = useCurrentUser();
  const permissions = useComparisonPermissions(
    projectId ?? "",
    userId ?? "",
    "quality_assessment",
  );

  // What the form shows and how it is written (hydrate by stage, autosave,
  // the one accept path) — the same module the extraction screen uses.
  // Viewer writes 403 server-side; the form renders read-only and this gate
  // keeps the flush paths from firing them.
  const runValues = useRunValues({
    runDetail,
    currentUserId: userId,
    enabled: permissions.userRole !== "viewer",
  });
  const { values, updateValue, saveState, lastSavedAt, saveNow } = runValues;

  // AI suggestions over the session's instances. ``runId`` scopes the
  // suggestion query so a parallel extraction run on the same article doesn't
  // leak in. A rejected suggestion clears the field; autosave writes the clear.
  const {
    suggestions: loadedSuggestions,
    suggestionsReady: aiSuggestionsReady,
    rejectSuggestion: rejectAISuggestion,
    getSuggestionsHistory: getAISuggestionsHistory,
    refresh: refreshAISuggestions,
  } = useAISuggestions({
    articleId: articleId ?? "",
    runId: session?.runId,
    instanceIds: Object.values(session?.instancesByEntityType ?? {}),
    enabled: !!session,
    onSuggestionRejected: runValues.rejectProposal,
  });
  // While the reviewer can write, their confirmed decisions own which
  // suggestion is accepted (the server's caller-scoped status cannot express
  // a reversal) — the same reading extraction's review table makes.
  const editable = !!runDetail && isRunEditable(runDetail.run.stage) && permissions.userRole !== "viewer";
  const aiSuggestions = editable
    ? withReviewDecisionStatus(loadedSuggestions, runValues.isAccepted)
    : loadedSuggestions;
  // Accepting a suggestion (latest, or a version picked in the review
  // popover) is the reviewer's decision, recorded at once.
  const selectAISuggestion = async (instanceId: string, fieldId: string, id: string, value: unknown) => {
    const field = domains.flatMap((domain) => domain.fields).find((item) => item.id === fieldId);
    await runValues.acceptProposal({
      instanceId,
      fieldId,
      id,
      value,
      allowsNoInformation: field?.allows_no_information !== false,
    });
  };
  const acceptAISuggestion = async (instanceId: string, fieldId: string) => {
    const proposal = aiSuggestions[coordKey(instanceId, fieldId)];
    if (proposal) await selectAISuggestion(instanceId, fieldId, proposal.id, proposal.value);
  };

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

  // The reader stays closed on entry.
  const reader = useRunReader(false);
  // The form's section layout: the header's suggestion locate opens a section through it.
  const sectionNavRef = useRef<SectionNavHandle>(null);

  const lifecycle = useRunLifecycleScreen({
    kind: "qa",
    projectId,
    runId: session?.runId ?? null,
    runDetail,
    permissions,
    currentUserId: userId ?? "",
    saveNow,
    goToNextArticle: worklist.goToNextArticle,
    // Owed override rationales, and what strands the run without them: see
    // lib/qa/rationaleGaps.
    requiredCoords: rationaleGapCoords(runDetail?.derived_judgments, session?.instancesByEntityType),
    refetchSession,
  });

  // Step-2 scope (PROBAST+AI v2): the template's own `scope_rules` name the
  // sections the classified study type takes out of play — the same declared
  // data the derivation reads, so screen and payload agree. It badges those
  // domains and takes them out of the rail's counts; it never gates input.
  const outOfScope = outOfScopeSectionsOnForm(
    template?.schema,
    domains,
    session?.instancesByEntityType,
    values,
  );

  // The rendered domains and the section rail over them, shared with extraction.
  const sectionNav = useQASectionNav(domains, session?.instancesByEntityType, values, outOfScope);

  // Compare/consensus inputs derived from the QA template tree: one instance
  // per domain (session.instancesByEntityType), shaped for the shared
  // comparison table.
  const compareEntityTypes: ComparisonEntityType[] = domains.map(
    (domain) => ({
      id: domain.entityType.id,
      label: domain.entityType.label,
      // `ExtractionField` already satisfies `ComparisonField` structurally, so
      // pass it whole — a hand-written projection silently drops any attribute
      // it forgets (every key but `id` is optional), which is how the ADR-0016
      // disposition flag went missing on this path.
      fields: domain.fields,
    }),
  );
  const compareInstances: ComparisonInstance[] = domains
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
    resolvedTemplate.kind === "pending" || sessionLoading || templateLoading;
  const error =
    resolvedTemplate.kind === "missing"
      ? t("qa", "templateNotFound").replace("{{templateId}}", templateId ?? "")
      : resolvedTemplate.kind === "error"
        ? t("qa", "templateLoadError")
        : (sessionError ?? templateError);

  const onExtractWithAI = () => {
    if (!session) return;
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
  const ready = !loading && !error && !!template && !!session;
  const showForm = ready && !lifecycle.inConsensusStage;

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

      {showForm && lifecycle.compare.active ? (
        <div data-testid="qa-compare-view">
          <RunReviewerComparison
            decisionsByCoord={lifecycle.reviewers.summary.decisionsByCoord}
            entityTypes={compareEntityTypes}
            instances={compareInstances}
            ownValues={values}
            reviewerLabelById={lifecycle.reviewers.profiles.labelById}
            reviewerAvatarById={lifecycle.reviewers.profiles.avatarById}
          />
        </div>
      ) : null}

      {showForm && template && session && !lifecycle.compare.active ? (
        <SectionNavLayout ref={sectionNavRef} items={sectionNav.items} activeId={sectionNav.activeId} onSelect={sectionNav.scrollToSection} onActivate={sectionNav.activateSection}>
          <div className="space-y-3">
            {template.description ? (
              <p className="text-sm text-muted-foreground">
                {template.description}
              </p>
            ) : null}

            <OverallJudgmentBanner
              judgments={runDetail?.derived_judgments ?? []}
            />

            {domains.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This template has no domains defined.
              </p>
            ) : (
              <div data-testid="qa-domains">
                {sectionNav.renderedDomains.map(({ domain, instanceId }, idx) => {
                  const valuesForDomain: Record<string, unknown> = {};
                  for (const f of domain.fields) {
                    const k = coordKey(instanceId, f.id);
                    if (k in values) valuesForDomain[f.id] = values[k];
                  }
                  return (
                    <div
                      key={domain.entityType.id}
                      ref={(el) => sectionNav.registerSection(domain.entityType.id, el)}
                      tabIndex={-1}
                      className="scroll-mt-4 outline-hidden"
                    >
                      <QASectionAccordion
                        domain={domain}
                        values={valuesForDomain}
                        onValueChange={(fieldId, value) =>
                          updateValue(instanceId, fieldId, value)
                        }
                        projectId={projectId}
                        articleId={articleId}
                        templateId={session.projectTemplateId}
                        runId={session.runId}
                        onExtractionComplete={handleSectionExtractionComplete}
                        defaultOpen={idx === 0}
                        reviewerActivity={{
                          decisionsByCoord: lifecycle.reviewers.summary.decisionsByCoord,
                          labelById: lifecycle.reviewers.profiles.labelById,
                          avatarById: lifecycle.reviewers.profiles.avatarById,
                        }}
                        instanceId={instanceId}
                        aiSuggestions={aiSuggestions}
                        onAcceptAI={acceptAISuggestion}
                        onRejectAI={rejectAISuggestion}
                        selectSuggestion={selectAISuggestion}
                        getSuggestionsHistory={getAISuggestionsHistory}
                        derivedJudgments={runDetail?.derived_judgments}
                        outOfScope={outOfScope.has(domain.entityType.name)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SectionNavLayout>
      ) : null}
    </div>
  );

  return (
    <RunScreenShell
      lifecycle={lifecycle}
      runDetail={runDetail}
      permissions={permissions}
      currentUserId={userId ?? ""}
      worklist={worklist}
      reader={reader}
      projectId={projectId}
      articleId={articleId}
      title={template?.name ?? ""}
      titleAdornment={
        <>
          {/* QA kind badge — compact identifier next to breadcrumb */}
          <Badge
            variant="outline"
            className="border-warning/30 bg-warning/10 text-warning shrink-0"
            data-testid="qa-kind-badge"
          >
            {t("qa", "badge")}
          </Badge>
          {versionLabel ? (
            <span
              className="text-xs text-muted-foreground shrink-0"
              data-testid="qa-template-name"
            >
              {versionLabel}
            </span>
          ) : null}
        </>
      }
      // Signaling questions are optional: no completeness metric.
      progress={{ completed: 0, total: 0, pct: 0 }}
      save={{ state: saveState, lastSavedAt }}
      ai={{
        pendingCount: lifecycle.finalized ? 0 : countActionableSuggestions(aiSuggestions),
        canExtract: !!(session && runDetail && isRunEditable(runDetail.run.stage)),
        extracting: extractingAI,
        onExtract: onExtractWithAI,
        onOpenSuggestions: () => {
          // "Review N pending suggestions": open the domain holding the first
          // pending suggestion and scroll to it.
          const instanceId = firstPendingInstanceId(aiSuggestions);
          const pending = sectionNav.renderedDomains.find((r) => r.instanceId === instanceId);
          if (pending) sectionNavRef.current?.revealSection(pending.domain.entityType.id);
        },
      }}
      formPanel={formPanel}
      consensus={
        ready
          ? {
              entityTypes: compareEntityTypes,
              instances: compareInstances,
              ownValues: values,
              aiTrace: {
                articleId,
                getHistory: (i, f) => getAISuggestionsHistory(i, f, 50),
                aiSuggestions: aiSuggestionsReady ? aiSuggestions : null,
              },
            }
          : null
      }
    />
  );
}
