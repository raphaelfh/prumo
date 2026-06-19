/**
 * Hook to load extraction page bootstrap data.
 *
 * Centralizes the run-open page's non-run reads:
 * - Article, project, active extraction template
 * - The project's article list (header navigation)
 *
 * Entity types + instances are NOT loaded here anymore — the run-open
 * page derives them from the server RunView (GET /api/v1/runs/:id/view)
 * via ``runViewAdapters``. This hook holds zero ``supabase.from`` reads.
 *
 * Reduces main component complexity (SRP).
 */

import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {loadExtractionPhase1} from '@/services/extractionDataService';
import type {Article} from '@/types/article';
import type {Project} from '@/types/project';
import type {ProjectExtractionTemplate} from '@/types/extraction';

interface UseExtractionDataReturn {
    // Loaded data
  article: Article | null;
  project: Project | null;
  template: ProjectExtractionTemplate | null;
  articles: Article[];

    // State
  loading: boolean;
  error: string | null;

    // Functions
  refresh: () => Promise<void>;
}

interface UseExtractionDataProps {
  projectId: string | undefined;
  articleId: string | undefined;
  enabled?: boolean;
}

/**
 * Hook to load the page-bootstrap data needed for extraction.
 */
export function useExtractionData({
  projectId,
  articleId,
  enabled = true,
}: UseExtractionDataProps): UseExtractionDataReturn {
  const [article, setArticle] = useState<Article | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [template, setTemplate] = useState<ProjectExtractionTemplate | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

    // Load all data
  const loadData = () => {
    if (!enabled || !projectId || !articleId) {
      setLoading(false);
      return Promise.resolve();
    }

    setLoading(true);
    setError(null);

    const doLoad = async () => {
      // Independent reads in parallel. Article, project, the active
      // extraction template, and the navigation article list don't depend
      // on one another, so awaiting them sequentially only stacked latency.
      // Resolving the template ASAP matters most: the HITL session open (the
      // single slowest critical-path call) is gated on ``template.id``.
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
    };

    return doLoad()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('extraction', 'errors_loadExtractionData');
        console.error('Error loading extraction data:', err);
        setError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  };

    // Load initial data
  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadData());
  }, [loadData]);

    // Refresh function
  const refresh = async () => {
    await loadData();
  };

  return {
    article,
    project,
    template,
    articles,
    loading,
    error,
    refresh,
  };
}
