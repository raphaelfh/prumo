/**
 * Hook to manage extraction instances
 *
 * Manages ONLY instances (create, update, delete).
 * Entity types loaded separately via useEntityTypes.
 *
 * Refactored (Phase 5): Separated from entity types (SRP).
 * Uses extractionInstanceService to centralize logic.
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {extractionInstanceService} from '@/services/extractionInstanceService';
import {useEntityTypes} from './useEntityTypes';
import {ExtractionInstance} from '@/types/extraction';
import {t} from '@/lib/copy';

interface UseExtractionInstancesProps {
  projectId: string;
  articleId: string;
  templateId: string;
}

export function useExtractionInstances({ 
  projectId, 
  articleId, 
  templateId 
}: UseExtractionInstancesProps) {
  const [instances, setInstances] = useState<ExtractionInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

    // Load entity types via dedicated hook (SRP)
  const { entityTypes, loading: entityTypesLoading } = useEntityTypes({
    templateId,
    enabled: !!templateId,
  });

    // Memoize service (singleton, ensure stability)
  const service = useMemo(() => extractionInstanceService, []);

    // Load article instances
  const loadInstances = useCallback(async () => {
    if (!articleId || !templateId) {
      setInstances([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('extraction_instances')
        .select(`
          *,
          extraction_entity_types (*)
        `)
        .eq('article_id', articleId)
        .eq('template_id', templateId)
        .order('sort_order', { ascending: true });

      if (error) throw error;

      setInstances(data || []);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('extraction', 'errors_loadInstances');
        console.error('Error loading instances:', err);
      setError(message);
    }
  }, [articleId, templateId]);

    // Load initial data (instances only)
  useEffect(() => {
    if (!articleId || !templateId) {
      setInstances([]);
      setLoading(false);
      return;
    }
    
    const loadData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        await loadInstances();
      } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('extraction', 'errors_loadInstances');
          console.error('Error loading instance data:', err);
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [articleId, templateId, loadInstances]);

    // Create new instance (using service)
  const createInstance = useCallback(async (
    entityTypeId: string,
    label: string,
    parentInstanceId?: string
  ): Promise<ExtractionInstance | null> => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) throw new Error(t('common', 'errors_userNotAuthenticated'));

        // Fetch entity type
      const entityType = entityTypes.find(et => et.id === entityTypeId);
      if (!entityType) {
          toast.error(t('extraction', 'entityTypeNotFound'));
        return null;
      }

        // Delegate to service
      const result = await service.createInstance({
        projectId,
        articleId,
        templateId,
        entityTypeId,
        entityType,
        parentInstanceId,
        label,
        userId: user.id
      });

        // Update local state
      if (result.wasCreated) {
        setInstances(prev => [...prev, result.instance]);
          toast.success(t('extraction', 'instanceCreatedSuccess').replace('{{label}}', result.instance.label));
      } else {
          toast.info(t('extraction', 'instanceAlreadyExists'));
      }

      return result.instance;

    } catch (err: any) {
        console.error('Error creating instance:', err);
        toast.error(`${t('extraction', 'errors_createInstance')}: ${err.message}`);
      return null;
    }
  }, [projectId, articleId, templateId, entityTypes, service]);

    // Update instance
  const updateInstance = useCallback(async (
    instanceId: string,
    updates: Partial<ExtractionInstance>
  ): Promise<ExtractionInstance | null> => {
    try {
      const { data, error } = await supabase
        .from('extraction_instances')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', instanceId)
        .select(`
          *,
          extraction_entity_types (*)
        `)
        .single();

      if (error) throw error;

        // Update local state
      setInstances(prev => 
        prev.map(instance => 
          instance.id === instanceId ? data : instance
        )
      );

        toast.success(t('extraction', 'instanceUpdatedSuccess'));
      return data;

    } catch (err: any) {
        console.error('Error updating instance:', err);
        toast.error(`${t('extraction', 'errors_updateInstance')}: ${err.message}`);
      return null;
    }
  }, []);

    // Delete instance (using service)
  const deleteInstance = useCallback(async (instanceId: string): Promise<boolean> => {
    try {
        // Check for associated values (local validation)
      const { data: values, error: valuesError } = await supabase
        .from('extracted_values')
        .select('id')
        .eq('instance_id', instanceId)
        .limit(1);

      if (valuesError) throw valuesError;

      if (values && values.length > 0) {
          toast.error(t('extraction', 'cannotDeleteInstanceWithValues'));
        return false;
      }

        // Delegate to service (automatic CASCADE)
      await service.removeInstance(instanceId);

        // Update local state
      setInstances(prev => prev.filter(instance => instance.id !== instanceId));

        toast.success(t('extraction', 'instanceDeletedSuccess'));
      return true;

    } catch (err: any) {
        console.error('Error deleting instance:', err);
        toast.error(`${t('extraction', 'errors_deleteInstance')}: ${err.message}`);
      return false;
    }
  }, [service]);

    // Reorder instances
  const reorderInstances = useCallback(async (
    entityTypeId: string,
    newOrder: { id: string; sort_order: number }[]
  ): Promise<boolean> => {
    try {
        // Update all instances in a transaction
      const updates = newOrder.map(item => 
        supabase
          .from('extraction_instances')
          .update({ sort_order: item.sort_order })
          .eq('id', item.id)
      );

      await Promise.all(updates);

        // Reload instances
      await loadInstances();

        toast.success(t('extraction', 'instancesReorderSuccess'));
      return true;

    } catch (err: any) {
        console.error('Error reordering instances:', err);
        toast.error(`${t('extraction', 'errors_reorderInstances')}: ${err.message}`);
      return false;
    }
  }, [loadInstances]);

    // Get instances by entity type
  const getInstancesByEntityType = useCallback((entityTypeId: string): ExtractionInstance[] => {
    return instances.filter(instance => instance.entity_type_id === entityTypeId);
  }, [instances]);

    // Get child instances
  const getChildInstances = useCallback((parentInstanceId: string): ExtractionInstance[] => {
    return instances.filter(instance => instance.parent_instance_id === parentInstanceId);
  }, [instances]);

    // Check if can create instance
  const canCreateInstance = useCallback((entityTypeId: string): boolean => {
    const entityType = entityTypes.find(et => et.id === entityTypeId);
    if (!entityType) return false;

      // If cardinality is 'one', check if instance already exists
    if (entityType.cardinality === 'one') {
      const existingInstance = instances.find(
        instance => instance.entity_type_id === entityTypeId
      );
      return !existingInstance;
    }

      // If cardinality is 'many', can always create
    return true;
  }, [entityTypes, instances]);

    // Generate next label for instance
  const generateNextLabel = useCallback((entityTypeId: string): string => {
    const entityType = entityTypes.find(et => et.id === entityTypeId);
      if (!entityType) return t('extraction', 'newInstanceLabel');

    const existingInstances = getInstancesByEntityType(entityTypeId);
    const baseLabel = entityType.label;

    if (existingInstances.length === 0) {
      return `${baseLabel} 1`;
    }

      // Find next number
    let nextNumber = 1;
    const existingNumbers = existingInstances
      .map(instance => {
        const match = instance.label.match(/\d+$/);
        return match ? parseInt(match[0]) : 0;
      })
      .sort((a, b) => b - a);

    for (const num of existingNumbers) {
      if (num === nextNumber) {
        nextNumber++;
      } else {
        break;
      }
    }

    return `${baseLabel} ${nextNumber}`;
  }, [entityTypes, getInstancesByEntityType]);

    // Combined loading (instances OR entity types)
  const combinedLoading = loading || entityTypesLoading;

  return {
      // State
    instances,
      entityTypes, // Kept for compatibility, loaded via dedicated hook
    loading: combinedLoading,
    error,

      // Actions
    createInstance,
    updateInstance,
    deleteInstance,
    reorderInstances,
    refreshInstances: loadInstances,

      // Utilities
    getInstancesByEntityType,
    getChildInstances,
    canCreateInstance,
    generateNextLabel
  };
}
