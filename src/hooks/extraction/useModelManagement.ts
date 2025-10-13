/**
 * Hook para gerenciamento de modelos de predição hierárquicos
 * 
 * Responsável por:
 * - Carregar modelos existentes (instances de prediction_models)
 * - Criar novo modelo (com sub-seções automaticamente)
 * - Remover modelo (com todas as sub-seções e dados)
 * - Calcular progresso por modelo
 * - Gerenciar modelo ativo
 * 
 * REFATORADO (Fase 2): Usa extractionInstanceService e função SQL otimizada
 * para calcular progresso (1 query para todos os modelos).
 * 
 * @module hooks/extraction/useModelManagement
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { extractionInstanceService } from '@/services/extractionInstanceService';
import type { Model } from '@/components/extraction/hierarchy/ModelSelector';

// =================== INTERFACES ===================

interface UseModelManagementProps {
  projectId: string;
  articleId: string;
  templateId: string;
  modelParentEntityTypeId: string | null; // ID do entity_type "prediction_models"
  enabled?: boolean;
}

interface CreateModelResult {
  model: Model;
  childInstances: any[];
}

interface UseModelManagementReturn {
  models: Model[];
  activeModelId: string | null;
  setActiveModelId: (id: string | null) => void;
  loading: boolean;
  error: string | null;
  createModel: (modelName: string, modellingMethod: string) => Promise<CreateModelResult | null>;
  removeModel: (instanceId: string) => Promise<void>;
  refreshModels: () => Promise<void>;
  getModelProgress: (instanceId: string) => Promise<Model['progress']>;
}

// =================== HOOK ===================

export function useModelManagement({
  projectId,
  articleId,
  templateId,
  modelParentEntityTypeId,
  enabled = true
}: UseModelManagementProps): UseModelManagementReturn {
  const { user } = useAuth();
  const [models, setModels] = useState<Model[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carregar modelos existentes
  const loadModels = useCallback(async () => {
    if (!enabled || !modelParentEntityTypeId) {
      console.log('⏭️ loadModels: Skipped (enabled:', enabled, ', modelParentEntityTypeId:', modelParentEntityTypeId, ')');
      setModels([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      console.log('📥 Carregando modelos para artigo:', articleId, ', entity_type:', modelParentEntityTypeId);

      // Buscar instances de prediction_models para este artigo
      const { data: instances, error: instancesError } = await supabase
        .from('extraction_instances')
        .select('id, label, sort_order, created_at')
        .eq('article_id', articleId)
        .eq('entity_type_id', modelParentEntityTypeId)
        .order('sort_order', { ascending: true });

      if (instancesError) throw instancesError;

      console.log(`✅ Encontradas ${instances?.length || 0} instances de modelos:`, instances?.map(i => i.label));

      if (!instances || instances.length === 0) {
        setModels([]);
        setActiveModelId(null);
        return;
      }

      // Para cada modelo, calcular progresso
      const modelsWithProgress = await Promise.all(
        instances.map(async (instance) => {
          const progress = await getModelProgress(instance.id);
          
          return {
            instanceId: instance.id,
            modelName: instance.label,
            progress
          };
        })
      );

      setModels(modelsWithProgress);

      // Se não tem modelo ativo, selecionar o primeiro
      if (!activeModelId && modelsWithProgress.length > 0) {
        setActiveModelId(modelsWithProgress[0].instanceId);
      }

    } catch (err: any) {
      console.error('Erro ao carregar modelos:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled, modelParentEntityTypeId, articleId, activeModelId]);

  // Calcular progresso de um modelo (usando função SQL otimizada)
  const getModelProgress = useCallback(async (instanceId: string): Promise<Model['progress']> => {
    try {
      // Usar função SQL otimizada (1 query)
      const { data, error } = await supabase
        .rpc('calculate_model_progress', {
          p_article_id: articleId,
          p_model_id: instanceId
        });

      if (error) {
        console.warn('Erro ao calcular progresso (fallback para 0):', error);
        return { completed: 0, total: 0, percentage: 0 };
      }

      if (!data || data.length === 0) {
        return { completed: 0, total: 0, percentage: 0 };
      }

      const result = data[0];
      return {
        completed: result.completed_fields || 0,
        total: result.total_fields || 0,
        percentage: result.percentage || 0
      };

    } catch (err) {
      console.error('Erro ao calcular progresso do modelo:', err);
      return { completed: 0, total: 0, percentage: 0 };
    }
  }, [articleId]);

  // Função para gerar nome único
  const generateUniqueModelName = useCallback(async (
    baseName: string,
    maxAttempts: number = 10
  ): Promise<string> => {
    let uniqueName = baseName;
    let attempt = 1;

    while (attempt <= maxAttempts) {
      // Verificar se o nome já existe no banco
      const { data: existingInstance, error: checkError } = await supabase
        .from('extraction_instances')
        .select('id')
        .eq('article_id', articleId)
        .eq('entity_type_id', modelParentEntityTypeId!)
        .eq('label', uniqueName)
        .limit(1);

      if (checkError) throw checkError;

      // Se não existe, retornar o nome
      if (!existingInstance || existingInstance.length === 0) {
        return uniqueName;
      }

      // Se existe, tentar com sufixo numérico
      attempt++;
      uniqueName = `${baseName} (${attempt})`;
    }

    // Se esgotou as tentativas, usar timestamp
    return `${baseName} (${Date.now()})`;
  }, [articleId, modelParentEntityTypeId]);

  // Criar novo modelo (usando service - simplificado)
  const createModel = useCallback(async (
    modelName: string,
    modellingMethod: string
  ): Promise<CreateModelResult | null> => {
    if (!user || !modelParentEntityTypeId) {
      toast.error('Usuário não autenticado ou template inválido');
      return null;
    }

    try {
      console.log('🆕 Criando novo modelo:', modelName);

      // 1. Buscar parent entity type
      const { data: parentEntityType, error: etError } = await supabase
        .from('extraction_entity_types')
        .select('*')
        .eq('id', modelParentEntityTypeId)
        .single();

      if (etError || !parentEntityType) {
        throw new Error('Entity type de modelo não encontrado');
      }

      // 2. Buscar child entity types
      const { data: childEntityTypes, error: childTypesError } = await supabase
        .from('extraction_entity_types')
        .select('*')
        .eq('parent_entity_type_id', modelParentEntityTypeId)
        .order('sort_order');

      if (childTypesError) throw childTypesError;

      // 3. Delegar criação de hierarquia para o service
      const result = await extractionInstanceService.createHierarchy({
        projectId,
        articleId,
        templateId,
        parentEntityType,
        childEntityTypes: childEntityTypes || [],
        label: modelName.trim(),
        metadata: {},
        userId: user.id
      });

      // 4. Se modellingMethod foi fornecido, salvar valor
      if (modellingMethod) {
        const { data: modellingMethodField } = await supabase
          .from('extraction_fields')
          .select('id')
          .eq('entity_type_id', modelParentEntityTypeId)
          .eq('name', 'modelling_method')
          .single();

        if (modellingMethodField) {
          await supabase.from('extracted_values').insert({
            project_id: projectId,
            article_id: articleId,
            instance_id: result.parent.id,
            field_id: modellingMethodField.id,
            value: { value: modellingMethod },
            source: 'human',
            reviewer_id: user.id
          });
        }
      }

      // 5. Criar objeto Model
      const newModel: Model = {
        instanceId: result.parent.id,
        modelName: result.parent.label,
        progress: { completed: 0, total: 0, percentage: 0 }
      };

      // 6. Atualizar estado
      setModels(prev => [...prev, newModel]);
      setActiveModelId(newModel.instanceId);

      toast.success(`Modelo "${result.parent.label}" criado com sucesso!`);
      
      console.log(`✅ Hierarquia criada: 1 parent + ${result.children.length} children`);

      // Retornar modelo E child instances criadas
      return {
        model: newModel,
        childInstances: result.children
      };

    } catch (err: any) {
      console.error('Erro ao criar modelo:', err);
      toast.error(`Erro ao criar modelo: ${err.message}`);
      return null;
    }
  }, [user, modelParentEntityTypeId, projectId, articleId, templateId]);

  // Remover modelo (usando service - simplificado)
  const removeModel = useCallback(async (instanceId: string): Promise<void> => {
    try {
      console.log('🗑️ Removendo modelo:', instanceId);
      
      const removedModel = models.find(m => m.instanceId === instanceId);
      console.log('📝 Modelo a ser removido:', removedModel?.modelName);

      // Delegar para o service (CASCADE automático)
      await extractionInstanceService.removeInstance(instanceId);

      // Atualizar estado local
      setModels(prev => prev.filter(m => m.instanceId !== instanceId));

      // Se era o modelo ativo, limpar activeModelId
      if (activeModelId === instanceId) {
        setActiveModelId(null);
      }

      toast.success(`Modelo "${removedModel?.modelName}" removido com sucesso`);

    } catch (err: any) {
      console.error('❌ Erro ao remover modelo:', err);
      toast.error(`Erro ao remover modelo: ${err.message}`);
      // ✅ MELHORIA: Re-throw erro em vez de retornar boolean
      // Isso permite tratamento consistente de erro em toda a aplicação
      throw err;
    }
  }, [models, activeModelId]);

  // Refresh models
  const refreshModels = useCallback(() => {
    return loadModels();
  }, [loadModels]);

  // Carregar modelos ao montar
  useEffect(() => {
    if (enabled && projectId && articleId && templateId && modelParentEntityTypeId) {
      loadModels();
    }
  }, [enabled, projectId, articleId, templateId, modelParentEntityTypeId, loadModels]);

  return {
    models,
    activeModelId,
    setActiveModelId,
    loading,
    error,
    createModel,
    removeModel,
    refreshModels,
    getModelProgress
  };
}

