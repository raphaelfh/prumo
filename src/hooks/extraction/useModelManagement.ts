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
 * @module hooks/extraction/useModelManagement
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
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
  removeModel: (instanceId: string) => Promise<boolean>;
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

  // Calcular progresso de um modelo
  const getModelProgress = useCallback(async (instanceId: string): Promise<Model['progress']> => {
    try {
      // Buscar child entity types do prediction_models
      const { data: childEntityTypes, error: etError } = await supabase
        .from('extraction_entity_types')
        .select('id')
        .eq('parent_entity_type_id', modelParentEntityTypeId);

      if (etError) throw etError;

      if (!childEntityTypes || childEntityTypes.length === 0) {
        return { completed: 0, total: 0, percentage: 0 };
      }

      const childEntityTypeIds = childEntityTypes.map(et => et.id);

      // Buscar child instances deste modelo
      const { data: childInstances, error: childError } = await supabase
        .from('extraction_instances')
        .select('id, entity_type_id')
        .eq('article_id', articleId)
        .eq('parent_instance_id', instanceId)
        .in('entity_type_id', childEntityTypeIds);

      if (childError) throw childError;

      if (!childInstances || childInstances.length === 0) {
        return { completed: 0, total: 0, percentage: 0 };
      }

      const childInstanceIds = childInstances.map(ci => ci.id);

      // Buscar todos os fields dos child entity types
      const { data: fields, error: fieldsError } = await supabase
        .from('extraction_fields')
        .select('id, is_required, entity_type_id')
        .in('entity_type_id', childEntityTypeIds);

      if (fieldsError) throw fieldsError;

      const totalFields = fields?.length || 0;

      if (totalFields === 0) {
        return { completed: 0, total: 0, percentage: 0 };
      }

      // Buscar valores extraídos das child instances
      const { data: values, error: valuesError } = await supabase
        .from('extracted_values')
        .select('field_id, value')
        .in('instance_id', childInstanceIds);

      if (valuesError) throw valuesError;

      // Contar campos preenchidos
      const filledFieldIds = new Set(
        (values || [])
          .filter(v => {
            const val = v.value?.value ?? v.value;
            return val !== null && val !== undefined && val !== '';
          })
          .map(v => v.field_id)
      );

      const completedFields = filledFieldIds.size;
      const percentage = Math.round((completedFields / totalFields) * 100);

      return {
        completed: completedFields,
        total: totalFields,
        percentage
      };

    } catch (err) {
      console.error('Erro ao calcular progresso do modelo:', err);
      return { completed: 0, total: 0, percentage: 0 };
    }
  }, [articleId, modelParentEntityTypeId]);

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

  // Criar novo modelo
  const createModel = useCallback(async (
    modelName: string,
    modellingMethod: string
  ): Promise<Model | null> => {
    if (!user || !modelParentEntityTypeId) {
      toast.error('Usuário não autenticado ou template inválido');
      return null;
    }

    try {
      console.log('🆕 Criando novo modelo:', modelName);

      // 1. Gerar nome único
      const uniqueModelName = await generateUniqueModelName(modelName.trim());
      if (uniqueModelName !== modelName.trim()) {
        console.log('📝 Nome ajustado para:', uniqueModelName);
        toast.info(`Nome ajustado para "${uniqueModelName}" para evitar duplicatas`);
      }

      // 2. Buscar child entity types
      const { data: childEntityTypes, error: childTypesError } = await supabase
        .from('extraction_entity_types')
        .select('id, name, label, sort_order, cardinality')
        .eq('parent_entity_type_id', modelParentEntityTypeId)
        .order('sort_order');

      if (childTypesError) throw childTypesError;

      // 3. Calcular próximo sort_order
      const maxSortOrder = models.reduce((max, m) => Math.max(max, 0), 0);

      // 4. Criar instance de prediction_models (parent)
      let parentInstance;
      const { data: initialInstance, error: parentError } = await supabase
        .from('extraction_instances')
        .insert({
          project_id: projectId,
          article_id: articleId,
          template_id: templateId,
          entity_type_id: modelParentEntityTypeId,
          label: uniqueModelName, // Usar nome único
          sort_order: maxSortOrder + 1,
          status: 'pending',
          metadata: {},
          created_by: user.id
        })
        .select()
        .single();

      if (parentError) {
        // Se ainda assim falhar, tentar com timestamp
        if (parentError.code === '23505') { // unique_violation
          console.warn('⚠️ Ainda há conflito, usando timestamp');
          const fallbackName = `${modelName} (${Date.now()})`;
          
          const { data: fallbackInstance, error: fallbackError } = await supabase
            .from('extraction_instances')
            .insert({
              project_id: projectId,
              article_id: articleId,
              template_id: templateId,
              entity_type_id: modelParentEntityTypeId,
              label: fallbackName,
              sort_order: maxSortOrder + 1,
              status: 'pending',
              metadata: {},
              created_by: user.id
            })
            .select()
            .single();

          if (fallbackError) throw fallbackError;
          parentInstance = fallbackInstance;
        } else {
          throw parentError;
        }
      } else {
        parentInstance = initialInstance;
      }

      console.log('✅ Parent instance criada:', parentInstance.id);

      // 4. Se modellingMethod foi fornecido, buscar o field e salvar
      if (modellingMethod) {
        const { data: modellingMethodField, error: fieldError } = await supabase
          .from('extraction_fields')
          .select('id')
          .eq('entity_type_id', modelParentEntityTypeId)
          .eq('name', 'modelling_method')
          .single();

        if (!fieldError && modellingMethodField) {
          await supabase.from('extracted_values').insert({
            project_id: projectId,
            article_id: articleId,
            instance_id: parentInstance.id,
            field_id: modellingMethodField.id,
            value: { value: modellingMethod },
            source: 'human',
            reviewer_id: user.id
          });
        }
      }

      // 5. Criar child instances com labels únicos
      let createdChildInstances: any[] = [];
      
      if (childEntityTypes && childEntityTypes.length > 0) {
        const childInstancesToCreate = childEntityTypes.map((childType, index) => ({
          project_id: projectId,
          article_id: articleId,
          template_id: templateId,
          entity_type_id: childType.id,
          parent_instance_id: parentInstance.id,
          // ✅ Label único: inclui nome do modelo parent para evitar conflitos
          label: `${parentInstance.label} - ${childType.label}`,
          sort_order: childType.sort_order,
          status: 'pending',
          metadata: {},
          created_by: user.id
        }));

        console.log('🔄 Criando child instances:', childInstancesToCreate.map(ci => ci.label));

        const { data: insertedChildInstances, error: childError } = await supabase
          .from('extraction_instances')
          .insert(childInstancesToCreate)
          .select('*');

        if (childError) {
          console.error('❌ Erro ao criar child instances:', childError);
          throw childError;
        }

        createdChildInstances = insertedChildInstances || [];
        console.log(`✅ Criadas ${createdChildInstances.length} child instances`);
      }

      // 6. Criar objeto Model
      const newModel: Model = {
        instanceId: parentInstance.id,
        modelName: parentInstance.label, // Usar o nome final (pode ter sido ajustado)
        progress: { completed: 0, total: 0, percentage: 0 }
      };

      // 7. Atualizar estado
      setModels(prev => [...prev, newModel]);
      setActiveModelId(newModel.instanceId);

      toast.success(`Modelo "${modelName}" criado com sucesso!`);
      
      // ✅ Retornar modelo E child instances criadas (para evitar query extra)
      return {
        model: newModel,
        childInstances: createdChildInstances
      };

    } catch (err: any) {
      console.error('Erro ao criar modelo:', err);
      
      // Tratamento específico para constraint violations
      if (err.code === '23505') {
        toast.error('Erro: Já existe um modelo com este nome. Tente novamente.');
      } else if (err.message?.includes('duplicate key')) {
        toast.error('Erro: Nome duplicado. Tente com um nome diferente.');
      } else {
        toast.error(`Erro ao criar modelo: ${err.message}`);
      }
      
      return null;
    }
  }, [user, modelParentEntityTypeId, models, projectId, articleId, templateId]);

  // Remover modelo
  const removeModel = useCallback(async (instanceId: string): Promise<boolean> => {
    try {
      console.log('🗑️ Removendo modelo:', instanceId);
      
      const removedModel = models.find(m => m.instanceId === instanceId);
      console.log('📝 Modelo a ser removido:', removedModel?.modelName);

      // ✅ CORREÇÃO: Deletar apenas o parent instance
      // O CASCADE DELETE do Postgres cuida automaticamente de:
      // - Child instances (via FK parent_instance_id ON DELETE CASCADE)
      // - Extracted values (via FK instance_id ON DELETE CASCADE)
      const { error: deleteError } = await supabase
        .from('extraction_instances')
        .delete()
        .eq('id', instanceId);

      if (deleteError) {
        console.error('❌ Erro ao deletar instance:', deleteError);
        throw deleteError;
      }

      console.log('✅ Instance deletada com CASCADE');

      // Atualizar estado local
      setModels(prev => prev.filter(m => m.instanceId !== instanceId));

      // Se era o modelo ativo, limpar activeModelId
      // O useEffect em ExtractionFullScreen vai selecionar outro automaticamente
      if (activeModelId === instanceId) {
        setActiveModelId(null);
      }

      toast.success(`Modelo "${removedModel?.modelName}" removido com sucesso`);
      return true;

    } catch (err: any) {
      console.error('❌ Erro ao remover modelo:', err);
      toast.error(`Erro ao remover modelo: ${err.message}`);
      return false;
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

