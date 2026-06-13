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

import { useEffect, useRef, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { runsKeys, type RunViewResponse } from "@/hooks/runs/types";
import { openExtractionSession } from "@/services/extractionRunService";

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

  const willOpen = Boolean(enabled && projectId && articleId && projectTemplateId);

  // Show the loader for effect-triggered opens during render, so openCore
  // performs no synchronous setState when the effect kicks it off (the POST
  // itself still starts synchronously — autosave relies on the generation
  // bump ordering). The null sentinel covers the mount load.
  const [prevOpenKey, setPrevOpenKey] = useState<{
    enabled: boolean;
    projectId: string | undefined;
    articleId: string | undefined;
    projectTemplateId: string | undefined;
  } | null>(null);
  if (
    !prevOpenKey ||
    enabled !== prevOpenKey.enabled ||
    projectId !== prevOpenKey.projectId ||
    articleId !== prevOpenKey.articleId ||
    projectTemplateId !== prevOpenKey.projectTemplateId
  ) {
    setPrevOpenKey({ enabled, projectId, articleId, projectTemplateId });
    if (willOpen) {
      setLoading(true);
      setError(null);
    }
  }

  const openCore = async () => {
    if (!enabled || !projectId || !articleId || !projectTemplateId) return;
    const myGeneration = ++generationRef.current;

    const result = await openExtractionSession({projectId, articleId, projectTemplateId});

    // Only the most-recent open() may commit. If a new effect fired
    // while we were in flight (article navigation, prop change), this
    // generation is stale and the response belongs to a previous
    // article — discarding it prevents autosave from routing
    // proposals to the wrong run (#23).
    if (myGeneration !== generationRef.current) return;

    if (!result.ok) {
      // Surface the failure to the console — the page only renders
      // ``error`` inline if the form is already mounted, but the
      // extraction route gates rendering on ``valuesLoading`` until the
      // session resolves. Without this log a silent backend rejection
      // (BOLA, 401, 404) is invisible to support.
      console.error("[useExtractionSession] open() failed:", result.error);
      setError(result.error.message || "Failed to open extraction session");
      setLoading(false);
      return;
    }

    const data = result.data;
    // Pre-seed the run-detail cache from the embedded view so useRun reads
    // from cache on first paint — collapsing the session -> GET /runs/{id} ->
    // values serial waterfall. Inside the generation guard so a stale
    // article's view can never poison the new article's run cache.
    if (data.run_view) {
      queryClient.setQueryData(runsKeys.detail(data.run_id), data.run_view as RunViewResponse);
    }
    setSession({
      runId: data.run_id,
      projectTemplateId: data.project_template_id,
      instancesByEntityType: data.instances_by_entity_type,
    });
    setLoading(false);
  };

  // Manual refetch (event-handler context): show the loader, then reopen.
  const refetch = async () => {
    if (!enabled || !projectId || !articleId || !projectTemplateId) return;
    setLoading(true);
    setError(null);
    await openCore();
  };

  const openCoreRef = useRef(openCore);
  useEffect(() => {
    openCoreRef.current = openCore;
  }, [openCore]);

  useEffect(() => {
    // The POST must start synchronously (in-flight generation ordering);
    // openCore's setState calls all happen after its first await, and the
    // loader reset happens during render above.
    void openCoreRef.current();
    return () => {
      // Bump the generation so any in-flight open() resolves into a
      // no-op when this effect tears down (component unmount or
      // dependency change).
      generationRef.current += 1;
    };
  }, [openCore]);

  return { session, loading, error, refetch };
}
