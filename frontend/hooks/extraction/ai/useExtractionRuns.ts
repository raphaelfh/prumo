/**
 * Hook to manage extraction_runs
 *
 * Loads AI extraction history (section-extraction) for a specific article.
 *
 * @hook
 */

import {useCallback, useEffect, useState} from "react";
import {supabase} from "@/integrations/supabase/client";
import type {
    ExtractionRun,
    ExtractionRunRaw,
    UseExtractionRunsProps,
    UseExtractionRunsReturn,
} from "@/types/ai-extraction";
import {normalizeExtractionRun} from "@/types/ai-extraction";

// Re-export type for compatibility
export type { ExtractionRun };

export function useExtractionRuns(props: UseExtractionRunsProps): UseExtractionRunsReturn {
  const { articleId, templateId, enabled = true } = props;
  const [runs, setRuns] = useState<ExtractionRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!enabled || !articleId || !templateId) {
      setRuns([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from("extraction_runs")
        .select("*")
        .eq("article_id", articleId)
        .eq("template_id", templateId)
        .order("started_at", { ascending: false })
        .limit(10);

      if (queryError) throw queryError;

      // Normalizar dados do banco para formato processado
      const normalizedRuns = (data || []).map((item: ExtractionRunRaw) =>
        normalizeExtractionRun(item)
      );

      setRuns(normalizedRuns);
    } catch (err: any) {
      console.error("Error loading extraction runs:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [articleId, templateId, enabled]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  return {
    runs,
    loading,
    error,
    refresh: loadRuns,
  };
}

// Deprecated alias for temporary compatibility
/**
 * @deprecated Use useExtractionRuns instead.
 * This alias will be removed in a future version.
 */
export const usePDFExtractionRuns = useExtractionRuns;

