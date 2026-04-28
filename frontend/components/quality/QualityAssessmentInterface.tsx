/**
 * Quality Assessment landing — per-project view inside ProjectView.
 *
 * Lists every article in the project against the available global QA
 * templates (PROBAST, QUADAS-2, …). Each cell jumps to
 * /projects/:projectId/articles/:articleId/quality-assessment/:templateId
 * which opens the QualityAssessmentFullScreen for that pair.
 *
 * Mirrors the layout of `ExtractionInterface` but with a much simpler
 * model: QA templates are global (no per-project clone is visible to
 * the user — the assessment session endpoint clones lazily on first
 * open), and there's no AI extraction concept here.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalQATemplates } from "@/hooks/qa/useGlobalQATemplates";
import { t } from "@/lib/copy";

interface ArticleRow {
  id: string;
  title: string | null;
  authors: string[] | null;
  publication_year: number | null;
}

interface QualityAssessmentInterfaceProps {
  projectId: string;
}

export function QualityAssessmentInterface({
  projectId,
}: QualityAssessmentInterfaceProps) {
  const navigate = useNavigate();
  const { templates: qaTemplates, loading: templatesLoading, error: templatesError } =
    useGlobalQATemplates();

  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      setArticlesLoading(true);
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, authors, publication_year")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        toast.error(t("qa", "loadArticlesError"));
        setArticles([]);
      } else {
        setArticles(((data ?? []) as ArticleRow[]).slice(0, 200));
      }
      setArticlesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const open = (articleId: string, templateId: string) => {
    navigate(
      `/projects/${projectId}/articles/${articleId}/quality-assessment/${templateId}`,
    );
  };

  if (templatesError) {
    return (
      <div
        className="m-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        data-testid="qa-interface-error"
      >
        {templatesError}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6" data-testid="qa-interface">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-1 h-5 w-5 text-amber-600" />
        <div>
          <h2 className="text-lg font-semibold">
            {t("qa", "interfaceTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("qa", "interfaceDesc")}
          </p>
        </div>
      </div>

      {templatesLoading || articlesLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : qaTemplates.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("qa", "noTemplatesTitle")}
            </CardTitle>
            <CardDescription>{t("qa", "noTemplatesDesc")}</CardDescription>
          </CardHeader>
        </Card>
      ) : articles.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("qa", "noArticlesTitle")}
            </CardTitle>
            <CardDescription>{t("qa", "noArticlesDesc")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="qa-articles-list">
          {articles.map((article) => (
            <Card
              key={article.id}
              className="border-border/40"
              data-testid={`qa-article-${article.id}`}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium leading-snug">
                  {article.title ?? t("qa", "untitledArticle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {article.authors?.length
                    ? article.authors.slice(0, 3).join(", ") +
                      (article.authors.length > 3 ? " et al." : "")
                    : t("qa", "noAuthors")}
                  {article.publication_year ? ` · ${article.publication_year}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                {qaTemplates.map((tpl) => (
                  <Button
                    key={tpl.id}
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={() => open(article.id, tpl.id)}
                    data-testid={`qa-open-${article.id}-${tpl.name}`}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
                    {tpl.name}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      v{tpl.version}
                    </span>
                  </Button>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
