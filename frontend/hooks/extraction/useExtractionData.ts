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
    ExtractionEntityType,
    ExtractionField,
    ExtractionInstance,
    ProjectExtractionTemplate
} from '@/types/extraction';

// Tipo auxiliar para entity types com fields
export interface EntityTypeWithFields extends ExtractionEntityType {
  fields: ExtractionField[];
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

    // Load or create instances (using service for auto-init)
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
          throw new Error(t('common', 'errors_userNotAuthenticated'));
      }

        // Delegate to service (auto-init)
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
        const message = err instanceof Error ? err.message : t('extraction', 'errors_loadInstances');
        console.error('Error loading/creating instances:', err);
      toast.error(message);
    }
  }, [articleId, projectId]);

    // Load existing instances (without creating)
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

        // 1. Load article
      const { data: articleData, error: articleError } = await supabase
        .from('articles')
        .select('*')
        .eq('id', articleId)
        .single();

      if (articleError) throw articleError;
      setArticle(articleData);

        // 2. Load project
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;
      setProject(projectData);

        // 3. Load active template
      const { data: templateData, error: templateError } = await supabase
        .from('project_extraction_templates')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .single();

      if (templateError) throw templateError;
        if (!templateData) throw new Error(t('common', 'errors_templateNotFound'));
      
      setTemplate(templateData as ProjectExtractionTemplate);

        // 4. Load entity types with fields
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

        // 5. Load or create instances (using service for auto-init)
      await loadOrCreateInstances(templateData.id, typesWithFields);

        // 6. Load article list (for navigation)
      const { data: articlesData, error: articlesError } = await supabase
        .from('articles')
        .select('id, title')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (articlesError) throw articlesError;
      setArticles(articlesData as Article[]);

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('extraction', 'errors_loadExtractionData');
        console.error('Error loading extraction data:', err);
      setError(message);
      toast.error(message);
      setLoading(false);
    } finally {
      setLoading(false);
    }
  }, [projectId, articleId, enabled, loadOrCreateInstances]);

    // Load initial data
  useEffect(() => {
    loadData();
  }, [loadData]);

    // Refresh function
  const refresh = useCallback(async () => {
    await loadData();
  }, [loadData]);

    // Refresh instances only (no new creation)
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

