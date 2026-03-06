/**
 * Hook to manage assessment instance hierarchy
 *
 * Builds hierarchical tree of instances (root → children)
 * Useful for cases like:
 * - PROBAST root → Domain instances
 * - General assessment → Sub-assessments per section
 *
 * Analogous to useEntityHierarchy in extraction.
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {AssessmentInstance, AssessmentInstanceHierarchy, AssessmentInstanceProgress,} from '@/types/assessment';
import {t} from '@/lib/copy';

interface UseAssessmentInstanceHierarchyProps {
  projectId: string;
  articleId?: string;
  instrumentId?: string;
  enabled?: boolean;
}

export function useAssessmentInstanceHierarchy({
  projectId,
  articleId,
  instrumentId,
  enabled = true,
}: UseAssessmentInstanceHierarchyProps) {
  const [instances, setInstances] = useState<AssessmentInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

    // Load all instances
  const loadInstances = useCallback(async () => {
    if (!enabled || !projectId) {
      setInstances([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('assessment_instances')
        .select('*')
        .eq('project_id', projectId);

      if (articleId) {
        query = query.eq('article_id', articleId);
      }

      if (instrumentId) {
        query = query.eq('instrument_id', instrumentId);
      }

      query = query.order('created_at', { ascending: true });

      const { data, error: queryError } = await query;

      if (queryError) throw queryError;

      setInstances(data || []);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('assessment', 'errors_loadAssessment');
        console.error('Error loading instances:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId, articleId, instrumentId]);

    // Load initial data
  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

    // Fetch children of an instance using SQL function
  const getChildren = useCallback(async (
    parentInstanceId: string
  ): Promise<AssessmentInstance[]> => {
    try {
      const { data, error } = await supabase.rpc(
        'get_assessment_instance_children',
        { p_instance_id: parentInstanceId }
      );

      if (error) throw error;

      return data || [];
    } catch (err: unknown) {
        console.error('Error fetching children:', err);
      return [];
    }
  }, []);

    // Calculate progress for an instance
  const calculateProgress = useCallback(async (
    instanceId: string
  ): Promise<AssessmentInstanceProgress> => {
    try {
      const { data, error } = await supabase.rpc(
        'calculate_assessment_instance_progress',
        { p_instance_id: instanceId }
      );

      if (error) throw error;

      if (data && data.length > 0) {
        return {
          total_items: data[0].total_items,
          answered_items: data[0].answered_items,
          completion_percentage: data[0].completion_percentage,
        };
      }

      return {
        total_items: 0,
        answered_items: 0,
        completion_percentage: 0,
      };
    } catch (err: unknown) {
        console.error('Error calculating progress:', err);
      return {
        total_items: 0,
        answered_items: 0,
        completion_percentage: 0,
      };
    }
  }, []);

    // Build recursive hierarchy
  const buildHierarchy = useCallback(async (
    parentId: string | null = null
  ): Promise<AssessmentInstanceHierarchy[]> => {
      // Filter instances at this level
    const currentLevelInstances = instances.filter(
      inst => inst.parent_instance_id === parentId
    );

      // Build hierarchy for each instance
    const hierarchies = await Promise.all(
      currentLevelInstances.map(async (instance) => {
        const children = await buildHierarchy(instance.id);
        const progress = await calculateProgress(instance.id);

        return {
          instance,
          children,
          progress,
        };
      })
    );

    return hierarchies;
  }, [instances, calculateProgress]);

    // Memoize root instances
  const rootInstances = useMemo(() => {
    return instances.filter(inst => inst.parent_instance_id === null);
  }, [instances]);

    // Memoize full hierarchy (lazy call to avoid loops)
  const getFullHierarchy = useCallback(async (): Promise<AssessmentInstanceHierarchy[]> => {
    return buildHierarchy(null);
  }, [buildHierarchy]);

    // Get path of an instance (root → ... → instance)
  const getInstancePath = useCallback((instanceId: string): AssessmentInstance[] => {
    const path: AssessmentInstance[] = [];
    let currentId: string | null = instanceId;

    while (currentId) {
      const instance = instances.find(inst => inst.id === currentId);
      if (!instance) break;

        path.unshift(instance); // Add at beginning
      currentId = instance.parent_instance_id;
    }

    return path;
  }, [instances]);

    // Check if instance is descendant of another
  const isDescendantOf = useCallback((
    instanceId: string,
    ancestorId: string
  ): boolean => {
    const path = getInstancePath(instanceId);
    return path.some(inst => inst.id === ancestorId);
  }, [getInstancePath]);

  return {
    instances,
    rootInstances,
    loading,
    error,

    // Actions
    getChildren,
    calculateProgress,
    getFullHierarchy,
    getInstancePath,
    isDescendantOf,

    // Reload
    reload: loadInstances,
  };
}
