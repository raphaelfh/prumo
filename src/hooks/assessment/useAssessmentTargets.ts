/**
 * Hook para buscar targets de assessment
 * 
 * Retorna lista de targets (artigos ou instâncias) dependendo da configuração:
 * - Se scope = 'article': retorna lista de artigos
 * - Se scope = 'extraction_instance': retorna lista de instâncias do entity_type configurado
 * 
 * Inclui paginação para performance com muitos targets.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { 
  AssessmentTarget,
  createArticleTarget,
  createInstanceTarget 
} from '@/types/assessment-target';
import { ProjectAssessmentConfig } from '@/types/assessment-config';
import { ExtractionInstance } from '@/types/extraction';

interface UseAssessmentTargetsOptions {
  page?: number;
  pageSize?: number;
  searchQuery?: string;
}

interface UseAssessmentTargetsReturn {
  targets: AssessmentTarget[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAssessmentTargets(
  projectId: string,
  config: ProjectAssessmentConfig | null,
  options: UseAssessmentTargetsOptions = {}
): UseAssessmentTargetsReturn {
  const { page = 1, pageSize = 50, searchQuery = '' } = options;
  
  const [targets, setTargets] = useState<AssessmentTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    if (projectId && config) {
      loadTargets();
    }
  }, [projectId, config, page, pageSize, searchQuery]);

  const loadTargets = async () => {
    try {
      setLoading(true);
      setError(null);

      if (config?.scope === 'article') {
        await loadArticleTargets();
      } else if (config?.scope === 'extraction_instance') {
        await loadInstanceTargets();
      }
    } catch (err: any) {
      console.error('Error loading assessment targets:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadArticleTargets = async () => {
    const offset = (page - 1) * pageSize;
    
    let query = supabase
      .from('articles')
      .select('id, title', { count: 'exact' })
      .eq('project_id', projectId)
      .order('title', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (searchQuery) {
      query = query.ilike('title', `%${searchQuery}%`);
    }

    const { data, count, error: queryError } = await query;

    if (queryError) throw queryError;

    const articleTargets: AssessmentTarget[] = (data || []).map(article =>
      createArticleTarget(article.id, article.title)
    );

    setTargets(articleTargets);
    setTotalCount(count || 0);
  };

  const loadInstanceTargets = async () => {
    if (!config?.entityTypeId) {
      throw new Error('Entity type não configurado para assessment por instância');
    }

    const offset = (page - 1) * pageSize;

    // Buscar instâncias com joins para article
    let query = supabase
      .from('extraction_instances')
      .select(`
        id,
        label,
        article_id,
        entity_type_id,
        parent_instance_id,
        sort_order,
        metadata,
        articles!inner (
          id,
          title
        )
      `, { count: 'exact' })
      .eq('project_id', projectId)
      .eq('entity_type_id', config.entityTypeId)
      .order('articles(title)', { ascending: true })
      .order('sort_order', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (searchQuery) {
      query = query.or(`label.ilike.%${searchQuery}%,articles.title.ilike.%${searchQuery}%`);
    }

    const { data, count, error: queryError } = await query;

    if (queryError) throw queryError;

    const instanceTargets: AssessmentTarget[] = (data || []).map((item: any) => {
      const instance: ExtractionInstance = {
        id: item.id,
        label: item.label,
        article_id: item.article_id,
        project_id: projectId,
        template_id: '', // não usado aqui
        entity_type_id: item.entity_type_id,
        parent_instance_id: item.parent_instance_id,
        sort_order: item.sort_order,
        metadata: item.metadata,
        created_by: '',
        created_at: '',
        updated_at: ''
      };

      return createInstanceTarget(instance, item.articles.title);
    });

    setTargets(instanceTargets);
    setTotalCount(count || 0);
  };

  const loadMore = async () => {
    // Implementar paginação incremental se necessário
    // Por enquanto, aumentar page e recarregar
  };

  const refresh = useCallback(() => {
    return loadTargets();
  }, [projectId, config, page, pageSize, searchQuery]);

  return {
    targets,
    loading,
    error,
    totalCount,
    hasMore: targets.length < totalCount,
    loadMore,
    refresh
  };
}


