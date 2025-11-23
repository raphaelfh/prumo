/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Hook para gerenciar extraction_runs
 * 
 * Carrega histórico de extrações de IA (section-extraction) para um artigo específico.
 * 
 * @hook
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  ExtractionRun,
  ExtractionRunRaw,
  UseExtractionRunsProps,
  UseExtractionRunsReturn,
} from "@/types/ai-extraction";
import { normalizeExtractionRun } from "@/types/ai-extraction";

// Re-exportar tipo para compatibilidade
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

// Alias deprecated para compatibilidade temporária
/**
 * @deprecated Use useExtractionRuns instead.
 * This alias will be removed in a future version.
 */
export const usePDFExtractionRuns = useExtractionRuns;

