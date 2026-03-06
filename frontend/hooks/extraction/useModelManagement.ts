/**
 * Hook for hierarchical prediction model management
 *
 * Responsible for:
 * - Loading existing models (prediction_models instances)
 * - Creating new model (with sub-sections automatically)
 * - Removing model (with all sub-sections and data)
 * - Computing progress per model
 * - Managing active model
 *
 * Refactored (Phase 2): Uses extractionInstanceService and optimized SQL
 * for progress (1 query for all models).
 *
 * @module hooks/extraction/useModelManagement
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/contexts/AuthContext';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {extractionInstanceService} from '@/services/extractionInstanceService';
import type {Model} from '@/components/extraction/hierarchy/ModelSelector';

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

    // Ref to avoid infinite loop: track activeModelId without causing re-render
  const activeModelIdRef = useRef<string | null>(null);

    // Ref to store loadModels and avoid loops in useEffect
  const loadModelsRef = useRef<() => Promise<void>>();

    // Sync ref with state
  useEffect(() => {
    activeModelIdRef.current = activeModelId;
  }, [activeModelId]);

    // Calculate progress for a model (using optimized SQL function)
    // Declared BEFORE loadModels because loadModels depends on it
  const getModelProgress = useCallback(async (instanceId: string): Promise<Model['progress']> => {
    try {
        // Use optimized SQL function (1 query)
      const { data, error } = await supabase
        .rpc('calculate_model_progress', {
          p_article_id: articleId,
          p_model_id: instanceId
        });

      if (error) {
          console.warn('Error calculating progress (fallback to 0):', error);
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
        console.error('Error calculating model progress:', err);
      return { completed: 0, total: 0, percentage: 0 };
    }
  }, [articleId]);

    // Load existing models
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

        console.log('[useModelManagement] Loading models for article:', articleId, ', entity_type:', modelParentEntityTypeId);

        // Fetch prediction_models instances for this article
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
          // FIX: Do not return here - let finally run so loading = false is guaranteed
          // finally always runs, but being explicit is clearer
      } else {
          // For each model, calculate progress
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

        const currentActiveId = activeModelIdRef.current;
        const hasActiveModel = currentActiveId
          ? modelsWithProgress.some(model => model.instanceId === currentActiveId)
          : false;

          // If active model no longer exists (or not set yet), pick first available
        if (!hasActiveModel) {
          const fallbackModelId = modelsWithProgress[0]?.instanceId ?? null;
          setActiveModelId(fallbackModelId);
        }
      }

    } catch (err: any) {
        console.error('Error loading models:', err);
      setError(err.message);
        // FIX: Do not setLoading(false) in catch - finally always runs
    } finally {
        // Ensure loading is always false, even on early returns
      setLoading(false);
    }
  }, [enabled, modelParentEntityTypeId, articleId, getModelProgress]);

    // FIX: Sync ref with loadModels right after definition
    // Ensures ref is available when useEffect tries to use it
  loadModelsRef.current = loadModels;

    // Function to generate unique name
  const generateUniqueModelName = useCallback(async (
    baseName: string,
    maxAttempts: number = 10
  ): Promise<string> => {
    let uniqueName = baseName;
    let attempt = 1;

    while (attempt <= maxAttempts) {
        // Check if name already exists in DB
      const { data: existingInstance, error: checkError } = await supabase
        .from('extraction_instances')
        .select('id')
        .eq('article_id', articleId)
        .eq('entity_type_id', modelParentEntityTypeId!)
        .eq('label', uniqueName)
        .limit(1);

      if (checkError) throw checkError;

        // If not exists, return the name
      if (!existingInstance || existingInstance.length === 0) {
        return uniqueName;
      }

        // If exists, try with numeric suffix
      attempt++;
      uniqueName = `${baseName} (${attempt})`;
    }

    // Se esgotou as tentativas, usar timestamp
    return `${baseName} (${Date.now()})`;
  }, [articleId, modelParentEntityTypeId]);

    // Create new model (using service - simplified)
  const createModel = useCallback(async (
    modelName: string,
    modellingMethod: string
  ): Promise<CreateModelResult | null> => {
    if (!user || !modelParentEntityTypeId) {
        toast.error(t('extraction', 'modelNotAuthenticatedOrInvalid'));
      return null;
    }

    try {
        console.log('🆕 Creating new model:', modelName);

        // 1. Fetch parent entity type
      const { data: parentEntityType, error: etError } = await supabase
        .from('extraction_entity_types')
        .select('*')
        .eq('id', modelParentEntityTypeId)
        .single();

      if (etError || !parentEntityType) {
          throw new Error(t('extraction', 'modelEntityTypeNotFound'));
      }

        // 2. Fetch child entity types
      const { data: childEntityTypes, error: childTypesError } = await supabase
        .from('extraction_entity_types')
        .select('*')
        .eq('parent_entity_type_id', modelParentEntityTypeId)
        .order('sort_order');

      if (childTypesError) throw childTypesError;

        // 3. Delegate hierarchy creation to service
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

        // 5. Create Model object
      const newModel: Model = {
        instanceId: result.parent.id,
        modelName: result.parent.label,
        progress: { completed: 0, total: 0, percentage: 0 }
      };

        // 6. Update state
      setModels(prev => [...prev, newModel]);
      setActiveModelId(newModel.instanceId);

        toast.success(t('extraction', 'modelCreatedSuccess').replace('{{label}}', result.parent.label));
      
      console.log(`✅ Hierarquia criada: 1 parent + ${result.children.length} children`);

        // Return model AND created child instances
      return {
        model: newModel,
        childInstances: result.children
      };

    } catch (err: any) {
        console.error('Error creating model:', err);
        toast.error(`${t('extraction', 'errors_createModel')}: ${err.message}`);
      return null;
    }
  }, [user, modelParentEntityTypeId, projectId, articleId, templateId]);

    // Remove model (using service - simplified)
  const removeModel = useCallback(async (instanceId: string): Promise<void> => {
    try {
        console.log('🗑️ Removing model:', instanceId);

        // Delegate to service (automatic CASCADE)
      await extractionInstanceService.removeInstance(instanceId);

        // Update local state - remove model and capture name for toast
      let removedModelName = 'Modelo';
      let updatedModels: Model[] = [];

      setModels(prev => {
        const model = prev.find(m => m.instanceId === instanceId);
        if (model) {
          removedModelName = model.modelName;
        }

        const filteredModels = prev.filter(m => m.instanceId !== instanceId);
        updatedModels = filteredModels;

        return filteredModels;
      });

        // Ensure a valid active model always exists after removal
      setActiveModelId(prevActiveId => {
        if (!updatedModels.length) {
          return null;
        }

        const stillExists = prevActiveId
          ? updatedModels.some(model => model.instanceId === prevActiveId)
          : false;

        if (stillExists) {
          return prevActiveId;
        }

          // Select first remaining model as fallback
        return updatedModels[0].instanceId;
      });

      console.log('✅ Modelo removido:', removedModelName);
        toast.success(t('extraction', 'modelRemovedSuccess').replace('{{label}}', removedModelName));

    } catch (err: any) {
        console.error('Error removing model:', err);
        toast.error(`${t('extraction', 'errors_removeModel')}: ${err.message}`);
        // Re-throw error instead of returning boolean for consistent error handling
      throw err;
    }
  }, []); // No deps - uses only setters and functional callbacks

  // Refresh models
  const refreshModels = useCallback(() => {
    return loadModels();
  }, [loadModels]);

    // Load models on mount
    // FIX: Remove loadModels from deps to avoid loops
    // Use ref to access latest function without re-running useEffect
  useEffect(() => {
    if (enabled && projectId && articleId && templateId && modelParentEntityTypeId) {
        // Use ref to avoid circular dependency
      if (loadModelsRef.current) {
        loadModelsRef.current();
      }
    }
  }, [enabled, projectId, articleId, templateId, modelParentEntityTypeId]);

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

