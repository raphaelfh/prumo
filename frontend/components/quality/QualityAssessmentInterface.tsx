/**
 * Quality Assessment landing — per-project view inside ProjectView.
 *
 * Three tabs synced to ``?qaTab=``:
 *
 * 1. ``assessment``: ``HITLActiveTemplateBar`` (switch between PROBAST /
 *    QUADAS-2 / future tools enabled in Configuration) + ``HITLArticleTable``
 *    showing every article with progress and status against the active tool.
 * 2. ``dashboard``: project-level counters for the active tool.
 * 3. ``configuration``: ``QualityAssessmentConfiguration`` lets the user
 *    enable / disable each global QA template independently for the project.
 *
 * Each row's "Open" action navigates to
 * ``/projects/:projectId/articles/:articleId/quality-assessment/:templateId``
 * with the bar-selected template id, so the user lands on the right session.
 */

import { useState } from "react";
import { useSearchParams } from "react-router";
import { CheckCircle, FileText, FileUp, ShieldCheck } from "lucide-react";

import { ErrorState } from "@/components/patterns/ErrorState";
import { IconButton } from "@/components/patterns/IconButton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/copy";
import {
  HITLActiveTemplateBar,
  useActiveTemplateSelection,
} from "@/components/hitl/HITLActiveTemplateBar";
import { HITLArticleTable } from "@/components/hitl/HITLArticleTable";
import {EngineGear} from '@/components/extraction/EngineGear';
import { HITLExportDialog } from "@/components/hitl/HITLExportDialog";
import { QualityAssessmentConfiguration } from "@/components/quality/QualityAssessmentConfiguration";
import { useCallerArticleProgress } from "@/hooks/extraction/useCallerArticleProgress";
import { useProjectTemplates } from "@/hooks/hitl/useProjectTemplates";
import { useProjectMemberRole } from "@/hooks/useProjectMemberRole";
import { useQAWorklist } from "@/hooks/qa/useQAWorklist";
import { useProjectArticlesQuery } from "@/hooks/shared/useProjectArticlesQuery";

type QaTab = "assessment" | "dashboard" | "configuration";

interface Props {
  projectId: string;
}

