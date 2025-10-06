import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { useErrorTracking } from '@/services/errorTracking';

export type AIConfiguration = Tables<'ai_assessment_configs'>;

interface UseAIAssessmentConfigProps {
  projectId: string;
  instrumentId?: string;
}

interface UseAIAssessmentConfigReturn {
  config: AIConfiguration | null;
  loading: boolean;
  error: string | null;
  saveConfig: (configData: Partial<AIConfiguration>) => Promise<void>;
  updateConfig: (updates: Partial<AIConfiguration>) => Promise<void>;
  deleteConfig: () => Promise<void>;
}

export const useAIAssessmentConfig = ({
  projectId,
  instrumentId,
}: UseAIAssessmentConfigProps): UseAIAssessmentConfigReturn => {
  const [config, setConfig] = useState<AIConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { captureError } = useErrorTracking();

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('ai_assessment_configs')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_active', true);

      if (instrumentId) {
        query = query.eq('instrument_id', instrumentId);
      } else {
        query = query.is('instrument_id', null);
      }

      const { data, error: fetchError } = await query.maybeSingle();

      if (fetchError) throw fetchError;

      setConfig(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMessage);
      captureError(err instanceof Error ? err : new Error(errorMessage), {
        component: 'useAIAssessmentConfig',
        action: 'loadConfig',
        projectId,
        instrumentId,
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, instrumentId, captureError]);

  const saveConfig = useCallback(async (configData: Partial<AIConfiguration>) => {
    try {
      setError(null);

      const { data, error: saveError } = await supabase
        .from('ai_assessment_configs')
        .insert({
          project_id: projectId,
          instrument_id: instrumentId || null,
          ...configData,
          is_active: true,
        })
        .select()
        .single();

      if (saveError) throw saveError;

      setConfig(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao salvar configuração';
      setError(errorMessage);
      captureError(err instanceof Error ? err : new Error(errorMessage), {
        component: 'useAIAssessmentConfig',
        action: 'saveConfig',
        projectId,
        instrumentId,
      });
      throw err;
    }
  }, [projectId, instrumentId, captureError]);

  const updateConfig = useCallback(async (updates: Partial<AIConfiguration>) => {
    if (!config) {
      throw new Error('Nenhuma configuração encontrada para atualizar');
    }

    try {
      setError(null);

      const { data, error: updateError } = await supabase
        .from('ai_assessment_configs')
        .update(updates)
        .eq('id', config.id)
        .select()
        .single();

      if (updateError) throw updateError;

      setConfig(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao atualizar configuração';
      setError(errorMessage);
      captureError(err instanceof Error ? err : new Error(errorMessage), {
        component: 'useAIAssessmentConfig',
        action: 'updateConfig',
        projectId,
        instrumentId,
      });
      throw err;
    }
  }, [config, captureError]);

  const deleteConfig = useCallback(async () => {
    if (!config) {
      throw new Error('Nenhuma configuração encontrada para deletar');
    }

    try {
      setError(null);

      const { error: deleteError } = await supabase
        .from('ai_assessment_configs')
        .delete()
        .eq('id', config.id);

      if (deleteError) throw deleteError;

      setConfig(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao deletar configuração';
      setError(errorMessage);
      captureError(err instanceof Error ? err : new Error(errorMessage), {
        component: 'useAIAssessmentConfig',
        action: 'deleteConfig',
        projectId,
        instrumentId,
      });
      throw err;
    }
  }, [config, captureError]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return {
    config,
    loading,
    error,
    saveConfig,
    updateConfig,
    deleteConfig,
  };
};
