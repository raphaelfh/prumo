/**
 * Hook to look up the latest finalized extraction run for
 * (article × project_template).
 *
 * Used purely for the "Reopen for revision" button on the extraction
 * page — when `useExtractedValues` returns `runId: null` (no
 * non-terminal run) but there *was* a previously finalized run, we
 * surface this hook's result so the user can re-open it.
 *
 * Reads/writes go through the existing `runId` from `useExtractedValues`
 * — this hook is read-only and does not interfere with the active-run
 * resolver.
 */

import { useCallback, useEffect, useState } from "react";

import { ExtractionValueService, type RunRef } from "@/services/extractionValueService";

interface UseFinalizedExtractionRunOptions {
  articleId: string | null | undefined;
  projectTemplateId: string | null | undefined;
  enabled?: boolean;
}

interface UseFinalizedExtractionRunResult {
  finalizedRun: RunRef | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useFinalizedExtractionRun(
  options: UseFinalizedExtractionRunOptions,
): UseFinalizedExtractionRunResult {
  const { articleId, projectTemplateId, enabled = true } = options;

  const [finalizedRun, setFinalizedRun] = useState<RunRef | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!articleId) {
      setFinalizedRun(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const run = await ExtractionValueService.findLatestFinalizedRun(
        articleId,
        projectTemplateId ?? null,
      );
      setFinalizedRun(run);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setFinalizedRun(null);
    } finally {
      setLoading(false);
    }
  }, [articleId, projectTemplateId]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  return { finalizedRun, loading, error, refresh: load };
}
