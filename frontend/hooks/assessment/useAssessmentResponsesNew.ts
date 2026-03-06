/**
 * Hook to manage assessment responses (Assessment 2.0)
 *
 * Analogous to useExtractionData. Manages individual responses
 * (granularity: 1 row = 1 response).
 *
 * Allows linking responses to specific assessment instances
 * (useful for PROBAST per model).
 *
 * @see useExtractionData - Analogous hook for extraction
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  AssessmentResponseNew,
  CreateAssessmentResponseRequest,
  UpdateAssessmentResponseRequest,
  BulkCreateAssessmentResponsesRequest,
  AssessmentSource,
} from '@/types/assessment';
import {t} from '@/lib/copy';

interface UseAssessmentResponsesNewProps {
  assessmentInstanceId?: string;
  articleId?: string;
  projectId?: string;
  enabled?: boolean;
}

export function useAssessmentResponsesNew({
  assessmentInstanceId,
  articleId,
  projectId,
  enabled = true,
}: UseAssessmentResponsesNewProps) {
  const [responses, setResponses] = useState<AssessmentResponseNew[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carregar responses
  const loadResponses = useCallback(async () => {
    if (!enabled) {
      setResponses([]);
      return;
    }

    // Precisa de pelo menos um filtro
    if (!assessmentInstanceId && !articleId && !projectId) {
      setResponses([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('assessment_responses')
        .select('*');

      if (assessmentInstanceId) {
        query = query.eq('assessment_instance_id', assessmentInstanceId);
      } else if (articleId) {
        query = query.eq('article_id', articleId);
      } else if (projectId) {
        query = query.eq('project_id', projectId);
      }

      query = query.order('created_at', { ascending: true });

      const { data, error: queryError } = await query;

      if (queryError) throw queryError;

      setResponses(data || []);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('assessment', 'errors_loadResponses');
        console.error('Error loading assessment responses:', err);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [enabled, assessmentInstanceId, articleId, projectId]);

  // Carregar dados iniciais
  useEffect(() => {
    loadResponses();
  }, [loadResponses]);

  // Criar nova response
  const createResponse = useCallback(async (
    data: CreateAssessmentResponseRequest
  ): Promise<AssessmentResponseNew | null> => {
    try {
      const user = await supabase.auth.getUser();
      const reviewerId = user.data.user?.id;

      if (!reviewerId) {
          throw new Error(t('common', 'errors_userNotAuthenticated'));
      }

      const { data: newResponse, error } = await supabase
        .from('assessment_responses')
        .insert({
          project_id: data.project_id,
          article_id: data.article_id,
          assessment_instance_id: data.assessment_instance_id,
          assessment_item_id: data.assessment_item_id,
          selected_level: data.selected_level,
          notes: data.notes || null,
          confidence: data.confidence || null,
          source: data.source || 'human',
          ai_suggestion_id: data.ai_suggestion_id || null,
          reviewer_id: reviewerId,
          is_consensus: false,
        })
        .select()
        .single();

      if (error) throw error;

      if (newResponse) {
        setResponses(prev => [...prev, newResponse]);
      }

      return newResponse;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('assessment', 'errors_createResponse');
        console.error('Error creating response:', err);
      toast.error(message);
      return null;
    }
  }, []);

    // Create multiple responses in batch
  const bulkCreateResponses = useCallback(async (
    data: BulkCreateAssessmentResponsesRequest
  ): Promise<AssessmentResponseNew[]> => {
    try {
      const user = await supabase.auth.getUser();
      const reviewerId = user.data.user?.id;

      if (!reviewerId) {
          throw new Error(t('common', 'errors_userNotAuthenticated'));
      }

      const responsesToInsert = data.responses.map(response => ({
        project_id: data.project_id,
        article_id: data.article_id,
        assessment_instance_id: data.assessment_instance_id,
        assessment_item_id: response.assessment_item_id,
        selected_level: response.selected_level,
        notes: response.notes || null,
        confidence: response.confidence || null,
        source: response.source || 'human',
        ai_suggestion_id: response.ai_suggestion_id || null,
        reviewer_id: reviewerId,
        is_consensus: false,
      }));

      const { data: newResponses, error } = await supabase
        .from('assessment_responses')
        .insert(responsesToInsert)
        .select();

      if (error) throw error;

      if (newResponses) {
        setResponses(prev => [...prev, ...newResponses]);
          toast.success(t('assessment', 'responsesCreatedCount').replace('{{n}}', String(newResponses.length)));
      }

      return newResponses || [];
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('assessment', 'errors_createResponsesBatch');
        console.error('Error creating responses in batch:', err);
      toast.error(message);
      return [];
    }
  }, []);

  // Atualizar response
  const updateResponse = useCallback(async (
    responseId: string,
    updates: UpdateAssessmentResponseRequest
  ): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('assessment_responses')
        .update({
          selected_level: updates.selected_level,
          notes: updates.notes,
          confidence: updates.confidence,
          is_consensus: updates.is_consensus,
        })
        .eq('id', responseId);

      if (error) throw error;

        // Update local state
      setResponses(prev =>
        prev.map(resp =>
          resp.id === responseId
            ? { ...resp, ...updates }
            : resp
        )
      );

      return true;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('assessment', 'errors_updateResponse');
        console.error('Error updating response:', err);
      toast.error(message);
      return false;
    }
  }, []);

  // Deletar response
  const deleteResponse = useCallback(async (responseId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('assessment_responses')
        .delete()
        .eq('id', responseId);

      if (error) throw error;

      // Remover do estado local
      setResponses(prev => prev.filter(resp => resp.id !== responseId));

      return true;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('assessment', 'errors_deleteResponse');
        console.error('Error deleting response:', err);
      toast.error(message);
      return false;
    }
  }, []);

    // Fetch specific response by instance + item
  const getResponseByInstanceAndItem = useCallback(async (
    instanceId: string,
    itemId: string
  ): Promise<AssessmentResponseNew | null> => {
    try {
      const { data, error } = await supabase
        .from('assessment_responses')
        .select('*')
        .eq('assessment_instance_id', instanceId)
        .eq('assessment_item_id', itemId)
        .maybeSingle();

      if (error) throw error;

      return data;
    } catch (err: unknown) {
        console.error('Error fetching response:', err);
      return null;
    }
  }, []);

    // Upsert response (update if exists, create if not)
  const upsertResponse = useCallback(async (
    data: CreateAssessmentResponseRequest
  ): Promise<AssessmentResponseNew | null> => {
    try {
        // Check if already exists
      const existing = await getResponseByInstanceAndItem(
        data.assessment_instance_id,
        data.assessment_item_id
      );

      if (existing) {
        // Update
        const success = await updateResponse(existing.id, {
          selected_level: data.selected_level,
          notes: data.notes,
          confidence: data.confidence,
        });

        if (success) {
          return { ...existing, ...data };
        }
        return null;
      } else {
        // Create
        return await createResponse(data);
      }
    } catch (err: unknown) {
      console.error('Erro ao upsert response:', err);
      return null;
    }
  }, [getResponseByInstanceAndItem, updateResponse, createResponse]);

    // Statistics
  const stats = useMemo(() => {
    const bySource = responses.reduce((acc, resp) => {
      acc[resp.source] = (acc[resp.source] || 0) + 1;
      return acc;
    }, {} as Record<AssessmentSource, number>);

    const byLevel = responses.reduce((acc, resp) => {
      acc[resp.selected_level] = (acc[resp.selected_level] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total: responses.length,
      bySource,
      byLevel,
      withNotes: responses.filter(r => r.notes).length,
      consensus: responses.filter(r => r.is_consensus).length,
    };
  }, [responses]);

  return {
    responses,
    loading,
    error,
    stats,

    // Actions
    createResponse,
    bulkCreateResponses,
    updateResponse,
    deleteResponse,
    upsertResponse,

    // Queries
    getResponseByInstanceAndItem,

    // Reload
    reload: loadResponses,
  };
}
