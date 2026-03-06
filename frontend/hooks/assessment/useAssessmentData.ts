/**
 * Hook to load assessment data (quality assessment)
 *
 * Centralizes all data loading logic for assessment:
 * - Article, project, instrument
 * - Assessment items grouped by domain
 * - Existing user assessment (if any)
 *
 * Based on useExtractionData.ts (DRY + KISS)
 * Reduces main component complexity following SRP.
 *
 * @example
 * ```typescript
 * const {
 *   article,
 *   instrument,
 *   items,
 *   assessment,
 *   loading,
 *   refresh
 * } = useAssessmentData({
 *   projectId,
 *   articleId,
 *   instrumentId,
 * });
 * ```
 */

import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import type {Article} from '@/types/article';
import type {Project} from '@/types/project';
import type {
    Assessment,
    AssessmentInstrument,
    AssessmentInstrumentSchemaDomain,
    AssessmentItem,
} from '@/types/assessment';
import {parseInstrumentSchema} from '@/lib/assessment-utils';
import {getInstrument} from '@/services/projectAssessmentInstrumentService';
import {useCurrentUser} from '@/hooks/useCurrentUser';

/**
 * Domain with its items
 */
export interface DomainWithItems {
  domain: string;
  label: string;
  description: string | null;
  sort_order: number;
  items: AssessmentItem[];
}

export interface AssessmentArticleRef {
  id: string;
  title: string;
}

/**
 * Hook return type
 */
export interface UseAssessmentDataReturn {
    // Loaded data
  article: Article | null;
  project: Project | null;
  instrument: AssessmentInstrument | null;
  items: AssessmentItem[];
  domains: DomainWithItems[];
  assessment: Assessment | null;
  articles: AssessmentArticleRef[];

    // State
  loading: boolean;
  initialized: boolean;
  error: string | null;

    // Functions
  refresh: () => Promise<void>;
  refreshAssessment: () => Promise<void>;
}

/**
 * Hook props
 */
export interface UseAssessmentDataProps {
  projectId: string | undefined;
  articleId: string | undefined;
  instrumentId: string | undefined;
  enabled?: boolean;
}

/**
 * Hook to load all data required for assessment
 */