export function QualityAssessmentInterface({ projectId }: Props) {
  const [searchParams] = useSearchParams();

  const tabFromUrl = searchParams.get("qaTab") as QaTab | null;
  const activeTab: QaTab =
    tabFromUrl && ["assessment", "dashboard", "configuration"].includes(tabFromUrl)
      ? tabFromUrl
      : "assessment";

  const {data, isLoading: templatesLoading} = useProjectTemplates({
    projectId,
    kind: "quality_assessment",
  });
  const templates = data ?? [];

  const { activeTemplate, selectTemplate } = useActiveTemplateSelection(templates);

  // Export needs the project's article ids and the caller's role. The worklist
  // hook is the QA screen's existing read of the same list the table shows
  // (``fetchProjectArticles``, created_at desc), so this adds no new fetcher.
  const worklist = useQAWorklist(projectId);
  const { isManager } = useProjectMemberRole(projectId);
  const [showExportDialog, setShowExportDialog] = useState(false);

  // Dashboard counters — same shape as extraction's stats card row. They derive
  // from the reads the worklist already shares instead of an ad-hoc fetch, and
  // a failed read renders an error state: zeros would read as "nothing started".
  // Both reads stay disabled off the dashboard tab.
  const onDashboard = activeTab === "dashboard";
  const dashboardArticles = useProjectArticlesQuery(projectId, { enabled: onDashboard });
  const dashboardTemplateId = onDashboard ? activeTemplate?.id : undefined;
  const progress = useCallerArticleProgress(
    projectId,
    dashboardTemplateId,
    "quality_assessment",
  );

  const totalArticles = dashboardArticles.data?.length ?? 0;
  // The map is keyed by every article with at least one instance of the tool.
  const assessmentsStarted = progress.valuesByArticle.size;
  const progressPercentage =
    totalArticles > 0 ? Math.round((assessmentsStarted / totalArticles) * 100) : 0;

  const retryDashboard = () => {
    void dashboardArticles.refetch();
    // refetch() ignores `enabled: false`: a disabled progress read (no user or
    // no active template) must stay unrequested.
    if (!progress.isUnavailable) void progress.refetch();
  };

  if (activeTab === "configuration") {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="hitl-quality_assessment-interface">
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <QualityAssessmentConfiguration projectId={projectId} />
        </div>
      </div>
    );
  }

  if (activeTab === "dashboard") {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="hitl-quality_assessment-interface">
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {progress.isAuthResolving ? (
            <Skeleton data-testid="qa-dashboard-skeleton" className="h-28 w-full" />
          ) : progress.isSignedOut ? (
            <ErrorState message={t("extraction", "progressUnavailable")} />
          ) : dashboardArticles.isError || progress.isError ? (
            <ErrorState message={t("qa", "dashboardLoadError")} onRetry={retryDashboard} />
          ) : dashboardArticles.isPending || progress.isLoading ? (
            // Pending, including a paused read: zeros would read as "nothing started".
            <Skeleton data-testid="qa-dashboard-skeleton" className="h-28 w-full" />
          ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Card className="border-border/40 shadow-elev-popover">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1 pt-4">
                <CardTitle className="text-[13px] font-medium">
                  {t("extraction", "dashboardArticles")}
                </CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-xl font-bold">{totalArticles}</div>
                <p className="text-[13px] text-muted-foreground">
                  {t("extraction", "dashboardInProject")}
                </p>
              </CardContent>
            </Card>
            <Card className="border-border/40 shadow-elev-popover">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1 pt-4">
                <CardTitle className="text-[13px] font-medium">
                  {t("extraction", "dashboardExtractionsStarted")}
                </CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-xl font-bold">{assessmentsStarted}</div>
                <p className="text-[13px] text-muted-foreground">
                  {activeTemplate?.name ?? "—"}
                </p>
              </CardContent>
            </Card>
            <Card className="border-border/40 shadow-elev-popover">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1 pt-4">
                <CardTitle className="text-[13px] font-medium">
                  {t("extraction", "dashboardProgress")}
                </CardTitle>
                <ShieldCheck className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-xl font-bold">{progressPercentage}%</div>
                <p className="text-[13px] text-muted-foreground">
                  {t("qa", "dashboardDesc")}
                </p>
              </CardContent>
            </Card>
          </div>
          )}
        </div>
      </div>
    );
  }

  // assessment tab
  if (templatesLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="hitl-quality_assessment-interface">
        <div className="flex min-h-0 flex-1 flex-col p-2">
          <div className="space-y-3">
            <Skeleton className="h-10 w-full max-w-md" />
            <Skeleton className="h-72 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!activeTemplate) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="hitl-quality_assessment-interface">
        <div className="flex min-h-0 flex-1 flex-col p-2">
          <div className="space-y-3">
            <HITLActiveTemplateBar
              kind="quality_assessment"
              templates={templates}
              activeTemplate={null}
              onSelect={selectTemplate}
            />
            <Card className="border-border/40">
              <CardHeader>
                <CardTitle className="text-base">
                  {t("qa", "noTemplatesTitle")}
                </CardTitle>
                <CardDescription>{t("qa", "activeTemplateNone")}</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="hitl-quality_assessment-interface">
      <div className="flex min-h-0 flex-1 flex-col p-2">
        <div className="shrink-0">
          <HITLActiveTemplateBar
            kind="quality_assessment"
            templates={templates}
            activeTemplate={activeTemplate}
            onSelect={selectTemplate}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col mt-3">
          <HITLArticleTable
            kind="quality_assessment"
            projectId={projectId}
            templateId={activeTemplate.id}
            templateSchema={activeTemplate.schema}
            rowActionHref={(articleId, templateId) =>
              `/projects/${projectId}/articles/${articleId}/quality-assessment/${templateId}`
            }
            emptyTitle={t("qa", "noArticlesForListTitle")}
            emptyDescription={t("qa", "noArticlesForListDesc")}
            toolbarActions={
              <>
                <IconButton
                  label={t("extraction", "exportButton")}
                  onClick={() => setShowExportDialog(true)}
                  disabled={worklist.length === 0}
                  data-testid="qa-export-button"
                  icon={<FileUp strokeWidth={1.5} />}
                />
                <EngineGear projectId={projectId} />
              </>
            }
          />
        </div>
      </div>

      {/* The active tool leads the list: it is the dialog's default tick. */}
      <HITLExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        projectId={projectId}
        templates={[
          { id: activeTemplate.id, name: activeTemplate.name },
          ...templates
            .filter((tpl) => tpl.id !== activeTemplate.id)
            .map((tpl) => ({ id: tpl.id, name: tpl.name })),
        ]}
        currentListIds={worklist.map((a) => a.id)}
        isManager={isManager}
      />
    </div>
  );
}
