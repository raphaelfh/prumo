import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import { AssessmentShell } from "@/components/assessment/AssessmentShell";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface ProjectExtractionTemplate {
  id: string;
  name: string;
  description?: string | null;
  kind: string;
  framework: string;
}

export default function QualityAssessmentFullScreen() {
  const { projectId, articleId, templateId } = useParams<{
    projectId: string;
    articleId: string;
    templateId: string;
  }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<ProjectExtractionTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000"}/api/v1/extraction-templates/${templateId}`,
        );
        if (!res.ok) {
          throw new Error(`Failed to load template (${res.status})`);
        }
        const body = await res.json();
        if (!cancelled) {
          setTemplate(body.data ?? body);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  if (!projectId || !articleId || !templateId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Missing route parameters.
      </div>
    );
  }

  const header = (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/projects/${projectId}`)}
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <span
          className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-200"
          data-testid="qa-kind-badge"
        >
          Quality Assessment
        </span>
        <h1 className="text-base font-medium" data-testid="qa-template-name">
          {template?.name ?? "Loading…"}
        </h1>
      </div>
    </div>
  );

  const pdfPanel = (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      PDF viewer for article {articleId}
    </div>
  );

  const formPanel = (
    <div className="space-y-4 p-6" data-testid="qa-form-panel">
      {error ? (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {template ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">{template.name}</h2>
          {template.description ? (
            <p className="text-sm text-muted-foreground">{template.description}</p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Quality-assessment form rendering will be added in a follow-up.
            The shared HITL stack (proposal/review/consensus) is wired and
            ready; this page mounts the shared shell with the QA template.
          </p>
        </div>
      ) : !error ? (
        <p className="text-sm text-muted-foreground">Loading template…</p>
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
