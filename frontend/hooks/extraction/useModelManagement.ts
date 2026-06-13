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

import {useEffect, useRef, useState} from 'react';
import {createManualModelHierarchy} from '@/integrations/api';
import {useAuth} from '@/contexts/AuthContext';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {extractionInstanceService, loadModelInstances, fetchModelProgress} from '@/services/extractionInstanceService';
import type {Model} from '@/components/extraction/hierarchy/ModelSelector';

// =================== INTERFACES ===================

interface UseModelManagementProps {
  projectId: string;
  articleId: string;
  templateId: string;
  /** ID of the template's model container entity type (role='model_container'). */
  modelParentEntityTypeId: string | null;
  enabled?: boolean;
}

interface CreateModelResult {
  model: Model;
  childInstances: Array<{
    id: string;
    entityTypeId: string;
    parentInstanceId: string;
    label: string;
  }>;
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
  const loadModelsRef = useRef<(() => Promise<void>) | undefined>(undefined);

    // Sync ref with state
  useEffect(() => {
    activeModelIdRef.current = activeModelId;
  }, [activeModelId]);

    // Calculate progress for a model (using optimized SQL function).
  const getModelProgress = async (instanceId: string): Promise<Model['progress']> =>
    fetchModelProgress(articleId, instanceId);

    // Load existing models
  const loadModels = async () => {
    if (!enabled || !modelParentEntityTypeId) {
      console.warn('⏭️ loadModels: Skipped (enabled:', enabled, ', modelParentEntityTypeId:', modelParentEntityTypeId, ')');
      setModels([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    console.warn('[useModelManagement] Loading models for article:', articleId, ', entity_type:', modelParentEntityTypeId);

    const result = await loadModelInstances(articleId, modelParentEntityTypeId);

    if (!result.ok) {
      console.error('Error loading models:', result.error);
      setError(result.error.message);
      setLoading(false);
      return;
    }

    const instances = result.data;
    console.warn(`✅ Encontradas ${instances.length} instances de modelos:`, instances.map(i => i.label));

    if (instances.length === 0) {
      setModels([]);
      setActiveModelId(null);
    } else {
        // For each model, calculate progress
      const modelsWithProgress = await Promise.all(
        instances.map(async (instance) => {
          const progress = await getModelProgress(instance.id);
          return {
            instanceId: instance.id,
            modelName: instance.label ?? 'Unnamed model',
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

    setLoading(false);
  };

    // Sync ref with loadModels in an effect (refs must not be written
    // during render). Declared before the mount-load effect below so the
    // ref is populated by the time that effect runs.
  useEffect(() => {
    loadModelsRef.current = loadModels;
  }, [loadModels]);

    // Create new model (using service - simplified)
  const createModel = async (
    modelName: string,
    modellingMethod: string
  ): Promise<CreateModelResult | null> => {
    if (!user || !modelParentEntityTypeId) {
      toast.error(t('extraction', 'modelNotAuthenticatedOrInvalid'));
      return null;
    }

    const result = await createManualModelHierarchy({
      project_id: projectId,
      article_id: articleId,
      template_id: templateId,
      model_name: modelName.trim(),
      modelling_method: modellingMethod || null,
    }).catch((err: unknown) => {
      console.error('Error creating model:', err);
      toast.error(`${t('extraction', 'errors_createModel')}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });

    if (!result) return null;

    // Create Model object
    const newModel: Model = {
      instanceId: result.model_id,
      modelName: result.model_label,
      progress: { completed: 0, total: 0, percentage: 0 }
    };

    // Update state
    setModels(prev => [...prev, newModel]);
    setActiveModelId(newModel.instanceId);

    toast.success(t('extraction', 'modelCreatedSuccess').replace('{{label}}', result.model_label));
    console.warn(`✅ Hierarchy created: 1 parent + ${result.child_instances.length} children`);

    return {
      model: newModel,
      childInstances: result.child_instances.map((child) => ({
        id: child.id,
        entityTypeId: child.entity_type_id,
        parentInstanceId: child.parent_instance_id,
        label: child.label,
      })),
    };
  };

    // Remove model (using service - simplified)
  const removeModel = async (instanceId: string): Promise<void> => {
    console.warn('🗑️ Removing model:', instanceId);

    await extractionInstanceService.removeInstance(instanceId).catch((err: unknown) => {
      console.error('Error removing model:', err);
      toast.error(`${t('extraction', 'errors_removeModel')}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    });

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

    console.warn('✅ Modelo removido:', removedModelName);
    toast.success(t('extraction', 'modelRemovedSuccess').replace('{{label}}', removedModelName));
  };

  // Refresh models
  const refreshModels = () => {
    return loadModels();
  };

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
