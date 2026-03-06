/**
 * Hook to manage assessment responses
 *
 * Manages response state { itemId: response } with auto-save.
 * Similar to useExtractedValues but for assessment responses.
 *
 * Based on useExtractedValues.ts (DRY + KISS)
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
import {t} from '@/lib/copy';
import type { AssessmentResponse, AssessmentItem, AssessmentInstrumentType } from '@/types/assessment';
import { calculateAssessmentProgress, normalizeAssessmentResponses } from '@/lib/assessment-utils';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/**
 * Return type of the hook
 */
export interface UseAssessmentResponsesReturn {
    // Response state
  responses: Record<string, AssessmentResponse>;  // key: item_id
  assessmentId: string | null;

    // State
  loading: boolean;
  initialized: boolean;
  saving: boolean;
  error: string | null;

    // Functions
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
  toolType?: AssessmentInstrumentType;
  items?: AssessmentItem[];
  enabled?: boolean;
}

/**
 * Hook to manage assessment responses
 */
export function useAssessmentResponses({
  projectId,
  articleId,
  instrumentId,
  extractionInstanceId,
  toolType,
  items,
  enabled = true,
}: UseAssessmentResponsesProps): UseAssessmentResponsesReturn {
  // Estados
  const [responses, setResponses] = useState<Record<string, AssessmentResponse>>({});
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, loading: authLoading, requireUser } = useCurrentUser();

  /**
   * Loads existing user assessment
   */
  const loadResponses = useCallback(async () => {
    if (!enabled || !projectId || !articleId || !instrumentId || authLoading) {
      setResponses({});
      setAssessmentId(null);
      setLoading(false);
      setInitialized(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (!user) {
          throw new Error(t('common', 'errors_userNotAuthenticated'));
      }

        // Fetch existing assessment
      let query = supabase
        .from('assessments')
        .select('*')
        .eq('project_id', projectId)
        .eq('article_id', articleId)
        .eq('user_id', user.id)
        .eq('instrument_id', instrumentId)
        .eq('is_current_version', true);

        // Filter by extraction_instance_id if provided (PROBAST per model)
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
          throw new Error(`${t('assessment', 'errors_loadAssessment')}: ${fetchError.message}`);
      }

      if (data) {
        const normalizedResponses = normalizeAssessmentResponses(data.responses || {});
        setResponses(normalizedResponses);
        setAssessmentId(data.id);

        console.log('✅ [useAssessmentResponses] Respostas carregadas:', {
          assessmentId: data.id,
          responsesCount: Object.keys(data.responses || {}).length,
          status: data.status,
        });
      } else {
          // Assessment does not exist yet
        setResponses({});
        setAssessmentId(null);
        console.log('ℹ️ [useAssessmentResponses] Nenhum assessment encontrado, iniciando vazio');
      }

      setInitialized(true);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : t('common', 'errors_unknownError');
      console.error('❌ [useAssessmentResponses] Erro:', err);
      setError(errorMessage);
        toast.error(`${t('assessment', 'errors_loadResponses')}: ${errorMessage}`);
      setInitialized(false);
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId, articleId, instrumentId, extractionInstanceId, authLoading, user]);

  /**
   * Updates response locally (does not persist immediately)
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
   * Fetches specific response
   */
  const getResponse = useCallback((itemId: string): AssessmentResponse | undefined => {
    return responses[itemId];
  }, [responses]);

  /**
   * Save all responses to the database
   */
  const save = useCallback(async () => {
    if (!projectId || !articleId || !instrumentId) {
        console.warn('[useAssessmentResponses] Cannot save without IDs');
      return;
    }

    setSaving(true);

    try {
      const currentUser = requireUser();

      // Calcular completion_percentage
      const totalResponses = Object.keys(responses).length;
      const completionPercentage = items
        ? calculateAssessmentProgress(items, responses).progressPercentage
        : totalResponses;

      if (assessmentId) {
          // Update existing assessment
        const { error: updateError } = await supabase
          .from('assessments')
          .update({
            responses,
            completion_percentage: completionPercentage,
            updated_at: new Date().toISOString(),
          })
          .eq('id', assessmentId);

        if (updateError) {
            throw new Error(`${t('assessment', 'errors_updateAssessment')}: ${updateError.message}`);
        }

        console.log('✅ [useAssessmentResponses] Assessment atualizado:', {
          assessmentId,
          responsesCount: totalResponses,
        });
      } else {
          // Create new assessment
        const { data: newAssessment, error: insertError } = await supabase
          .from('assessments')
          .insert({
            project_id: projectId,
            article_id: articleId,
            user_id: currentUser.id,
            instrument_id: instrumentId,
            tool_type: toolType ?? 'CUSTOM',
            responses,
            status: 'in_progress',
            completion_percentage: completionPercentage,
            extraction_instance_id: extractionInstanceId || null,
            is_blind: false,
            is_current_version: true,
          })
          .select()
          .single();

        if (insertError) {
            throw new Error(`${t('assessment', 'errors_createAssessment')}: ${insertError.message}`);
        }

        setAssessmentId(newAssessment.id);

        console.log('✅ [useAssessmentResponses] Assessment criado:', {
          assessmentId: newAssessment.id,
          responsesCount: totalResponses,
        });
      }

        toast.success(t('assessment', 'headerSaved'));
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : t('common', 'errors_unknownError');
      console.error('❌ [useAssessmentResponses] Erro ao salvar:', err);
        toast.error(`${t('assessment', 'errors_saveResponses')}: ${errorMessage}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [projectId, articleId, instrumentId, extractionInstanceId, toolType, responses, assessmentId, items, requireUser]);

  /**
   * Refresh (recarrega do banco)
   */
  const refresh = useCallback(async () => {
    await loadResponses();
  }, [loadResponses]);

    // Effect to load responses when deps change
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
