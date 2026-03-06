/**
 * Hook to manage assessment instances (Assessment 2.0)
 *
 * Analogous to useExtractionInstances. Manages instances only
 * (create, update, delete, hierarchy).
 *
 * Allows PROBAST per model via extraction_instance_id.
 *
 * @see useExtractionInstances - Analogous hook for extraction
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {
    AssessmentInstance,
    CreateAssessmentInstanceRequest,
    UpdateAssessmentInstanceRequest,
} from '@/types/assessment';

interface UseAssessmentInstancesProps {
  projectId: string;
  articleId?: string;
  instrumentId?: string;
  extractionInstanceId?: string | null;  // Para PROBAST por modelo
  enabled?: boolean;
}

export function useAssessmentInstances({
  projectId,
  articleId,
  instrumentId,
  extractionInstanceId,
  enabled = true,
}: UseAssessmentInstancesProps) {
  const [instances, setInstances] = useState<AssessmentInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carregar instances
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

      if (extractionInstanceId !== undefined) {
        if (extractionInstanceId === null) {
          query = query.is('extraction_instance_id', null);
        } else {
          query = query.eq('extraction_instance_id', extractionInstanceId);
        }
      }

      query = query.order('created_at', { ascending: false });

      const { data, error: queryError } = await query;

      if (queryError) throw queryError;

      setInstances(data || []);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('assessment', 'instanceLoadError');
        console.error('Assessment instances load error:', err);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId, articleId, instrumentId, extractionInstanceId]);

  // Carregar dados iniciais
  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

  // Criar nova instance
  const createInstance = useCallback(async (
    data: CreateAssessmentInstanceRequest
  ): Promise<AssessmentInstance | null> => {
    try {
      const { data: newInstance, error } = await supabase
        .from('assessment_instances')
        .insert({
          project_id: data.project_id,
          article_id: data.article_id,
          instrument_id: data.instrument_id,
          extraction_instance_id: data.extraction_instance_id || null,
          parent_instance_id: data.parent_instance_id || null,
          label: data.label,
          reviewer_id: (await supabase.auth.getUser()).data.user?.id || '',
          is_blind: data.is_blind ?? false,
          can_see_others: data.can_see_others ?? true,
          metadata: data.metadata || {},
          status: 'in_progress',
        })
        .select()
        .single();

      if (error) throw error;

      if (newInstance) {
        setInstances(prev => [newInstance, ...prev]);
          toast.success(t('assessment', 'instanceCreateSuccess'));
      }

      return newInstance;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('assessment', 'instanceCreateError');
        console.error('Error creating assessment instance:', err);
      toast.error(message);
      return null;
    }
  }, []);

  // Atualizar instance
  const updateInstance = useCallback(async (
    instanceId: string,
    updates: UpdateAssessmentInstanceRequest
  ): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('assessment_instances')
        .update({
          label: updates.label,
          status: updates.status,
          metadata: updates.metadata,
        })
        .eq('id', instanceId);

      if (error) throw error;

        // Update local state
      setInstances(prev =>
        prev.map(inst =>
          inst.id === instanceId
            ? { ...inst, ...updates }
            : inst
        )
      );

        toast.success(t('assessment', 'instanceUpdateSuccess'));
      return true;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('assessment', 'instanceUpdateError');
        console.error('Error updating instance:', err);
      toast.error(message);
      return false;
    }
  }, []);

  // Deletar instance
  const deleteInstance = useCallback(async (instanceId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('assessment_instances')
        .delete()
        .eq('id', instanceId);

      if (error) throw error;

      // Remover do estado local
      setInstances(prev => prev.filter(inst => inst.id !== instanceId));

        toast.success(t('assessment', 'instanceDeleteSuccess'));
      return true;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('assessment', 'instanceDeleteError');
        console.error('Error deleting instance:', err);
      toast.error(message);
      return false;
    }
  }, []);

  // Buscar instance por ID com responses carregadas
  const getInstanceWithResponses = useCallback(async (
    instanceId: string
  ): Promise<AssessmentInstance | null> => {
    try {
      const { data, error } = await supabase
        .from('assessment_instances')
        .select(`
          *,
          responses:assessment_responses(*)
        `)
        .eq('id', instanceId)
        .single();

      if (error) throw error;

      return data;
    } catch (err: unknown) {
        console.error('Error fetching instance:', err);
      return null;
    }
  }, []);

    // Fetch children of an instance (hierarchy)
  const getChildren = useCallback(async (
    parentInstanceId: string
  ): Promise<AssessmentInstance[]> => {
    try {
      const { data, error } = await supabase
        .from('assessment_instances')
        .select('*')
        .eq('parent_instance_id', parentInstanceId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return data || [];
    } catch (err: unknown) {
        console.error('Error fetching child instances:', err);
      return [];
    }
  }, []);

  // Marcar instance como submitted
  const submitInstance = useCallback(async (instanceId: string): Promise<boolean> => {
    return updateInstance(instanceId, { status: 'submitted' });
  }, [updateInstance]);

  // Memoizar instances root (sem parent)
  const rootInstances = useMemo(() => {
    return instances.filter(inst => inst.parent_instance_id === null);
  }, [instances]);

  return {
    instances,
    rootInstances,
    loading,
    error,

    // Actions
    createInstance,
    updateInstance,
    deleteInstance,
    submitInstance,

    // Queries
    getInstanceWithResponses,
    getChildren,

    // Reload
    reload: loadInstances,
  };
}
