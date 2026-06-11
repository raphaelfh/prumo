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
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {extractionInstanceService} from '@/services/extractionInstanceService';
import type {Article} from '@/types/article';
import type {Project} from '@/types/project';
import type {
    ExtractionEntityTypeWithFields,
    ExtractionField,
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

    try {
      const refreshedInstances = await extractionInstanceService.getInstances({
        articleId,
        templateId
      });

      const normalised: ExtractionInstance[] = refreshedInstances.map(instance => ({
        ...instance,
        article_id: instance.article_id!,
        metadata: instance.metadata as unknown,
      }));

      setInstances(prev => mergeInstancesById(prev, normalised));
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('extraction', 'errors_loadInstances');
        console.error('Error loading instances:', err);
      toast.error(message);
    }
  }, [articleId]);

    // Load all data
  const loadData = useCallback(async () => {
    if (!enabled || !projectId || !articleId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Phase 1 — independent reads in parallel. Article, project, the
      // active extraction template, and the navigation article list don't
      // depend on one another, so awaiting them sequentially only stacked
      // latency. Resolving the template ASAP matters most: the HITL session
      // open (the single slowest critical-path call) is gated on
      // ``template.id``, and the strictly-sequential version parked the
      // template 3rd in line, stalling the whole extracted-values waterfall
      // behind two unrelated round-trips.
      //
      // Template selection: newest active wins (``created_at`` DESC) so this
      // matches ``ExtractionInterface``'s active picker and Configuration and
      // Extraction views converge on the same template (BUG #1 — split
      // picker). Defensive against legacy projects with multiple actives.
      const [
        { data: articleData, error: articleError },
        { data: projectData, error: projectError },
        { data: templateData, error: templateError },
        { data: articlesData, error: articlesError },
      ] = await Promise.all([
        supabase.from('articles').select('*').eq('id', articleId).single(),
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase
          .from('project_extraction_templates')
          .select('*')
          .eq('project_id', projectId)
          .eq('is_active', true)
          .eq('kind', 'extraction')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('articles')
          .select('id, title')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false }),
      ]);

      if (articleError) throw articleError;
      if (projectError) throw projectError;
      if (templateError) throw templateError;
      if (articlesError) throw articlesError;
      if (!templateData) throw new Error(t('common', 'errors_templateNotFound'));

      setArticle(articleData);
      setProject(projectData);
      setTemplate(templateData as ProjectExtractionTemplate);
      setArticles((articlesData ?? []) as Article[]);

      // Phase 2 — entity types (with fields) and the already-materialised
      // instances both depend only on the resolved template id, so load
      // them together. Instances are seeded by the backend
      // ``hitl_session_service._ensure_instances`` on session open;
      // ``ExtractionFullScreen`` re-triggers ``refreshInstances`` once the
      // session ``activeRunId`` is available, so we don't race the session.
      const [{ data: entityTypesData, error: entityTypesError }] =
        await Promise.all([
          supabase
            .from('extraction_entity_types')
            .select(`
          *,
          fields:extraction_fields(*)
        `)
            .eq('project_template_id', templateData.id)
            .order('sort_order', { ascending: true }),
          loadInstances(templateData.id),
        ]);

      if (entityTypesError) throw entityTypesError;

      const typesWithFields: EntityTypeWithFields[] = (entityTypesData || []).map(et => ({
        ...et,
        template_id: et.template_id!,
        fields: ((et.fields || []) as ExtractionField[]).map(field => ({
          ...field,
          allowed_values: field.allowed_values as string[] | null,
          allowed_units: field.allowed_units as string[] | null,
          validation_schema: field.validation_schema as unknown,
        })),
      }));

      setEntityTypes(typesWithFields);

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('extraction', 'errors_loadExtractionData');
        console.error('Error loading extraction data:', err);
      setError(message);
      toast.error(message);
      setLoading(false);
    } finally {
      setLoading(false);
    }
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

