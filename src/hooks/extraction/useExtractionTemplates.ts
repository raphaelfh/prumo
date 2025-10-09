/**
 * Hook para gerenciar templates de extração
 * 
 * Gerencia templates globais e templates de projeto,
 * incluindo clonagem e criação de templates customizados.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { 
  GlobalExtractionTemplate, 
  ProjectExtractionTemplate, 
  ExtractionTemplateOption 
} from '@/types/extraction';

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

  // Carregar dados iniciais
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
        // Carregar templates globais primeiro (sempre)
        const { data: globalData, error: globalError } = await supabase
          .from('extraction_templates_global')
          .select('*')
          .eq('is_global', true)
          .order('name', { ascending: true });

        if (globalError) {
          console.error('Erro ao carregar templates globais:', globalError);
          throw globalError;
        }

        setGlobalTemplates(globalData || []);

        // Carregar templates do projeto
        const { data: projectData, error: projectError } = await supabase
          .from('project_extraction_templates')
          .select('*')
          .eq('project_id', projectId)
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (projectError) {
          console.error('Erro ao carregar templates do projeto:', projectError);
          throw projectError;
        }

        setTemplates(projectData || []);
        
        console.log('Dados carregados com sucesso:', {
          globalTemplates: globalData?.length || 0,
          projectTemplates: projectData?.length || 0
        });
      } catch (err: any) {
        console.error('Erro ao carregar dados:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [projectId]); // Apenas projectId como dependência

  // Clonar template global para o projeto
  const cloneTemplate = useCallback(async (
    globalTemplateId: string, 
    customName?: string
  ): Promise<ProjectExtractionTemplate | null> => {
    try {
      // Verificar se o usuário está autenticado
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      console.log('Usuário autenticado:', user.id);

      // Buscar template global
      const { data: globalTemplate, error: globalError } = await supabase
        .from('extraction_templates_global')
        .select('*')
        .eq('id', globalTemplateId)
        .single();

      if (globalError) throw globalError;
      if (!globalTemplate) throw new Error('Template global não encontrado');

      // Buscar entidades do template global
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

      // Criar entidades e campos para o template do projeto
      for (const entityType of entityTypes || []) {
        // Criar entidade
        const { data: newEntityType, error: entityError } = await supabase
          .from('extraction_entity_types')
          .insert({
            template_id: projectTemplate.id,
            name: entityType.name,
            label: entityType.label,
            description: entityType.description,
            parent_entity_type_id: entityType.parent_entity_type_id,
            cardinality: entityType.cardinality,
            sort_order: entityType.sort_order,
            is_required: entityType.is_required
          })
          .select()
          .single();

        if (entityError) throw entityError;

        // Criar campos da entidade
        for (const field of entityType.extraction_fields || []) {
          const { error: fieldError } = await supabase
            .from('extraction_fields')
            .insert({
              entity_type_id: newEntityType.id,
              name: field.name,
              label: field.label,
              description: field.description,
              field_type: field.field_type,
              is_required: field.is_required,
              validation_schema: field.validation_schema,
              allowed_values: field.allowed_values,
              unit: field.unit,
              sort_order: field.sort_order
            });

          if (fieldError) throw fieldError;
        }
      }

      // Recarregar templates do projeto
      const { data: updatedTemplates, error: reloadError } = await supabase
        .from('project_extraction_templates')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (reloadError) {
        console.error('Erro ao recarregar templates:', reloadError);
      } else {
        setTemplates(updatedTemplates || []);
      }

      toast.success(`Template "${templateName}" clonado com sucesso!`);
      return projectTemplate;

    } catch (err: any) {
      console.error('Erro ao clonar template:', err);
      toast.error(`Erro ao clonar template: ${err.message}`);
      return null;
    }
  }, [projectId, user]);

  // Criar template customizado
  const createCustomTemplate = useCallback(async (
    name: string,
    description: string,
    framework: 'CHARMS' | 'PICOS' | 'CUSTOM'
  ): Promise<ProjectExtractionTemplate | null> => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('Usuário não autenticado');

      const { data: template, error } = await supabase
        .from('project_extraction_templates')
        .insert({
          project_id: projectId,
          name,
          description,
          framework,
          version: '1.0.0',
          schema: {
            description: `Template customizado: ${description}`,
            domains: []
          },
          created_by: user.id
        })
        .select()
        .single();

      if (error) throw error;

      // Recarregar templates
      await projectId();

      toast.success(`Template "${name}" criado com sucesso!`);
      return template;

    } catch (err: any) {
      console.error('Erro ao criar template customizado:', err);
      toast.error(`Erro ao criar template: ${err.message}`);
      return null;
    }
  }, [projectId]);

  // Ativar/desativar template
  const toggleTemplateActive = useCallback(async (templateId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('project_extraction_templates')
        .update({ is_active: isActive })
        .eq('id', templateId);

      if (error) throw error;

      // Recarregar templates
      await projectId();

      toast.success(`Template ${isActive ? 'ativado' : 'desativado'} com sucesso!`);

    } catch (err: any) {
      console.error('Erro ao alterar status do template:', err);
      toast.error(`Erro ao alterar status: ${err.message}`);
    }
  }, [projectId]);

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

  // Verificar se template já foi clonado
  const isTemplateCloned = useCallback((globalTemplateId: string): boolean => {
    return templates.some(template => template.global_template_id === globalTemplateId);
  }, [templates]);

  return {
    // Estado
    templates,
    globalTemplates,
    loading,
    error,

    // Ações
    cloneTemplate,
    createCustomTemplate,
    toggleTemplateActive,
    refreshTemplates: projectId,

    // Utilitários
    getGlobalTemplateOptions,
    isTemplateCloned
  };
}
