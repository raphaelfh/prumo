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

import { t } from "@/lib/copy";
import {
  extractForRun as extractForRunService,
  type ExtractForRunRequest,
  type ExtractForRunResult,
} from "@/services/extractionRunService";

export type { ExtractForRunResult as ExtractForRunResponseBody };

export interface UseRunAIExtractionReturn {
  extractForRun: (params: ExtractForRunRequest) => Promise<ExtractForRunResult>;
  loading: boolean;
  error: string | null;
}

export function useRunAIExtraction(options?: {
  onSuccess?: (result: ExtractForRunResult) => Promise<void> | void;
}): UseRunAIExtractionReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractForRun = useCallback(
    async (params: ExtractForRunRequest): Promise<ExtractForRunResult> => {
      setLoading(true);
      setError(null);

      const doExtract = async (): Promise<ExtractForRunResult> => {
        const result = await extractForRunService(params);
        if (!result.ok) throw result.error;

        if (options?.onSuccess) {
          await options.onSuccess(result.data);
        }
        const created = result.data?.totalSuggestionsCreated ?? 0;
        const successful = result.data?.successfulSections ?? 0;
        const total = result.data?.totalSections ?? 0;
        toast.success(
          t("extraction", "fullAICompleteSuccessTitle"),
          {
            description: `${created} suggestions created across ${successful}/${total} sections.`,
          },
        );
        return result.data;
      };

      return doExtract()
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          toast.error(
            `${t("extraction", "fullAIErrorPrefix")}: ${message}`,
            { duration: 8000 },
          );
          throw err;
        })
        .finally(() => setLoading(false));
    },
    [options],
  );

  return { extractForRun, loading, error };
}