export function useAssessmentData({
  projectId,
  articleId,
  instrumentId,
  enabled = true,
}: UseAssessmentDataProps): UseAssessmentDataReturn {
  // Estados
  const [article, setArticle] = useState<Article | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [instrument, setInstrument] = useState<AssessmentInstrument | null>(null);
  const [items, setItems] = useState<AssessmentItem[]>([]);
  const [domains, setDomains] = useState<DomainWithItems[]>([]);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [articles, setArticles] = useState<AssessmentArticleRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, loading: authLoading } = useCurrentUser();

  /**
   * Load article
   */
  const loadArticle = useCallback(async () => {
    if (!articleId) {
      setArticle(null);
      return;
    }

    const { data, error } = await supabase
      .from('articles')
      .select('*')
      .eq('id', articleId)
      .single();

    if (error) {
        console.error('[useAssessmentData] Error loading article:', error);
        throw new Error(`${t('articles', 'errorLoadArticle')}: ${error.message}`);
    }

    setArticle(data);
  }, [articleId]);

  /**
   * Load project
   */
  const loadProject = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      return;
    }

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (error) {
        console.error('[useAssessmentData] Error loading project:', error);
        throw new Error(`${t('pages', 'projectViewErrorLoading')}: ${error.message}`);
    }

    setProject(data);
  }, [projectId]);

  /**
   * Load instrument with its items
   */
  const loadInstrument = useCallback(async () => {
    if (!instrumentId) {
      setInstrument(null);
      setItems([]);
      setDomains([]);
      return;
    }

      // Load instrument via API (project_assessment_instruments)
    const projectInstrument = await getInstrument(instrumentId);

    const instrumentSchema = parseInstrumentSchema(projectInstrument.schema);
    setInstrument({
      id: projectInstrument.id,
      name: projectInstrument.name,
      description: projectInstrument.description,
      tool_type: projectInstrument.toolType,
      version: projectInstrument.version,
      schema: instrumentSchema,
    } as AssessmentInstrument);

      // Map project items to AssessmentItem format
    const normalizedItems: AssessmentItem[] = (projectInstrument.items || [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({
        id: item.id,
        instrument_id: projectInstrument.id,
        domain: item.domain,
        item_code: item.itemCode,
        question: item.question,
        guidance: item.description,
        allowed_levels: item.allowedLevels,
        sort_order: item.sortOrder,
        is_required: item.required,
        llm_description: item.llmPrompt,
        created_at: item.createdAt,
      }));
    setItems(normalizedItems);

      // Group by domain
    const domainMap = new Map<string, DomainWithItems>();
    const domainMetadata = new Map<string, AssessmentInstrumentSchemaDomain>();

    instrumentSchema?.domains?.forEach((domain) => {
      domainMetadata.set(domain.code, domain);
    });

    normalizedItems.forEach((item) => {
      if (!domainMap.has(item.domain)) {
        const meta = domainMetadata.get(item.domain);
        domainMap.set(item.domain, {
          domain: item.domain,
          label: meta?.name || item.domain,
          description: meta?.description ?? null,
          sort_order: meta?.sort_order ?? 0,
          items: [],
        });
      }

      domainMap.get(item.domain)!.items.push(item);
    });

    const domainsArray = Array.from(domainMap.values()).sort((a, b) => {
      if (a.sort_order !== b.sort_order) {
        return a.sort_order - b.sort_order;
      }
      const numA = parseInt(a.domain.match(/\d+/)?.[0] || '0');
      const numB = parseInt(b.domain.match(/\d+/)?.[0] || '0');
      return numA - numB;
    });

    setDomains(domainsArray);

      console.log('[useAssessmentData] Instrument loaded:', {
      instrumentId,
      name: projectInstrument.name,
      itemsCount: normalizedItems.length,
      domainsCount: domainsArray.length,
    });
  }, [instrumentId]);

  /**
   * Load existing user assessment
   */
  const loadAssessment = useCallback(async () => {
    if (!projectId || !articleId || !instrumentId) {
      setAssessment(null);
      return;
    }

    if (authLoading) {
      return;
    }
    if (!user) {
        console.warn('[useAssessmentData] User not authenticated');
      setAssessment(null);
      return;
    }

    const { data, error } = await supabase
      .from('assessments')
      .select('*')
      .eq('project_id', projectId)
      .eq('article_id', articleId)
      .eq('user_id', user.id)
      .eq('instrument_id', instrumentId)
      .eq('is_current_version', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
        console.error('[useAssessmentData] Error loading assessment:', error);
        // Do not throw; assessment may not exist yet
      setAssessment(null);
      return;
    }

    if (data) {
        console.log('[useAssessmentData] Existing assessment loaded:', {
        assessmentId: data.id,
        status: data.status,
        completionPercentage: data.completion_percentage,
        responsesCount: Object.keys(data.responses || {}).length,
      });
    }

    setAssessment(data as Assessment);
  }, [projectId, articleId, instrumentId, authLoading, user]);

  /**
   * Load project article list (for navigation)
   */
  const loadArticles = useCallback(async () => {
    if (!projectId) {
      setArticles([]);
      return;
    }

    const { data, error } = await supabase
      .from('articles')
      .select('id, title')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
        console.error('[useAssessmentData] Error loading article list:', error);
      setArticles([]);
      return;
    }

    setArticles((data || []) as AssessmentArticleRef[]);
  }, [projectId]);

  /**
   * Load all data
   */
  const loadAll = useCallback(async () => {
    if (!enabled || !projectId || !articleId || !instrumentId) {
      setLoading(false);
      setInitialized(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
        console.log('[useAssessmentData] Starting load:', {
        projectId,
        articleId,
        instrumentId,
      });

        // Load in parallel (optimization)
      await Promise.all([
        loadArticle(),
        loadProject(),
        loadInstrument(),
        loadAssessment(),
        loadArticles(),
      ]);

        console.log('[useAssessmentData] Load completed');
      setInitialized(true);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : t('common', 'errors_unknownError');
        console.error('[useAssessmentData] Load error:', err);
      setError(errorMessage);
        toast.error(`${t('assessment', 'errors_loadData')}: ${errorMessage}`);
      setInitialized(false);
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId, articleId, instrumentId, loadArticle, loadProject, loadInstrument, loadAssessment, loadArticles]);

  /**
   * Refresh assessment only
   */
  const refreshAssessment = useCallback(async () => {
    try {
      await loadAssessment();
    } catch (err) {
        console.error('[useAssessmentData] Error refreshing assessment:', err);
    }
  }, [loadAssessment]);

  /**
   * Refresh all data
   */
  const refresh = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

    // Load data when deps change
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return {
    article,
    project,
    instrument,
    items,
    domains,
    assessment,
    articles,
    loading,
    initialized,
    error,
    refresh,
    refreshAssessment,
  };
}
