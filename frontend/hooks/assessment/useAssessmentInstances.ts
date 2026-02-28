/**
 * Hook para gerenciar instâncias de assessment (Assessment 2.0)
 *
 * Análogo a useExtractionInstances. Gerencia APENAS instances
 * (criação, atualização, exclusão, hierarquia).
 *
 * Permite PROBAST por modelo via extraction_instance_id.
 *
 * @see useExtractionInstances - Hook análogo para extraction
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
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
      const message = err instanceof Error ? err.message : 'Erro ao carregar assessment instances';
      console.error('Erro ao carregar assessment instances:', err);
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
        toast.success('Assessment instance criada com sucesso');
      }

      return newInstance;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao criar assessment instance';
      console.error('Erro ao criar instance:', err);
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

      // Atualizar estado local
      setInstances(prev =>
        prev.map(inst =>
          inst.id === instanceId
            ? { ...inst, ...updates }
            : inst
        )
      );

      toast.success('Instance atualizada');
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao atualizar instance';
      console.error('Erro ao atualizar instance:', err);
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

      toast.success('Instance deletada');
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao deletar instance';
      console.error('Erro ao deletar instance:', err);
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
      const message = err instanceof Error ? err.message : 'Erro ao buscar instance';
      console.error('Erro ao buscar instance:', err);
      return null;
    }
  }, []);

  // Buscar children de uma instance (hierarquia)
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
      console.error('Erro ao buscar children:', err);
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
