/**
 * Hook to look up the latest finalized extraction run for
 * (article × project_template).
 *
 * Used purely for the "Reopen for revision" button on the extraction
 * page — when the open session has no run (or the open run is the
 * finalized one) but there *was* a previously finalized run, we surface
 * this hook's result so the user can re-open it. Read-only: the form's
 * reads and writes go through `useRunValues` on the session run.
 */

import { useEffect, useRef, useState } from "react";

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

  // Generation guard: a lookup started for one articleId must not write its
  // result once a newer lookup has begun, or a slow response for the previous
  // article silently overwrites the current one (#285). Same pattern as
  // ProjectView's projectLoadRef.
  const loadGenerationRef = useRef(0);

  // Disabled, the lookup never runs — also when a caller refreshes it after a
  // stage command on a run that is not (yet) finalized.
  const load = async () => {
    if (!enabled) return;
    if (!articleId) {
      setFinalizedRun(null);
      return;
    }
    loadGenerationRef.current += 1;
    const generation = loadGenerationRef.current;

    setLoading(true);
    setError(null);

    ExtractionValueService.findLatestFinalizedRun(articleId, projectTemplateId ?? null)
      .then((run) => {
        if (generation !== loadGenerationRef.current) return;
        setFinalizedRun(run);
      })
      .catch((err: unknown) => {
        if (generation !== loadGenerationRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setFinalizedRun(null);
      })
      .finally(() => {
        if (generation !== loadGenerationRef.current) return;
        setLoading(false);
      });
  };

  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void load());
  }, [enabled, load]);

  return { finalizedRun, loading, error, refresh: load };
}
