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
import type {ModelInstanceRow} from '@/services/extractionInstanceService';
import type {Model} from '@/components/extraction/hierarchy/ModelSelector';

// =================== INTERFACES ===================

interface UseModelManagementProps {
  projectId: string;
  articleId: string;
  templateId: string;
  /** ID of the template's model container entity type (role='model_container'). */
  modelParentEntityTypeId: string | null;
  /**
   * Model-container instances supplied by the caller (derived from the
   * server RunView). When provided, the hook uses these directly and
   * skips the ``loadModelInstances`` Supabase read — the run-open page is
   * the source of truth. When undefined the hook self-loads (standalone
   * usage / tests).
   */
  modelInstances?: ModelInstanceRow[];
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
  modelInstances,
  enabled = true
}: UseModelManagementProps): UseModelManagementReturn {
  const { user } = useAuth();
  const [models, setModels] = useState<Model[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

    // Primitive signature of the supplied model instances. The mount-load
    // effect keys on this (not the array reference) so an unstable
    // ``modelInstances`` reference from a caller can't re-trigger the load
    // loop — the loop-outage incident class. ``null`` when not supplied.
  const modelInstancesSig =
    modelInstances === undefined
      ? null
      : modelInstances.map(i => `${i.id}:${i.label}:${i.sort_order}`).join('|');

    // Ref to avoid infinite loop: track activeModelId without causing re-render
  const activeModelIdRef = useRef<string | null>(null);

    // Ref to store loadModels and avoid loops in useEffect
  const loadModelsRef = useRef<(() => Promise<void>) | undefined>(undefined);

    // Monotonic load generation. Each ``loadModels`` call claims the next
    // number; any state write it makes AFTER an await is dropped once a
    // newer load (pager navigation, an entity-type switch, or a flapping
    // ``modelInstancesSig``) has superseded it. Without this guard a slow
    // stale load's resolution overwrites the current article's models —
    // the "Encontradas 1 → 0 → 1" flapping incident class (prod 2026-07-05).
    // The mount-load effect has no cleanup, so the guard (not an
    // AbortController — the awaited services take no signal) is what makes a
    // superseded resolution a no-op.
  const loadGenerationRef = useRef(0);

    // Sync ref with state
  useEffect(() => {
    activeModelIdRef.current = activeModelId;
  }, [activeModelId]);

    // Calculate progress for a model (using optimized SQL function).
  const getModelProgress = async (instanceId: string): Promise<Model['progress']> =>
    fetchModelProgress(articleId, instanceId);

    // Claim the next load generation for an optimistic mutation. A local
    // create/remove is the freshest client truth, so it must supersede any
    // load that STARTED before it — otherwise that in-flight load's absolute
    // ``setModels(snapshot)`` (built before the mutation) would drop a
    // just-created model or resurrect a just-removed one when its progress
    // fan-out resolves (its ``isStale`` check passes because a mutation,
    // unlike a new load, never advanced the generation). A refresh started
    // AFTER the mutation claims a higher generation and still wins.
  const supersedeInFlightLoads = () => {
    loadGenerationRef.current += 1;
  };

    // Load existing models
  const loadModels = async () => {
    // Claim this load's generation. ``isStale`` is true once a newer
    // ``loadModels`` has started — used to gate every write that follows an
    // await so a superseded resolution never commits.
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    const isStale = () => generation !== loadGenerationRef.current;

    if (!enabled || !modelParentEntityTypeId) {
      console.warn('⏭️ loadModels: Skipped (enabled:', enabled, ', modelParentEntityTypeId:', modelParentEntityTypeId, ')');
      setModels([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    console.warn('[useModelManagement] Loading models for article:', articleId, ', entity_type:', modelParentEntityTypeId);

    // When the caller supplies the model-container instances (derived from
    // the server RunView on the run-open page), use them directly — no
    // ``extraction_instances`` read fires from this hook. Otherwise the hook
    // self-loads via the service (standalone usage / tests).
    let instances: ModelInstanceRow[];
    if (modelInstances !== undefined) {
      instances = modelInstances;
    } else {
      const result = await loadModelInstances(articleId, modelParentEntityTypeId);

      // A newer load (different article/entity-type, or a re-derived view)
      // superseded this one while the read was in flight — drop the result.
      if (isStale()) return;

      if (!result.ok) {
        console.error('Error loading models:', result.error);
        setError(result.error.message);
        setLoading(false);
        return;
      }
      instances = result.data;
    }
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

      // The progress fan-out is a second async gap; re-check before writing
      // so a load superseded during it cannot clobber the current models.
      if (isStale()) return;

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

    // Update state. Supersede any in-flight load first so its stale snapshot
    // cannot drop the model we are about to add.
    supersedeInFlightLoads();
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

    // Update local state - remove model and capture name for toast.
    // Supersede any in-flight load first so its stale snapshot cannot
    // resurrect the model we are about to remove.
    supersedeInFlightLoads();
    let removedModelName = 'Model';
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
    // ``modelInstancesSig`` (primitive) is in the deps so a fresh view
    // (after refetchRun) re-derives the models from the supplied prop
    // without a Supabase read — and an unstable array reference can't spin
    // the load loop.
  }, [enabled, projectId, articleId, templateId, modelParentEntityTypeId, modelInstancesSig]);

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
