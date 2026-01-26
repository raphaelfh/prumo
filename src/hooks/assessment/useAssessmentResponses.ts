/**
 * Hook para gerenciar respostas de assessment
 *
 * Gerencia estado de respostas { itemId: response } com auto-save.
 * Similar ao useExtractedValues mas para assessment responses.
 *
 * Baseado em useExtractedValues.ts (DRY + KISS)
 *
 * @example
 * ```typescript
 * const {
 *   responses,
 *   updateResponse,
 *   loading,
 *   save
 * } = useAssessmentResponses({
 *   projectId,
 *   articleId,
 *   instrumentId,
 * });
 * ```
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type {
  AssessmentResponse,
  Assessment,
  AssessmentLevel,
  EvidencePassage,
} from '@/types/assessment';

/**
 * Retorno do hook
 */
export interface UseAssessmentResponsesReturn {
  // Estado de respostas
  responses: Record<string, AssessmentResponse>;  // key: item_id
  assessmentId: string | null;

  // Estados
  loading: boolean;
  initialized: boolean;
  saving: boolean;
  error: string | null;

  // Funções
  updateResponse: (itemId: string, response: Partial<AssessmentResponse>) => void;
  getResponse: (itemId: string) => AssessmentResponse | undefined;
  save: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Props do hook
 */
export interface UseAssessmentResponsesProps {
  projectId: string | undefined;
  articleId: string | undefined;
  instrumentId: string | undefined;
  extractionInstanceId?: string;  // Para PROBAST por modelo
  enabled?: boolean;
}

/**
 * Hook para gerenciar respostas de assessment
 */
export function useAssessmentResponses({
  projectId,
  articleId,
  instrumentId,
  extractionInstanceId,
  enabled = true,
}: UseAssessmentResponsesProps): UseAssessmentResponsesReturn {
  // Estados
  const [responses, setResponses] = useState<Record<string, AssessmentResponse>>({});
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Carrega assessment existente do usuário
   */
  const loadResponses = useCallback(async () => {
    if (!enabled || !projectId || !articleId || !instrumentId) {
      setResponses({});
      setAssessmentId(null);
      setLoading(false);
      setInitialized(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      // Buscar assessment existente
      let query = supabase
        .from('assessments')
        .select('*')
        .eq('project_id', projectId)
        .eq('article_id', articleId)
        .eq('user_id', user.id)
        .eq('instrument_id', instrumentId);

      // Filtrar por extraction_instance_id se fornecido (PROBAST por modelo)
      if (extractionInstanceId) {
        query = query.eq('extraction_instance_id', extractionInstanceId);
      } else {
        query = query.is('extraction_instance_id', null);
      }

      const { data, error: fetchError } = await query
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        console.error('❌ [useAssessmentResponses] Erro ao carregar assessment:', fetchError);
        throw new Error(`Erro ao carregar assessment: ${fetchError.message}`);
      }

      if (data) {
        setResponses(data.responses || {});
        setAssessmentId(data.id);

        console.log('✅ [useAssessmentResponses] Respostas carregadas:', {
          assessmentId: data.id,
          responsesCount: Object.keys(data.responses || {}).length,
          status: data.status,
        });
      } else {
        // Assessment ainda não existe
        setResponses({});
        setAssessmentId(null);
        console.log('ℹ️ [useAssessmentResponses] Nenhum assessment encontrado, iniciando vazio');
      }

      setInitialized(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      console.error('❌ [useAssessmentResponses] Erro:', err);
      setError(errorMessage);
      toast.error(`Erro ao carregar respostas: ${errorMessage}`);
      setInitialized(false);
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId, articleId, instrumentId, extractionInstanceId]);

  /**
   * Atualiza resposta localmente (não persiste imediatamente)
   */
  const updateResponse = useCallback((itemId: string, partialResponse: Partial<AssessmentResponse>) => {
    setResponses(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        item_id: itemId,
        ...partialResponse,
      } as AssessmentResponse,
    }));

    console.log('📝 [useAssessmentResponses] Resposta atualizada localmente:', {
      itemId,
      response: partialResponse,
    });
  }, []);

  /**
   * Busca resposta específica
   */
  const getResponse = useCallback((itemId: string): AssessmentResponse | undefined => {
    return responses[itemId];
  }, [responses]);

  /**
   * Salva todas as respostas no banco
   */
  const save = useCallback(async () => {
    if (!projectId || !articleId || !instrumentId) {
      console.warn('⚠️ [useAssessmentResponses] Impossível salvar sem IDs');
      return;
    }

    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      // Calcular completion_percentage
      const totalResponses = Object.keys(responses).length;
      const completionPercentage = totalResponses; // TODO: Calcular baseado em total de items

      if (assessmentId) {
        // Atualizar assessment existente
        const { error: updateError } = await supabase
          .from('assessments')
          .update({
            responses,
            completion_percentage: completionPercentage,
            updated_at: new Date().toISOString(),
          })
          .eq('id', assessmentId);

        if (updateError) {
          throw new Error(`Erro ao atualizar assessment: ${updateError.message}`);
        }

        console.log('✅ [useAssessmentResponses] Assessment atualizado:', {
          assessmentId,
          responsesCount: totalResponses,
        });
      } else {
        // Criar novo assessment
        const { data: newAssessment, error: insertError } = await supabase
          .from('assessments')
          .insert({
            project_id: projectId,
            article_id: articleId,
            user_id: user.id,
            instrument_id: instrumentId,
            tool_type: 'PROBAST', // TODO: Detectar do instrumento
            responses,
            status: 'in_progress',
            completion_percentage: completionPercentage,
            extraction_instance_id: extractionInstanceId || null,
            is_blind: false,
          })
          .select()
          .single();

        if (insertError) {
          throw new Error(`Erro ao criar assessment: ${insertError.message}`);
        }

        setAssessmentId(newAssessment.id);

        console.log('✅ [useAssessmentResponses] Assessment criado:', {
          assessmentId: newAssessment.id,
          responsesCount: totalResponses,
        });
      }

      toast.success('Respostas salvas com sucesso');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      console.error('❌ [useAssessmentResponses] Erro ao salvar:', err);
      toast.error(`Erro ao salvar respostas: ${errorMessage}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [projectId, articleId, instrumentId, extractionInstanceId, responses, assessmentId]);

  /**
   * Refresh (recarrega do banco)
   */
  const refresh = useCallback(async () => {
    await loadResponses();
  }, [loadResponses]);

  // Effect para carregar respostas quando deps mudarem
  useEffect(() => {
    loadResponses();
  }, [loadResponses]);

  return {
    responses,
    assessmentId,
    loading,
    initialized,
    saving,
    error,
    updateResponse,
    getResponse,
    save,
    refresh,
  };
}
