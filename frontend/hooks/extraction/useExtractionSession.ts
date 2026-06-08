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

import { useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/integrations/api";
import { runsKeys, type RunViewResponse } from "@/hooks/runs/types";

// Monotonically-increasing generation token. Each effect-driven call to
// `open()` reads the next value and only commits state when it still
// matches `generationRef.current`. A shared `cancelledRef` toggle can't
// solve this: React runs cleanup *then* the new effect body
// synchronously, so the cancelled=true flag is reset to false before any
// pending in-flight Promise observes it (#23).

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
  run_view: RunViewResponse | null;
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
  const generationRef = useRef(0);
  const queryClient = useQueryClient();

  const open = useCallback(async () => {
    if (!enabled || !projectId || !articleId || !projectTemplateId) return;
    const myGeneration = ++generationRef.current;
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
      // Only the most-recent open() may commit. If a new effect fired
      // while we were in flight (article navigation, prop change), this
      // generation is stale and the response belongs to a previous
      // article — discarding it prevents autosave from routing
      // proposals to the wrong run (#23).
      if (myGeneration !== generationRef.current) return;
      // Pre-seed the run-detail cache from the embedded view so useRun reads
      // from cache on first paint — collapsing the session -> GET /runs/{id} ->
      // values serial waterfall. Inside the generation guard so a stale
      // article's view can never poison the new article's run cache.
      if (data.run_view) {
        queryClient.setQueryData(runsKeys.detail(data.run_id), data.run_view);
      }
      setSession({
        runId: data.run_id,
        projectTemplateId: data.project_template_id,
        instancesByEntityType: data.instances_by_entity_type,
      });
    } catch (err) {
      if (myGeneration !== generationRef.current) return;
      // Surface the failure to the console — the page only renders
      // ``error`` inline if the form is already mounted, but the
      // extraction route gates rendering on ``valuesLoading`` until the
      // session resolves. Without this log a silent backend rejection
      // (BOLA, 401, 404) is invisible to support.
      console.error("[useExtractionSession] open() failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to open extraction session",
      );
    } finally {
      if (myGeneration === generationRef.current) setLoading(false);
    }
  }, [enabled, projectId, articleId, projectTemplateId, queryClient]);

  useEffect(() => {
    void open();
    return () => {
      // Bump the generation so any in-flight open() resolves into a
      // no-op when this effect tears down (component unmount or
      // dependency change).
      generationRef.current += 1;
    };
  }, [open]);

  return { session, loading, error, refetch: open };
}
