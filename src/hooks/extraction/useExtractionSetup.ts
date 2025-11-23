/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Hook para inicialização de extração de dados
 * 
 * Responsável APENAS por inicializar extração (criar instâncias automáticas).
 * Cálculo de progresso foi movido para useExtractionProgressCalc (SRP).
 * 
 * REFATORADO (Fase 5): Separado de cálculo de progresso para seguir SRP.
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

      // 2. Buscar entity types do template do projeto para criar instâncias
      const { data: entityTypes, error: entityTypesError } = await supabase
        .from('extraction_entity_types')
        .select('*')
        .eq('project_template_id', templateId)
        .order('sort_order', { ascending: true });

      if (entityTypesError) {
        console.error('Erro ao buscar entity types:', entityTypesError);
        throw entityTypesError;
      }

      if (!entityTypes || entityTypes.length === 0) {
        const error = 'Nenhuma configuração de template encontrada. Configure o template primeiro.';
        toast.error(error);
        return { success: false, instancesCreated: 0, error };
      }

      console.log(`Criando ${entityTypes.length} instâncias para o artigo`);

      // 3. Criar instâncias baseadas nos entity types
      const instances = entityTypes.map((entityType, index) => ({
        project_id: projectId,
        article_id: articleId,
        template_id: templateId,
        entity_type_id: entityType.id,
        label: entityType.label,
        sort_order: entityType.sort_order,
        status: 'pending',
        metadata: {},
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

  // NOTA: Cálculo de progresso foi movido para useExtractionProgressCalc
  // para seguir SRP (Single Responsibility Principle)

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
    isExtractionInitialized,
    loading,
    error,
  };
}

