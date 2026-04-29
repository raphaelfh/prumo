/**
 * Run AI extraction over an *existing* Run.
 *
 * Thin wrapper around ``POST /api/v1/extraction/sections`` for the case
 * where the Run is already open (typically via the HITL session
 * service) and the caller just wants the LLM to fill it in. The
 * endpoint handles both kinds: it picks the right system / user prompt
 * from ``run.kind`` + ``template.framework`` server-side.
 *
 * Used today by Quality Assessment. Kind-agnostic by design — the
 * caller doesn't have to know whether the run is extraction or
 * quality_assessment, only that it exists and is in PROPOSAL stage.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api";
import { t } from "@/lib/copy";

interface ExtractForRunRequest {
  projectId: string;
  articleId: string;
  templateId: string;
  runId: string;
  /**
   * Default true: only fields without a more recent ``human`` proposal
   * receive an AI proposal. Lets users re-run AI without losing edits.
   */
  skipFieldsWithHumanProposals?: boolean;
  /**
   * Default false: keep the run in PROPOSAL after success. QA needs
   * this off because its publish flow drives the lifecycle from
   * PROPOSAL → REVIEW → CONSENSUS → FINALIZED in one go.
   */
  autoAdvanceToReview?: boolean;
  model?: string;
}

interface ExtractForRunResponseBody {
  extractionRunId: string;
  totalSections: number;
  successfulSections: number;
  failedSections: number;
  totalSuggestionsCreated: number;
  totalTokensUsed: number;
  durationMs: number;
}

export interface UseRunAIExtractionReturn {
  extractForRun: (params: ExtractForRunRequest) => Promise<ExtractForRunResponseBody>;
  loading: boolean;
  error: string | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export function useRunAIExtraction(options?: {
  onSuccess?: (result: ExtractForRunResponseBody) => Promise<void> | void;
}): UseRunAIExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractForRun = useCallback(
    async (params: ExtractForRunRequest): Promise<ExtractForRunResponseBody> => {
      setLoading(true);
      setError(null);
      try {
        const envelope = await apiClient<ApiEnvelope<ExtractForRunResponseBody>>(
          "/api/v1/extraction/sections",
          {
            method: "POST",
            body: {
              projectId: params.projectId,
              articleId: params.articleId,
              templateId: params.templateId,
              runId: params.runId,
              skipFieldsWithHumanProposals:
                params.skipFieldsWithHumanProposals ?? true,
              autoAdvanceToReview: params.autoAdvanceToReview ?? false,
              model: params.model ?? "gpt-4o-mini",
            },
          },
        );
        const result = envelope.data;
        if (options?.onSuccess) {
          await options.onSuccess(result);
        }
        toast.success(
          t("extraction", "fullAICompleteSuccessTitle"),
          {
            description: `${result.totalSuggestionsCreated} suggestions created across ${result.successfulSections}/${result.totalSections} sections.`,
          },
        );
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(
          `${t("extraction", "fullAIErrorPrefix")}: ${message}`,
          { duration: 8000 },
        );
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [options],
  );

  return { extractForRun, loading, error };
}
