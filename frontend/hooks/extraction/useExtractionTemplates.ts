/**
 * Hook to manage extraction templates
 * 
 * Gerencia templates globais e templates de projeto,
 * incluindo clonagem e criação de templates customizados.
 */

import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/contexts/AuthContext';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {ExtractionTemplateOption, GlobalExtractionTemplate, ProjectExtractionTemplate} from '@/types/extraction';

interface UseExtractionTemplatesProps {
  projectId: string;
}

export function useExtractionTemplates({ projectId }: UseExtractionTemplatesProps) {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<ProjectExtractionTemplate[]>([]);
  const [globalTemplates, setGlobalTemplates] = useState<GlobalExtractionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Funções de carregamento removidas - agora são inline no useEffect

    // Load initial data
  useEffect(() => {
    if (!projectId) {
      setTemplates([]);
      setGlobalTemplates([]);
      setLoading(false);
      return;
    }
    
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
          // Load global and project templates in parallel (reduces total time)
          const [globalResult, projectResult] = await Promise.all([
              supabase
                  .from('extraction_templates_global')
                  .select('*')
                  .eq('is_global', true)
                  .order('name', {ascending: true}),
              supabase
                  .from('project_extraction_templates')
                  .select('*')
                  .eq('project_id', projectId)
                  .eq('is_active', true)
                  .order('created_at', {ascending: false}),
          ]);

          const {data: globalData, error: globalError} = globalResult;
          const {data: projectData, error: projectError} = projectResult;

          if (globalError) {
              console.error('Error loading global templates:', globalError);
              throw globalError;
          }
        if (projectError) {
            console.error('Error loading project templates:', projectError);
          throw projectError;
        }

          setGlobalTemplates(globalData || []);
        setTemplates(projectData || []);
          console.log('Templates loaded:', {
          globalTemplates: globalData?.length || 0,
          projectTemplates: projectData?.length || 0
        });
      } catch (err: any) {
          console.error('Error loading template data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [projectId]); // Apenas projectId como dependência

  // Função para recarregar templates
  const refreshTemplates = useCallback(async (): Promise<ProjectExtractionTemplate[]> => {
    if (!projectId) {
      setTemplates([]);
      return [];
    }

    try {
      const { data: projectData, error: projectError } = await supabase
        .from('project_extraction_templates')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (projectError) {
          console.error('Error refreshing templates:', projectError);
        throw projectError;
      }

      const templatesList = projectData || [];
      setTemplates(templatesList);
      return templatesList;
    } catch (err: any) {
        console.error('Error refreshing templates:', err);
      throw err;
    }
  }, [projectId]);

    // Clone global template to project
  const cloneTemplate = useCallback(async (
    globalTemplateId: string, 
    customName?: string
  ): Promise<ProjectExtractionTemplate | null> => {
    try {
        // Check if user is authenticated
      if (!user) {
          throw new Error(t('common', 'errors_userNotAuthenticated'));
      }

        console.log('User authenticated:', user.id);

        // Fetch global template
      const { data: globalTemplate, error: globalError } = await supabase
        .from('extraction_templates_global')
        .select('*')
        .eq('id', globalTemplateId)
        .single();

      if (globalError) throw globalError;
        if (!globalTemplate) throw new Error(t('common', 'errors_templateNotFound'));

        // Fetch entities from global template
      const { data: entityTypes, error: entitiesError } = await supabase
        .from('extraction_entity_types')
        .select(`
          *,
          extraction_fields (*)
        `)
        .eq('template_id', globalTemplateId)
        .order('sort_order', { ascending: true });

      if (entitiesError) throw entitiesError;

      // Usuário já verificado acima

      // Criar template do projeto
      const templateName = customName || `${globalTemplate.name} - Projeto`;
      const { data: projectTemplate, error: templateError } = await supabase
        .from('project_extraction_templates')
        .insert({
          project_id: projectId,
          global_template_id: globalTemplateId,
          name: templateName,
          description: globalTemplate.description,
          framework: globalTemplate.framework,
          version: globalTemplate.version,
          schema: globalTemplate.schema,
          created_by: user.id
        })
        .select()
        .single();

      if (templateError) throw templateError;

        // Create entities and fields for project template
      // Clonar entity_types (2 passadas para preservar hierarquia)
      const entityTypeMapping: Record<string, string> = {};

      // Passada 1: Criar todos os entity types sem parent (temporariamente)
      for (const globalEntity of entityTypes || []) {
        const { data: newEntity, error: insertError } = await supabase
          .from('extraction_entity_types')
          .insert({
            project_template_id: projectTemplate.id,
            name: globalEntity.name,
            label: globalEntity.label,
            description: globalEntity.description,
            cardinality: globalEntity.cardinality,
            sort_order: globalEntity.sort_order,
            is_required: globalEntity.is_required
            // parent_entity_type_id: null por enquanto (será atualizado na passada 2)
          })
          .select()
          .single();

        if (insertError) throw insertError;

        entityTypeMapping[globalEntity.id] = newEntity.id;
      }

        // Pass 2: Update parent references with mapped IDs
      for (const globalEntity of entityTypes || []) {
        if (globalEntity.parent_entity_type_id) {
          const newEntityId = entityTypeMapping[globalEntity.id];
          const newParentId = entityTypeMapping[globalEntity.parent_entity_type_id];
          
          if (newEntityId && newParentId) {
            const { error: updateError } = await supabase
              .from('extraction_entity_types')
              .update({ parent_entity_type_id: newParentId })
              .eq('id', newEntityId);

            if (updateError) throw updateError;
          }
        }
      }

      // Passada 3: Clonar fields
      for (const globalEntity of entityTypes || []) {
        const newEntityTypeId = entityTypeMapping[globalEntity.id];
        if (!newEntityTypeId) continue;

        for (const field of globalEntity.extraction_fields || []) {
          const { error: fieldError } = await supabase
            .from('extraction_fields')
            .insert({
              entity_type_id: newEntityTypeId,
              name: field.name,
              label: field.label,
              description: field.description,
              field_type: field.field_type,
              is_required: field.is_required,
              validation_schema: field.validation_schema,
              allowed_values: field.allowed_values,
              unit: field.unit,
              allowed_units: field.allowed_units,
              sort_order: field.sort_order,
              llm_description: field.llm_description,
              allow_other: field.allow_other ?? false,
              other_label: field.other_label ?? 'Outro (especificar)',
              other_placeholder: field.other_placeholder
            });

          if (fieldError) throw fieldError;
        }
      }

      // Recarregar templates do projeto
      await refreshTemplates();

        toast.success(t('extraction', 'templateClonedSuccess').replace('{{name}}', templateName));
      return projectTemplate;

    } catch (err: any) {
        console.error('Error cloning template:', err);
        toast.error(`${t('extraction', 'errors_cloneTemplate')}: ${err.message}`);
      return null;
    }
  }, [projectId, user, refreshTemplates]);

  // Criar template customizado
  const createCustomTemplate = useCallback(async (
    name: string,
    description: string,
    framework: 'CHARMS' | 'PICOS' | 'CUSTOM'
  ): Promise<ProjectExtractionTemplate | null> => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) throw new Error(t('common', 'errors_userNotAuthenticated'));

      const { data: template, error } = await supabase
        .from('project_extraction_templates')
        .insert({
          project_id: projectId,
          name,
          description,
          framework,
          version: '1.0.0',
          schema: {
              description: `Custom template: ${description}`,
            domains: []
          },
          created_by: user.id
        })
        .select()
        .single();

      if (error) throw error;

      // Recarregar templates
      await refreshTemplates();

        toast.success(t('extraction', 'templateCreatedSuccess').replace('{{name}}', name));
      return template;

    } catch (err: any) {
        console.error('Error creating custom template:', err);
        toast.error(`${t('extraction', 'errors_createTemplate')}: ${err.message}`);
      return null;
    }
  }, [projectId, refreshTemplates]);

  // Ativar/desativar template
  const toggleTemplateActive = useCallback(async (templateId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('project_extraction_templates')
        .update({ is_active: isActive })
        .eq('id', templateId);

      if (error) throw error;

      // Recarregar templates
      await refreshTemplates();

        toast.success(t('extraction', isActive ? 'templateActivatedSuccess' : 'templateDeactivatedSuccess'));

    } catch (err: any) {
        console.error('Error updating template status:', err);
        toast.error(`${t('extraction', 'errors_updateTemplateStatus')}: ${err.message}`);
    }
  }, [refreshTemplates]);

  // Obter opções de templates globais para clonagem
  const getGlobalTemplateOptions = useCallback((): ExtractionTemplateOption[] => {
    return globalTemplates.map(template => ({
      id: template.id,
      name: template.name,
      description: template.description || '',
      framework: template.framework,
      version: template.version
    }));
  }, [globalTemplates]);

    // Check if template was already cloned
  const isTemplateCloned = useCallback((globalTemplateId: string): boolean => {
    return templates.some(template => template.global_template_id === globalTemplateId);
  }, [templates]);

  return {
    // Estado
    templates,
    globalTemplates,
    loading,
    error,

      // Actions
    cloneTemplate,
    createCustomTemplate,
    toggleTemplateActive,
    refreshTemplates,

    // Utilitários
    getGlobalTemplateOptions,
    isTemplateCloned
  };
}
