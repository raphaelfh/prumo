/**
 * Shared per-section "Extract with AI" button.
 *
 * Owns the `useSectionExtraction` job + tooltip + spinner so both
 * `SectionAccordion` (data extraction) and `QASectionAccordion` (quality
 * assessment) render an identical per-section ✨ affordance. Section
 * extraction is per entity-type; the backend extracts a whole section at once.
 */

import { Loader2, Sparkles } from "lucide-react";

import { IconButton } from "@/components/patterns/IconButton";
import { extractionErrorToast } from "@/lib/ai-extraction/extractionErrorToast";
import { t } from "@/lib/copy";
import { useRunEditability } from "@/components/runs/RunEditabilityContext";
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
  const { readOnly } = useRunEditability();
  const params = {projectId, articleId, templateId, entityTypeId, parentInstanceId, runId: runId ?? undefined};
  const { extractSection, loading, getSectionState } = useSectionExtraction({
    params,
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

  // Read-only run: no AI extraction affordance at all. The bail sits AFTER
  // every hook call — an early return above them breaks the rules of hooks
  // when readOnly flips on a mounted tree (stage starts null).
  if (readOnly) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // never toggle a wrapping accordion
    void extractSection(params).catch((error: unknown) => {
      // Errors already surfaced as a toast by the hook.
      console.error("Section extraction failed:", error);
    });
  };

  const state = getSectionState(params);
  const failure = state.error;
  const retryLabel = state.uncertainTransport
    ? t("extraction", "sectionExtractionRetryTransport")
    : failure
      ? t("extraction", "sectionExtractionRetry").replace("{{reason}}", extractionErrorToast(failure.code, failure.message)?.title ?? failure.message)
      : null;
  const label = disabled
    ? t("extraction", "createInstanceBeforeExtract")
    : loading
      ? t("extraction", "extractingWithAI")
      : retryLabel ?? t("extraction", "extractSectionWithAI").replace("{{label}}", entityLabel);

  return (
    <IconButton
      className="shrink-0"
      onClick={handleClick}
      disabled={disabled || loading}
      label={label}
      data-testid={`section-ai-extract-${entityTypeId}`}
      icon={loading ? (
        <Loader2 className="animate-spin text-primary" />
      ) : (
        <Sparkles className="text-primary" />
      )}
    />
  );
}
