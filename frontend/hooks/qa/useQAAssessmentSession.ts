/**
 * Hook that opens (or resumes) a Quality-Assessment session via
 * POST `/api/v1/hitl/sessions` with `kind=quality_assessment`.
 *
 * Returns the Run id, the cloned project_template_id, and the
 * (entity_type_id → instance_id) map needed to record proposals.
 *
 * The returned `refetch` triggers a fresh open call. Used after
 * `useReopenRun` so the page can pick up the newly-created
 * non-terminal run without a hard navigate / reload.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient } from "@/integrations/api";

export interface QAAssessmentSession {
  runId: string;
  projectTemplateId: string;
  instancesByEntityType: Record<string, string>;
}

interface UseQAAssessmentSessionProps {
  projectId: string | undefined;
  articleId: string | undefined;
  globalTemplateId: string | undefined;
  enabled?: boolean;
}

interface UseQAAssessmentSessionResult {
  session: QAAssessmentSession | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface OpenResponse {
  run_id: string;
  project_template_id: string;
  instances_by_entity_type: Record<string, string>;
}

export function useQAAssessmentSession({
  projectId,
  articleId,
  globalTemplateId,
  enabled = true,
}: UseQAAssessmentSessionProps): UseQAAssessmentSessionResult {
  const [session, setSession] = useState<QAAssessmentSession | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const open = useCallback(async () => {
    if (!enabled || !projectId || !articleId || !globalTemplateId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient<OpenResponse>("/api/v1/hitl/sessions", {
        method: "POST",
        body: {
          kind: "quality_assessment",
          project_id: projectId,
          article_id: articleId,
          global_template_id: globalTemplateId,
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
          err instanceof Error ? err.message : "Failed to open QA session",
        );
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [enabled, projectId, articleId, globalTemplateId]);

  useEffect(() => {
    cancelledRef.current = false;
    void open();
    return () => {
      cancelledRef.current = true;
    };
  }, [open]);

  return { session, loading, error, refetch: open };
}
