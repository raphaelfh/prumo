/**
 * Hook para configuração e inicialização de extração de dados
 * 
 * Responsável por:
 * - Inicializar extração para um artigo (criar instâncias automáticas)
 * - Calcular progresso de extração
 * - Gerenciar status de extração
 */

import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface ExtractionProgress {
  totalRequiredFields: number;
  completedRequiredFields: number;
  totalOptionalFields: number;
  completedOptionalFields: number;
  progressPercentage: number;
}

export interface ExtractionSetupResult {
  success: boolean;
  instancesCreated: number;
  error?: string;
}

export function useExtractionSetup() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Inicializa a extração para um artigo específico
   * Copia as instâncias template configuradas para o artigo
   */
  const initializeArticleExtraction = useCallback(async (
    articleId: string,
    projectId: string,
    templateId: string
  ): Promise<ExtractionSetupResult> => {
    if (!user) {
      const error = 'Usuário não autenticado';
      toast.error(error);
      return { success: false, instancesCreated: 0, error };
    }

    setLoading(true);
    setError(null);

    try {
      console.log('Iniciando extração para artigo:', { articleId, projectId, templateId });

      // 1. Verificar se já existem instâncias para este artigo
      const { data: existingInstances, error: checkError } = await supabase
        .from('extraction_instances')
        .select('id')
        .eq('article_id', articleId)
        .eq('template_id', templateId)
        .eq('is_template', false)
        .limit(1);

      if (checkError) {
        console.error('Erro ao verificar instâncias existentes:', checkError);
        throw checkError;
      }

      if (existingInstances && existingInstances.length > 0) {
        const message = 'Extração já iniciada para este artigo';
        toast.info(message);
        return { success: true, instancesCreated: 0, error: message };
      }

      // 2. Buscar instâncias template do projeto
      const { data: templateInstances, error: templateError } = await supabase
        .from('extraction_instances')
        .select('*')
        .eq('project_id', projectId)
        .eq('template_id', templateId)
        .eq('is_template', true)
        .order('sort_order', { ascending: true });

      if (templateError) {
        console.error('Erro ao buscar instâncias template:', templateError);
        throw templateError;
      }

      if (!templateInstances || templateInstances.length === 0) {
        const error = 'Nenhuma configuração de template encontrada. Configure o template primeiro.';
        toast.error(error);
        return { success: false, instancesCreated: 0, error };
      }

      console.log(`Copiando ${templateInstances.length} instâncias template para o artigo`);

      // 3. Copiar instâncias template para o artigo
      const instances = templateInstances.map((templateInstance) => ({
        project_id: projectId,
        article_id: articleId,
        template_id: templateId,
        entity_type_id: templateInstance.entity_type_id,
        label: templateInstance.label,
        sort_order: templateInstance.sort_order,
        status: 'pending',
        is_template: false,
        metadata: templateInstance.metadata || {},
        created_by: user.id
      }));

      // 4. Inserir todas as instâncias de uma vez
      const { data: createdInstances, error: insertError } = await supabase
        .from('extraction_instances')
        .insert(instances)
        .select();

      if (insertError) {
        console.error('Erro ao criar instâncias:', insertError);
        throw insertError;
      }

      const instancesCreated = createdInstances?.length || 0;
      console.log(`${instancesCreated} instâncias criadas com sucesso`);

      toast.success(`Extração iniciada! ${instancesCreated} seções criadas.`);

      return {
        success: true,
        instancesCreated,
      };

    } catch (err: any) {
      const errorMessage = err.message || 'Erro ao inicializar extração';
      console.error('Erro ao inicializar extração:', err);
      setError(errorMessage);
      toast.error(`Erro: ${errorMessage}`);
      
      return {
        success: false,
        instancesCreated: 0,
        error: errorMessage,
      };
    } finally {
      setLoading(false);
    }
  }, [user]);

  /**
   * Calcula o progresso de extração para um artigo
   */
  const calculateProgress = useCallback(async (
    articleId: string,
    templateId: string
  ): Promise<ExtractionProgress | null> => {
    try {
      const { data, error } = await supabase
        .rpc('calculate_extraction_progress', {
          p_article_id: articleId,
          p_template_id: templateId
        });

      if (error) {
        console.error('Erro ao calcular progresso:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        return null;
      }

      const result = data[0];
      return {
        totalRequiredFields: result.total_required_fields || 0,
        completedRequiredFields: result.completed_required_fields || 0,
        totalOptionalFields: result.total_optional_fields || 0,
        completedOptionalFields: result.completed_optional_fields || 0,
        progressPercentage: result.progress_percentage || 0,
      };

    } catch (err: any) {
      console.error('Erro ao calcular progresso:', err);
      return null;
    }
  }, []);

  /**
   * Verifica se a extração foi iniciada para um artigo
   */
  const isExtractionInitialized = useCallback(async (
    articleId: string,
    templateId: string
  ): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('extraction_instances')
        .select('id')
        .eq('article_id', articleId)
        .eq('template_id', templateId)
        .eq('is_template', false)
        .limit(1);

      if (error) {
        console.error('Erro ao verificar inicialização:', error);
        return false;
      }

      const initialized = data && data.length > 0;
      console.log(`Artigo ${articleId} inicializado:`, initialized);
      return initialized;
    } catch (err) {
      console.error('Erro ao verificar inicialização:', err);
      return false;
    }
  }, []);

  return {
    initializeArticleExtraction,
    calculateProgress,
    isExtractionInitialized,
    loading,
    error,
  };
}

