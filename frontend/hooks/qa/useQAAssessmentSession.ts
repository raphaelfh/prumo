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
 *
 * Accepts either ``globalTemplateId`` (e.g. open-from-header-menu,
 * triggers a clone-on-first-call) or ``projectTemplateId`` (e.g.
 * open-from-the-articles-table where the project clone already exists).
 * Pass exactly one — the backend rejects both.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient } from "@/integrations/api";
import { type RunViewResponse } from "@/hooks/runs/types";

export interface QAAssessmentSession {
  runId: string;
  projectTemplateId: string;
  instancesByEntityType: Record<string, string>;
}

interface UseQAAssessmentSessionProps {
  projectId: string | undefined;
  articleId: string | undefined;
  globalTemplateId?: string | undefined;
  projectTemplateId?: string | undefined;
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
  run_view: RunViewResponse | null;
}

export function useQAAssessmentSession({
  projectId,
  articleId,
  globalTemplateId,
  projectTemplateId,
  enabled = true,
}: UseQAAssessmentSessionProps): UseQAAssessmentSessionResult {
  const [session, setSession] = useState<QAAssessmentSession | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonically-increasing generation token. Each effect-driven open()
  // reads the next value and only commits state when it still matches
  // generationRef.current. A shared cancelledRef toggle can't solve this:
  // React runs cleanup *then* the new effect body synchronously, so a
  // cancelled=true flag is reset to false before any in-flight Promise
  // observes it — a stale response would route proposals to the wrong run
  // (#109). Mirrors useExtractionSession.
  const generationRef = useRef(0);

  const open = useCallback(async () => {
    if (!enabled || !projectId || !articleId) return;
    if (!globalTemplateId && !projectTemplateId) return;
    const myGeneration = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient<OpenResponse>("/api/v1/hitl/sessions", {
        method: "POST",
        body: {
          kind: "quality_assessment",
          project_id: projectId,
          article_id: articleId,
          ...(projectTemplateId
            ? { project_template_id: projectTemplateId }
            : { global_template_id: globalTemplateId }),
        },
      });
      // Only the most-recent open() may commit. If a new effect fired while
      // we were in flight (article navigation, prop change), this generation
      // is stale and the response belongs to a previous article — discarding
      // it prevents autosave from routing proposals to the wrong run (#109).
      if (myGeneration !== generationRef.current) return;
      setSession({
        runId: data.run_id,
        projectTemplateId: data.project_template_id,
        instancesByEntityType: data.instances_by_entity_type,
      });
    } catch (err) {
      if (myGeneration !== generationRef.current) return;
      console.error("[useQAAssessmentSession] open() failed:", err);
      setError(
        err instanceof Error ? err.message : "Failed to open QA session",
      );
    } finally {
      if (myGeneration === generationRef.current) setLoading(false);
    }
  }, [enabled, projectId, articleId, globalTemplateId, projectTemplateId]);

  useEffect(() => {
    void open();
    return () => {
      // Bump the generation so any in-flight open() resolves into a no-op
      // when this effect tears down (unmount or dependency change).
      generationRef.current += 1;
    };
  }, [open]);

  return { session, loading, error, refetch: open };
}
