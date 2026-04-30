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

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle, FileText, ShieldCheck } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { t } from "@/lib/copy";
import {
  HITLActiveTemplateBar,
  useActiveTemplateSelection,
} from "@/components/hitl/HITLActiveTemplateBar";
import { HITLArticleTable } from "@/components/hitl/HITLArticleTable";
import { QualityAssessmentConfiguration } from "@/components/quality/QualityAssessmentConfiguration";
import { useHITLProjectTemplates } from "@/hooks/hitl/useHITLProjectTemplates";

type QaTab = "assessment" | "dashboard" | "configuration";

interface Props {
  projectId: string;
}

export function QualityAssessmentInterface({ projectId }: Props) {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const tabFromUrl = searchParams.get("qaTab") as QaTab | null;
  const activeTab: QaTab =
    tabFromUrl && ["assessment", "dashboard", "configuration"].includes(tabFromUrl)
      ? tabFromUrl
      : "assessment";

  const {
    templates,
    loading: templatesLoading,
    refresh,
  } = useHITLProjectTemplates({
    projectId,
    kind: "quality_assessment",
  });

  const { activeTemplate, selectTemplate } = useActiveTemplateSelection(templates);

  // Dashboard counters — same shape as extraction's stats card row.
  const [stats, setStats] = useState({
    totalArticles: 0,
    assessmentsStarted: 0,
    progressPercentage: 0,
  });

  useEffect(() => {
    if (!projectId || !activeTemplate || !user) return;
    let cancelled = false;
    void (async () => {
      const articlesRes = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      const totalArticles = articlesRes.count ?? 0;

      const instancesRes = await supabase
        .from("extraction_instances")
        .select("article_id")
        .eq("project_id", projectId)
        .eq("template_id", activeTemplate.id);
      const articlesWithInstances = new Set(
        (instancesRes.data ?? []).map((row: any) => row.article_id),
      );

      if (cancelled) return;
      const started = articlesWithInstances.size;
      setStats({
        totalArticles,
        assessmentsStarted: started,
        progressPercentage:
          totalArticles > 0 ? Math.round((started / totalArticles) * 100) : 0,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, activeTemplate, user]);

  const tabContent = useMemo(() => {
    if (activeTab === "configuration") {
      return (
        <QualityAssessmentConfiguration
          projectId={projectId}
          onAfterChange={() => void refresh()}
        />
      );
    }

    if (activeTab === "dashboard") {
      return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Card className="border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1 pt-4">
              <CardTitle className="text-[13px] font-medium">
                {t("extraction", "dashboardArticles")}
              </CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-xl font-bold">{stats.totalArticles}</div>
              <p className="text-[13px] text-muted-foreground">
                {t("extraction", "dashboardInProject")}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1 pt-4">
              <CardTitle className="text-[13px] font-medium">
                {t("extraction", "dashboardExtractionsStarted")}
              </CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-xl font-bold">{stats.assessmentsStarted}</div>
              <p className="text-[13px] text-muted-foreground">
                {activeTemplate?.name ?? "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-1 pt-4">
              <CardTitle className="text-[13px] font-medium">
                {t("extraction", "dashboardProgress")}
              </CardTitle>
              <ShieldCheck className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-xl font-bold">{stats.progressPercentage}%</div>
              <p className="text-[13px] text-muted-foreground">
                {t("qa", "dashboardDesc")}
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    // assessment tab
    if (templatesLoading) {
      return (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-72 w-full" />
        </div>
      );
    }

    if (!activeTemplate) {
      return (
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
      );
    }

    return (
      <div className="space-y-3">
        <HITLActiveTemplateBar
          kind="quality_assessment"
          templates={templates}
          activeTemplate={activeTemplate}
          onSelect={selectTemplate}
        />
        <HITLArticleTable
          kind="quality_assessment"
          projectId={projectId}
          templateId={activeTemplate.id}
          rowActionHref={(articleId, templateId) =>
            `/projects/${projectId}/articles/${articleId}/quality-assessment/${templateId}`
          }
          emptyTitle={t("qa", "noArticlesForListTitle")}
          emptyDescription={t("qa", "noArticlesForListDesc")}
        />
      </div>
    );
  }, [activeTab, activeTemplate, projectId, refresh, selectTemplate, stats, templates, templatesLoading]);

  return (
    <div className="space-y-4 p-4 lg:p-6" data-testid="hitl-quality_assessment-interface">
      {tabContent}
    </div>
  );
}
