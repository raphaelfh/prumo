import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { useErrorTracking } from '@/services/errorTracking';

export type AIPromptConfig = Tables<'ai_assessment_prompts'>;

interface UseAIPromptConfigProps {
  assessmentItemId: string;
}

interface UseAIPromptConfigReturn {
  promptConfig: AIPromptConfig | null;
  loading: boolean;
  error: string | null;
  savePromptConfig: (configData: Partial<AIPromptConfig>) => Promise<void>;
  updatePromptConfig: (updates: Partial<AIPromptConfig>) => Promise<void>;
  deletePromptConfig: () => Promise<void>;
  resetToDefaults: () => Promise<void>;
}

const DEFAULT_SYSTEM_PROMPT = `You are an expert research quality assessor. Read the PDF and answer the specific question based on the evidence found in the document. Quote page numbers when possible.`;

const DEFAULT_USER_PROMPT_TEMPLATE = `Based on the article PDF, assess: {{question}}

Available response levels: {{levels}}

Please provide your assessment with:
1. Your selected level
2. Confidence score (0-1)
3. Clear justification
4. Evidence passages with page numbers

Return your response in the following JSON format:
{
  "selected_level": "your_choice",
  "confidence_score": 0.95,
  "justification": "your_reasoning",
  "evidence_passages": [
    {
      "text": "relevant_text_excerpt",
      "page_number": 1,
      "relevance_score": 0.9
    }
  ]
}`;

export const useAIPromptConfig = ({
  assessmentItemId,
}: UseAIPromptConfigProps): UseAIPromptConfigReturn => {
  const [promptConfig, setPromptConfig] = useState<AIPromptConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { captureError } = useErrorTracking();

  const loadPromptConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('ai_assessment_prompts')
        .select('*')
        .eq('assessment_item_id', assessmentItemId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      setPromptConfig(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMessage);
      captureError(err instanceof Error ? err : new Error(errorMessage), {
        component: 'useAIPromptConfig',
        action: 'loadPromptConfig',
        assessmentItemId,
      });
    } finally {
      setLoading(false);
    }
  }, [assessmentItemId, captureError]);

  const savePromptConfig = useCallback(async (configData: Partial<AIPromptConfig>) => {
    try {
      setError(null);

      const { data, error: saveError } = await supabase
        .from('ai_assessment_prompts')
        .insert({
          assessment_item_id: assessmentItemId,
          system_prompt: configData.system_prompt || DEFAULT_SYSTEM_PROMPT,
          user_prompt_template: configData.user_prompt_template || DEFAULT_USER_PROMPT_TEMPLATE,
        })
        .select()
        .single();

      if (saveError) throw saveError;

      setPromptConfig(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao salvar configuração de prompt';
      setError(errorMessage);
      captureError(err instanceof Error ? err : new Error(errorMessage), {
        component: 'useAIPromptConfig',
        action: 'savePromptConfig',
        assessmentItemId,
      });
      throw err;
    }
  }, [assessmentItemId, captureError]);

  const updatePromptConfig = useCallback(async (updates: Partial<AIPromptConfig>) => {
    if (!promptConfig) {
      throw new Error('Nenhuma configuração de prompt encontrada para atualizar');
    }

    try {
      setError(null);

      const { data, error: updateError } = await supabase
        .from('ai_assessment_prompts')
        .update(updates)
        .eq('id', promptConfig.id)
        .select()
        .single();

      if (updateError) throw updateError;

      setPromptConfig(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao atualizar configuração de prompt';
      setError(errorMessage);
      captureError(err instanceof Error ? err : new Error(errorMessage), {
        component: 'useAIPromptConfig',
        action: 'updatePromptConfig',
        assessmentItemId,
      });
      throw err;
    }
  }, [promptConfig, captureError]);

  const deletePromptConfig = useCallback(async () => {
    if (!promptConfig) {
      throw new Error('Nenhuma configuração de prompt encontrada para deletar');
    }

    try {
      setError(null);

      const { error: deleteError } = await supabase
        .from('ai_assessment_prompts')
        .delete()
        .eq('id', promptConfig.id);

      if (deleteError) throw deleteError;

      setPromptConfig(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao deletar configuração de prompt';
      setError(errorMessage);
      captureError(err instanceof Error ? err : new Error(errorMessage), {
        component: 'useAIPromptConfig',
        action: 'deletePromptConfig',
        assessmentItemId,
      });
      throw err;
    }
  }, [promptConfig, captureError]);

  const resetToDefaults = useCallback(async () => {
    try {
      setError(null);

      if (promptConfig) {
        await updatePromptConfig({
          system_prompt: DEFAULT_SYSTEM_PROMPT,
          user_prompt_template: DEFAULT_USER_PROMPT_TEMPLATE,
        });
      } else {
        await savePromptConfig({
          system_prompt: DEFAULT_SYSTEM_PROMPT,
          user_prompt_template: DEFAULT_USER_PROMPT_TEMPLATE,
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao resetar para padrões';
      setError(errorMessage);
      captureError(err instanceof Error ? err : new Error(errorMessage), {
        component: 'useAIPromptConfig',
        action: 'resetToDefaults',
        assessmentItemId,
      });
      throw err;
    }
  }, [promptConfig, savePromptConfig, updatePromptConfig, captureError]);

  useEffect(() => {
    loadPromptConfig();
  }, [loadPromptConfig]);

  return {
    promptConfig,
    loading,
    error,
    savePromptConfig,
    updatePromptConfig,
    deletePromptConfig,
    resetToDefaults,
  };
};
