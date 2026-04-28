/**
 * Quality Assessment full-screen page (PROBAST / QUADAS-2 / future tools).
 *
 * Mounts the shared `AssessmentShell` (PDF panel + form panel + header)
 * with the PDF panel collapsed by default. The form panel renders one
 * `QASectionAccordion` per domain (entity_type) of the chosen QA template,
 * reusing the extraction `FieldInput` for signaling questions and a
 * domain-judgment summary card (Risk of Bias + Applicability concerns).
 *
 * Local-only state for now; wiring to the HITL backend (Run / proposal /
 * decision / consensus) is a follow-up — this page is the inspector view.
 */

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ArrowLeft, Loader2 } from "lucide-react";

import { AssessmentShell } from "@/components/assessment/AssessmentShell";
import { QASectionAccordion } from "@/components/assessment/QASectionAccordion";
import { PDFViewer } from "@/components/PDFViewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQATemplate } from "@/hooks/qa/useQATemplate";

export default function QualityAssessmentFullScreen() {
  const { projectId, articleId, templateId } = useParams<{
    projectId: string;
    articleId: string;
    templateId: string;
  }>();
  const navigate = useNavigate();

  const { template, domains, loading, error } = useQATemplate({
    templateId,
    enabled: !!templateId,
  });

  // Local-only values store keyed by field_id. Persistence to the HITL
  // stack (proposal/decision) lands in a follow-up; this page is the
  // structured inspector view.
  const [values, setValues] = useState<Record<string, unknown>>({});
  const handleValueChange = (fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  if (!projectId || !articleId || !templateId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Missing route parameters.
      </div>
    );
  }

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
          <span className="text-xs text-muted-foreground">
            v{template.version}
          </span>
        ) : null}
      </div>
    </div>
  );

  const pdfPanel = (
    <PDFViewer articleId={articleId} projectId={projectId} className="h-full" />
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

      {!loading && !error && template ? (
        <>
          {template.description ? (
            <p className="text-sm text-muted-foreground">
              {template.description}
            </p>
          ) : null}

          {domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This template has no domains defined.
            </p>
          ) : (
            <div data-testid="qa-domains">
              {domains.map((domain, idx) => (
                <QASectionAccordion
                  key={domain.entityType.id}
                  domain={domain}
                  values={values}
                  onValueChange={handleValueChange}
                  projectId={projectId}
                  articleId={articleId}
                  defaultOpen={idx === 0}
                />
              ))}
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
