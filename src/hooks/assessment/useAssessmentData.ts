/**
 * Hook para carregar dados de assessment (avaliação de qualidade)
 *
 * Centraliza toda a lógica de carregamento de dados para avaliação:
 * - Artigo, projeto, instrumento
 * - Items de assessment agrupados por domínio
 * - Assessment existente do usuário (se houver)
 *
 * Baseado em useExtractionData.ts (DRY + KISS)
 * Reduz complexidade do componente principal seguindo princípio SRP.
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

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Article } from '@/types/article';
import type { Project } from '@/types/project';
import type {
  AssessmentInstrument,
  AssessmentInstrumentSchemaDomain,
  AssessmentItem,
  Assessment,
} from '@/types/assessment';
import { parseInstrumentSchema } from '@/lib/assessment-utils';
import { getInstrument } from '@/services/projectAssessmentInstrumentService';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/**
 * Domínio com seus items
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
 * Retorno do hook
 */
export interface UseAssessmentDataReturn {
  // Dados carregados
  article: Article | null;
  project: Project | null;
  instrument: AssessmentInstrument | null;
  items: AssessmentItem[];
  domains: DomainWithItems[];
  assessment: Assessment | null;
  articles: AssessmentArticleRef[];

  // Estados
  loading: boolean;
  initialized: boolean;
  error: string | null;

  // Funções
  refresh: () => Promise<void>;
  refreshAssessment: () => Promise<void>;
}

/**
 * Props do hook
 */
export interface UseAssessmentDataProps {
  projectId: string | undefined;
  articleId: string | undefined;
  instrumentId: string | undefined;
  enabled?: boolean;
}

/**
 * Hook para carregar todos os dados necessários para assessment
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
   * Carrega artigo
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
      console.error('❌ [useAssessmentData] Erro ao carregar artigo:', error);
      throw new Error(`Erro ao carregar artigo: ${error.message}`);
    }

    setArticle(data);
  }, [articleId]);

  /**
   * Carrega projeto
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
      console.error('❌ [useAssessmentData] Erro ao carregar projeto:', error);
      throw new Error(`Erro ao carregar projeto: ${error.message}`);
    }

    setProject(data);
  }, [projectId]);

  /**
   * Carrega instrumento com seus items
   */
  const loadInstrument = useCallback(async () => {
    if (!instrumentId) {
      setInstrument(null);
      setItems([]);
      setDomains([]);
      return;
    }

    // Carregar instrumento via API (project_assessment_instruments)
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

    // Mapear items do projeto para o formato AssessmentItem
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

    // Agrupar por dominio
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

    console.log(`📊 [useAssessmentData] Instrumento carregado:`, {
      instrumentId,
      name: projectInstrument.name,
      itemsCount: normalizedItems.length,
      domainsCount: domainsArray.length,
    });
  }, [instrumentId]);

  /**
   * Carrega assessment existente do usuário
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
      console.warn('⚠️ [useAssessmentData] Usuário não autenticado');
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
      console.error('❌ [useAssessmentData] Erro ao carregar assessment:', error);
      // Não lançar erro, apenas logar (assessment pode não existir ainda)
      setAssessment(null);
      return;
    }

    if (data) {
      console.log('✅ [useAssessmentData] Assessment existente carregado:', {
        assessmentId: data.id,
        status: data.status,
        completionPercentage: data.completion_percentage,
        responsesCount: Object.keys(data.responses || {}).length,
      });
    }

    setAssessment(data as Assessment);
  }, [projectId, articleId, instrumentId, authLoading, user]);

  /**
   * Carrega lista de artigos do projeto (para navegação)
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
      console.error('❌ [useAssessmentData] Erro ao carregar lista de artigos:', error);
      setArticles([]);
      return;
    }

    setArticles((data || []) as AssessmentArticleRef[]);
  }, [projectId]);

  /**
   * Carrega todos os dados
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
      console.log('🔄 [useAssessmentData] Iniciando carregamento:', {
        projectId,
        articleId,
        instrumentId,
      });

      // Carregar em paralelo (otimização)
      await Promise.all([
        loadArticle(),
        loadProject(),
        loadInstrument(),
        loadAssessment(),
        loadArticles(),
      ]);

      console.log('✅ [useAssessmentData] Carregamento concluído');
      setInitialized(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      console.error('❌ [useAssessmentData] Erro no carregamento:', err);
      setError(errorMessage);
      toast.error(`Erro ao carregar dados: ${errorMessage}`);
      setInitialized(false);
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId, articleId, instrumentId, loadArticle, loadProject, loadInstrument, loadAssessment, loadArticles]);

  /**
   * Refresh apenas assessment
   */
  const refreshAssessment = useCallback(async () => {
    try {
      await loadAssessment();
    } catch (err) {
      console.error('❌ [useAssessmentData] Erro ao refresh assessment:', err);
    }
  }, [loadAssessment]);

  /**
   * Refresh todos os dados
   */
  const refresh = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

  // Effect para carregar dados quando deps mudarem
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
