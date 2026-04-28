/**
 * Hook that opens (or resumes) a Quality-Assessment session via
 * POST `/api/v1/qa-assessments`.
 *
 * Returns the Run id, the cloned project_template_id, and the
 * (entity_type_id → instance_id) map needed to record proposals.
 */

import { useEffect, useState } from "react";

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

  useEffect(() => {
    if (!enabled || !projectId || !articleId || !globalTemplateId) return;

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiClient<OpenResponse>("/api/v1/qa-assessments", {
          method: "POST",
          body: {
            project_id: projectId,
            article_id: articleId,
            global_template_id: globalTemplateId,
          },
        });
        if (!cancelled) {
          setSession({
            runId: data.run_id,
            projectTemplateId: data.project_template_id,
            instancesByEntityType: data.instances_by_entity_type,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to open QA session",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, articleId, globalTemplateId, enabled]);

  return { session, loading, error };
}
