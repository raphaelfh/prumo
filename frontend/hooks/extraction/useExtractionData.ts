/**
 * Hook to load extraction data
 *
 * Centralizes all ExtractionFullScreen data loading:
 * - Article, project, template
 * - Entity types with fields
 * - Instances
 *
 * Reduces main component complexity (SRP).
 */

import {useCallback, useEffect, useState} from 'react';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {extractionInstanceService} from '@/services/extractionInstanceService';
import {
  loadExtractionPhase1,
  loadEntityTypesWithFields,
} from '@/services/extractionDataService';
import type {Article} from '@/types/article';
import type {Project} from '@/types/project';
import type {
    ExtractionEntityTypeWithFields,
    ExtractionInstance,
    ProjectExtractionTemplate
} from '@/types/extraction';

/**
 * Re-export the canonical type for callers that imported it from this
 * module before consolidation. New callers should import directly from
 * ``@/types/extraction``.
 */
export type EntityTypeWithFields = ExtractionEntityTypeWithFields;

/**
 * Returns a new array only when something actually changed (added, removed,
 * or shallow-different at the entry level keyed by id). Preserves the
 * reference of unchanged entries so React reuses the same Fiber and the
 * extraction form does not remount + scroll-reset on every refresh.
 */
function mergeInstancesById(
  prev: ExtractionInstance[],
  next: ExtractionInstance[]
): ExtractionInstance[] {
  const prevById = new Map(prev.map((i) => [i.id, i] as const));
  const nextById = new Map(next.map((i) => [i.id, i] as const));

  let changed = prev.length !== next.length;
  const merged = next.map((incoming) => {
    const existing = prevById.get(incoming.id);
    if (!existing) {
      changed = true;
      return incoming;
    }
    // Cheap shallow check on the surface fields the form actually reads.
    const sameShape =
      existing.label === incoming.label &&
      existing.sort_order === incoming.sort_order &&
      existing.status === incoming.status &&
      existing.parent_instance_id === incoming.parent_instance_id;
    if (!sameShape) {
      changed = true;
      return { ...existing, ...incoming };
    }
    return existing;
  });

  if (!changed) {
    // Detect removals.
    for (const id of prevById.keys()) {
      if (!nextById.has(id)) {
        changed = true;
        break;
      }
    }
  }

  return changed ? merged : prev;
}

interface UseExtractionDataReturn {
    // Loaded data
  article: Article | null;
  project: Project | null;
  template: ProjectExtractionTemplate | null;
  entityTypes: EntityTypeWithFields[];
  instances: ExtractionInstance[];
  articles: Article[];

    // State
  loading: boolean;
  error: string | null;

    // Functions
  refresh: () => Promise<void>;
  refreshInstances: () => Promise<void>;
}

interface UseExtractionDataProps {
  projectId: string | undefined;
  articleId: string | undefined;
  enabled?: boolean;
}

/**
 * Hook to load all data needed for extraction
 */
export function useExtractionData({
  projectId,
  articleId,
  enabled = true,
}: UseExtractionDataProps): UseExtractionDataReturn {
  const [article, setArticle] = useState<Article | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [template, setTemplate] = useState<ProjectExtractionTemplate | null>(null);
  const [entityTypes, setEntityTypes] = useState<EntityTypeWithFields[]>([]);
  const [instances, setInstances] = useState<ExtractionInstance[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

    // Load existing instances (without creating). Uses merge-by-id so a
    // refresh keeps existing React keys stable for instances that didn't
    // change — only added/updated entries trigger downstream re-renders. This
    // removes the visual flash + scroll reset that came from replacing the
    // whole array on every refresh.
  const loadInstances = useCallback(async (templateId: string) => {
    if (!articleId || !templateId) {
      setInstances([]);
      return;
    }

    const result = await extractionInstanceService.getInstances({articleId, templateId});
    const normalised: ExtractionInstance[] = result.map(instance => ({
      ...instance,
      article_id: instance.article_id!,
      metadata: instance.metadata as unknown,
    }));
    setInstances(prev => mergeInstancesById(prev, normalised));
  }, [articleId]);

    // Load all data
  const loadData = useCallback(() => {
    if (!enabled || !projectId || !articleId) {
      setLoading(false);
      return Promise.resolve();
    }

    setLoading(true);
    setError(null);

    const doLoad = async () => {
      // Phase 1 — independent reads in parallel. Article, project, the
      // active extraction template, and the navigation article list don't
      // depend on one another, so awaiting them sequentially only stacked
      // latency. Resolving the template ASAP matters most: the HITL session
      // open (the single slowest critical-path call) is gated on
      // ``template.id``, and the strictly-sequential version parked the
      // template 3rd in line, stalling the whole extracted-values waterfall
      // behind two unrelated round-trips.
      const phase1 = await loadExtractionPhase1(
        articleId,
        projectId,
        t('common', 'errors_templateNotFound'),
      );

      if (!phase1.ok) {
        const message = phase1.error.message || t('extraction', 'errors_loadExtractionData');
        setError(message);
        toast.error(message);
        return;
      }

      setArticle(phase1.data.article);
      setProject(phase1.data.project);
      setTemplate(phase1.data.template as ProjectExtractionTemplate);
      setArticles(phase1.data.articles);

      // Phase 2 — entity types (with fields) and the already-materialised
      // instances both depend only on the resolved template id, so load
      // them together. Instances are seeded by the backend
      // ``hitl_session_service._ensure_instances`` on session open;
      // ``ExtractionFullScreen`` re-triggers ``refreshInstances`` once the
      // session ``activeRunId`` is available, so we don't race the session.
      const [entityTypesResult] = await Promise.all([
        loadEntityTypesWithFields(phase1.data.template.id),
        loadInstances(phase1.data.template.id),
      ]);

      if (!entityTypesResult.ok) {
        const message = entityTypesResult.error.message || t('extraction', 'errors_loadExtractionData');
        setError(message);
        toast.error(message);
        return;
      }

      setEntityTypes(entityTypesResult.data);
    };

    return doLoad()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('extraction', 'errors_loadExtractionData');
        console.error('Error loading extraction data:', err);
        setError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  }, [projectId, articleId, enabled, loadInstances]);

    // Load initial data
  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadData());
  }, [loadData]);

    // Refresh function
  const refresh = useCallback(async () => {
    await loadData();
  }, [loadData]);

    // Refresh instances only (no new creation). Plain-identifier dep —
    // optional-chained deps defeat compiler memoization preservation.
  const activeTemplateId = template?.id;
  const refreshInstances = useCallback(async () => {
    if (activeTemplateId) {
      await loadInstances(activeTemplateId);
    }
  }, [activeTemplateId, loadInstances]);

  return {
    article,
    project,
    template,
    entityTypes,
    instances,
    articles,
    loading,
    error,
    refresh,
    refreshInstances,
  };
}
