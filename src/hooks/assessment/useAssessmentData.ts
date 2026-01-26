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
  AssessmentItem,
  Assessment,
  AssessmentDomain,
} from '@/types/assessment';

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
  articles: Article[];

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
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    // Carregar instrumento
    const { data: instrumentData, error: instrumentError } = await supabase
      .from('assessment_instruments')
      .select('*')
      .eq('id', instrumentId)
      .single();

    if (instrumentError) {
      console.error('❌ [useAssessmentData] Erro ao carregar instrumento:', instrumentError);
      throw new Error(`Erro ao carregar instrumento: ${instrumentError.message}`);
    }

    setInstrument(instrumentData as AssessmentInstrument);

    // Carregar items do instrumento
    const { data: itemsData, error: itemsError } = await supabase
      .from('assessment_items')
      .select('*')
      .eq('instrument_id', instrumentId)
      .order('sort_order', { ascending: true });

    if (itemsError) {
      console.error('❌ [useAssessmentData] Erro ao carregar items:', itemsError);
      throw new Error(`Erro ao carregar items: ${itemsError.message}`);
    }

    setItems(itemsData as AssessmentItem[]);

    // Agrupar por domínio
    const domainMap = new Map<string, DomainWithItems>();

    itemsData.forEach((item: AssessmentItem) => {
      if (!domainMap.has(item.domain)) {
        domainMap.set(item.domain, {
          domain: item.domain,
          label: item.domain, // TODO: Buscar label do assessment_domains se existir
          description: null,
          sort_order: 0,
          items: [],
        });
      }

      domainMap.get(item.domain)!.items.push(item);
    });

    const domainsArray = Array.from(domainMap.values()).sort((a, b) => {
      // Ordenar por número do domínio (Domain 1, Domain 2, etc.)
      const numA = parseInt(a.domain.match(/\d+/)?.[0] || '0');
      const numB = parseInt(b.domain.match(/\d+/)?.[0] || '0');
      return numA - numB;
    });

    setDomains(domainsArray);

    console.log(`📊 [useAssessmentData] Instrumento carregado:`, {
      instrumentId,
      name: instrumentData.name,
      itemsCount: itemsData.length,
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

    const { data: { user } } = await supabase.auth.getUser();
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
  }, [projectId, articleId, instrumentId]);

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
      .select('id, title, authors, year, status')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ [useAssessmentData] Erro ao carregar lista de artigos:', error);
      setArticles([]);
      return;
    }

    setArticles(data as Article[]);
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
