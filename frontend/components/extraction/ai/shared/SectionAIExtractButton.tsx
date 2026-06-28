/**
 * Shared per-section "Extract with AI" button.
 *
 * Owns the `useSectionExtraction` job + tooltip + spinner so both
 * `SectionAccordion` (data extraction) and `QASectionAccordion` (quality
 * assessment) render an identical per-section ✨ affordance. Section
 * extraction is per entity-type; the backend extracts a whole section at once.
 */

import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { t } from "@/lib/copy";
import { useSectionExtraction } from "@/hooks/extraction/useSectionExtraction";

export interface SectionAIExtractButtonProps {
  projectId: string;
  articleId: string;
  templateId: string;
  entityTypeId: string;
  entityLabel: string;
  runId?: string | null;
  parentInstanceId?: string;
  /** Disable + swap the tooltip (e.g. single-cardinality section, no instance). */
  disabled?: boolean;
  onExtractionComplete?: (runId?: string) => void | Promise<void>;
}

export function SectionAIExtractButton({
  projectId,
  articleId,
  templateId,
  entityTypeId,
  entityLabel,
  runId,
  parentInstanceId,
  disabled = false,
  onExtractionComplete,
}: SectionAIExtractButtonProps) {
  const { extractSection, loading } = useSectionExtraction({
    onSuccess: (completedRunId) => {
      // Background refresh; never block the hook's loading reset.
      if (!onExtractionComplete) return;
      Promise.resolve(onExtractionComplete(completedRunId)).catch(
        (err: unknown) => {
          console.error("SectionAIExtractButton onExtractionComplete failed:", err);
        },
      );
    },
  });

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // never toggle a wrapping accordion
    void extractSection({
      projectId,
      articleId,
      templateId,
      entityTypeId,
      parentInstanceId,
      runId: runId ?? undefined,
    }).catch((error: unknown) => {
      // Errors already surfaced as a toast by the hook.
      console.error("Section extraction failed:", error);
    });
  };

  const label = disabled
    ? t("extraction", "createInstanceBeforeExtract")
    : loading
      ? t("extraction", "extractingWithAI")
      : t("extraction", "extractSectionWithAI").replace("{{label}}", entityLabel);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 shrink-0"
            onClick={handleClick}
            disabled={disabled || loading}
            title={label}
            aria-label={label}
            data-testid={`section-ai-extract-${entityTypeId}`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Sparkles className="h-4 w-4 text-primary" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
