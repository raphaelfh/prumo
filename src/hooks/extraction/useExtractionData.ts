/**
 * Hook para carregar dados de extração
 * 
 * Centraliza toda a lógica de carregamento de dados do ExtractionFullScreen:
 * - Artigo, projeto, template
 * - Entity types com fields
 * - Instâncias
 * 
 * Reduz complexidade do componente principal seguindo princípio SRP.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { extractionInstanceService } from '@/services/extractionInstanceService';
import type { Article } from '@/types/article';
import type { Project } from '@/types/project';
import type { 
  ProjectExtractionTemplate, 
  ExtractionEntityType, 
  ExtractionField,
  ExtractionInstance 
} from '@/types/extraction';

// Tipo auxiliar para entity types com fields
export interface EntityTypeWithFields extends ExtractionEntityType {
  fields: ExtractionField[];
}

interface UseExtractionDataReturn {
  // Dados carregados
  article: Article | null;
  project: Project | null;
  template: ProjectExtractionTemplate | null;
  entityTypes: EntityTypeWithFields[];
  instances: ExtractionInstance[];
  articles: Article[];
  
  // Estados
  loading: boolean;
  error: string | null;
  
  // Funções
  refresh: () => Promise<void>;
  refreshInstances: () => Promise<void>;
}

interface UseExtractionDataProps {
  projectId: string | undefined;
  articleId: string | undefined;
  enabled?: boolean;
}

/**
 * Hook para carregar todos os dados necessários para extração
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

  // Carregar ou criar instâncias (usando service para inicialização automática)
  const loadOrCreateInstances = useCallback(async (
    templateId: string,
    entityTypesList: EntityTypeWithFields[]
  ) => {
    if (!articleId || !projectId || !templateId) {
      setInstances([]);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      // Delegar para o service (inicialização automática)
      const instances = await extractionInstanceService.initializeArticleInstances(
        articleId,
        projectId,
        { id: templateId } as ProjectExtractionTemplate,
        entityTypesList,
        user.id
      );

      setInstances(instances.map(instance => ({
        ...instance,
        article_id: instance.article_id!,
        metadata: instance.metadata as unknown,
      })));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar instâncias';
      console.error('Erro ao carregar/criar instâncias:', err);
      toast.error(message);
    }
  }, [articleId, projectId]);

  // Carregar instâncias existentes (sem criar)
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
      
      setInstances(refreshedInstances.map(instance => ({
        ...instance,
        article_id: instance.article_id!,
        metadata: instance.metadata as unknown,
      })));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar instâncias';
      console.error('Erro ao carregar instâncias:', err);
      toast.error(message);
    }
  }, [articleId]);

  // Carregar todos os dados
  const loadData = useCallback(async () => {
    if (!enabled || !projectId || !articleId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 1. Carregar artigo
      const { data: articleData, error: articleError } = await supabase
        .from('articles')
        .select('*')
        .eq('id', articleId)
        .single();

      if (articleError) throw articleError;
      setArticle(articleData);

      // 2. Carregar projeto
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;
      setProject(projectData);

      // 3. Carregar template ativo
      const { data: templateData, error: templateError } = await supabase
        .from('project_extraction_templates')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .single();

      if (templateError) throw templateError;
      if (!templateData) throw new Error('Template de extração não configurado');
      
      setTemplate(templateData as ProjectExtractionTemplate);

      // 4. Carregar entity types com fields
      const { data: entityTypesData, error: entityTypesError } = await supabase
        .from('extraction_entity_types')
        .select(`
          *,
          fields:extraction_fields(*)
        `)
        .eq('project_template_id', templateData.id)
        .order('sort_order', { ascending: true });

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

      // 5. Carregar ou criar instâncias (usando service para inicialização automática)
      await loadOrCreateInstances(templateData.id, typesWithFields);

      // 6. Carregar lista de artigos (para navegação)
      const { data: articlesData, error: articlesError } = await supabase
        .from('articles')
        .select('id, title')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (articlesError) throw articlesError;
      setArticles(articlesData as Article[]);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar dados';
      console.error('Erro ao carregar dados de extração:', err);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [projectId, articleId, enabled, loadOrCreateInstances]);

  // Carregar dados iniciais
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Função de refresh
  const refresh = useCallback(async () => {
    await loadData();
  }, [loadData]);

  // Função de refresh apenas de instâncias (sem criar novas)
  const refreshInstances = useCallback(async () => {
    if (template?.id) {
      await loadInstances(template.id);
    }
  }, [template?.id, loadInstances]);

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

