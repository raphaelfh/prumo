/**
 * Hook that opens (or resumes) a Data-Extraction session via
 * POST `/api/v1/hitl/sessions` with `kind=extraction`.
 *
 * Mirrors `useQAAssessmentSession` for the extraction surface so
 * autosave, AI re-extraction, and the read path can share a Run that
 * the backend has already parked in `PROPOSAL` (the writable stage for
 * `human` proposals).
 *
 * The previous Supabase-direct `findActiveRun` lookup is replaced by
 * this session open — the backend ensures a Run exists, has instances
 * seeded for every top-level entity type, and is in PROPOSAL stage.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient } from "@/integrations/api";

export interface ExtractionSession {
  runId: string;
  projectTemplateId: string;
  instancesByEntityType: Record<string, string>;
}

interface UseExtractionSessionProps {
  projectId: string | undefined;
  articleId: string | undefined;
  projectTemplateId: string | undefined;
  enabled?: boolean;
}

interface UseExtractionSessionResult {
  session: ExtractionSession | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface OpenResponse {
  run_id: string;
  kind: "extraction" | "quality_assessment";
  project_template_id: string;
  instances_by_entity_type: Record<string, string>;
}

export function useExtractionSession({
  projectId,
  articleId,
  projectTemplateId,
  enabled = true,
}: UseExtractionSessionProps): UseExtractionSessionResult {
  const [session, setSession] = useState<ExtractionSession | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const open = useCallback(async () => {
    if (!enabled || !projectId || !articleId || !projectTemplateId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient<OpenResponse>("/api/v1/hitl/sessions", {
        method: "POST",
        body: {
          kind: "extraction",
          project_id: projectId,
          article_id: articleId,
          project_template_id: projectTemplateId,
        },
      });
      if (!cancelledRef.current) {
        setSession({
          runId: data.run_id,
          projectTemplateId: data.project_template_id,
          instancesByEntityType: data.instances_by_entity_type,
        });
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to open extraction session",
        );
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [enabled, projectId, articleId, projectTemplateId]);

  useEffect(() => {
    cancelledRef.current = false;
    void open();
    return () => {
      cancelledRef.current = true;
    };
  }, [open]);

  return { session, loading, error, refetch: open };
}
