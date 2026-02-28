/**
 * Hook para gerenciar hierarquia de assessment instances
 *
 * Constrói árvore hierárquica de instances (root → children)
 * útil para casos como:
 * - PROBAST root → Domain instances
 * - Assessment geral → Sub-assessments por seção
 *
 * Análogo a useEntityHierarchy de extraction.
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {AssessmentInstance, AssessmentInstanceHierarchy, AssessmentInstanceProgress,} from '@/types/assessment';

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

  // Carregar todas as instances
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
      const message = err instanceof Error ? err.message : 'Erro ao carregar instances';
      console.error('Erro ao carregar instances:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId, articleId, instrumentId]);

  // Carregar dados iniciais
  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

  // Buscar children de uma instance usando função SQL
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
      console.error('Erro ao buscar children:', err);
      return [];
    }
  }, []);

  // Calcular progresso de uma instance
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
      console.error('Erro ao calcular progresso:', err);
      return {
        total_items: 0,
        answered_items: 0,
        completion_percentage: 0,
      };
    }
  }, []);

  // Construir hierarquia recursiva
  const buildHierarchy = useCallback(async (
    parentId: string | null = null
  ): Promise<AssessmentInstanceHierarchy[]> => {
    // Filtrar instances deste nível
    const currentLevelInstances = instances.filter(
      inst => inst.parent_instance_id === parentId
    );

    // Construir hierarquia para cada instance
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

  // Memoizar root instances
  const rootInstances = useMemo(() => {
    return instances.filter(inst => inst.parent_instance_id === null);
  }, [instances]);

  // Memoizar hierarquia completa (chamada lazy para evitar loops)
  const getFullHierarchy = useCallback(async (): Promise<AssessmentInstanceHierarchy[]> => {
    return buildHierarchy(null);
  }, [buildHierarchy]);

  // Buscar path de uma instance (root → ... → instance)
  const getInstancePath = useCallback((instanceId: string): AssessmentInstance[] => {
    const path: AssessmentInstance[] = [];
    let currentId: string | null = instanceId;

    while (currentId) {
      const instance = instances.find(inst => inst.id === currentId);
      if (!instance) break;

      path.unshift(instance); // Adicionar no início
      currentId = instance.parent_instance_id;
    }

    return path;
  }, [instances]);

  // Verificar se instance é descendente de outra
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
