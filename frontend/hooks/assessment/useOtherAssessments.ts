import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import type {AssessmentResponseValue} from '@/types/assessment';

export interface OtherAssessment {
  id: string;
  article_id: string;
  user_id: string;
  instrument_id: string;
  responses: Record<string, AssessmentResponseValue>;
  status: string;
  completion_percentage: number;
  user_name?: string;
  user_email?: string;
  extraction_instance_id?: string | null; // Novo: para assessment por instância
}

export const useOtherAssessments = (
  projectId: string, 
  currentUserId: string,
  enabled: boolean
) => {
  const [otherAssessments, setOtherAssessments] = useState<OtherAssessment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOtherAssessments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Busca assessments de outros usuários (excluindo o usuário atual)
      const { data, error } = await supabase
        .from('assessments')
        .select(`
          id,
          article_id,
          user_id,
          instrument_id,
          responses,
          status,
          completion_percentage,
          extraction_instance_id,
          profiles!inner(
            full_name,
            email
          )
        `)
        .eq('project_id', projectId)
        .neq('user_id', currentUserId)
        .in('status', ['in_progress', 'submitted'])
        .eq('is_blind', false);

      if (error) throw error;

      // Transforma os dados para incluir informações do usuário
      const transformedData: OtherAssessment[] = data.map(assessment => ({
        id: assessment.id,
        article_id: assessment.article_id,
        user_id: assessment.user_id,
        instrument_id: assessment.instrument_id,
        responses: assessment.responses as Record<string, AssessmentResponseValue>,
        status: assessment.status,
        completion_percentage: assessment.completion_percentage,
        extraction_instance_id: assessment.extraction_instance_id,
        user_name: assessment.profiles?.full_name || 'Usuário',
        user_email: assessment.profiles?.email || ''
      }));

      setOtherAssessments(transformedData);
    } catch (error: unknown) {
      console.error('Error loading other assessments:', error);
      setError(error instanceof Error ? error.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }, [projectId, currentUserId]);

  useEffect(() => {
    if (enabled && projectId && currentUserId) {
      loadOtherAssessments();
    } else {
      setOtherAssessments([]);
    }
  }, [enabled, projectId, currentUserId, loadOtherAssessments]);

  const getOtherAssessmentsForArticle = (
    articleId: string, 
    instrumentId: string
  ): OtherAssessment[] => {
    return otherAssessments.filter(
      assessment => 
        assessment.article_id === articleId && 
        assessment.instrument_id === instrumentId
    );
  };

  const getOtherAssessmentsForItem = (
    articleId: string,
    instrumentId: string,
    itemId: string
  ): Array<{ user_name: string; response: AssessmentResponseValue }> => {
    const articleAssessments = getOtherAssessmentsForArticle(articleId, instrumentId);
    
    return articleAssessments
      .filter(assessment => assessment.responses?.[itemId])
      .map(assessment => ({
        user_name: assessment.user_name || 'Usuário',
        response: assessment.responses[itemId]
      }));
  };

  /**
   * Novo: Buscar assessments de outros usuários para uma instância específica
   */
  const getOtherAssessmentsForInstance = (
    extractionInstanceId: string,
    instrumentId: string
  ): OtherAssessment[] => {
    return otherAssessments.filter(
      assessment => 
        assessment.extraction_instance_id === extractionInstanceId && 
        assessment.instrument_id === instrumentId
    );
  };

  /**
   * Novo: Buscar respostas de outros para um item específico de uma instância
   */
  const getOtherAssessmentsForInstanceItem = (
    extractionInstanceId: string,
    instrumentId: string,
    itemId: string
  ): Array<{ user_name: string; response: AssessmentResponseValue }> => {
    const instanceAssessments = getOtherAssessmentsForInstance(extractionInstanceId, instrumentId);
    
    return instanceAssessments
      .filter(assessment => assessment.responses?.[itemId])
      .map(assessment => ({
        user_name: assessment.user_name || 'Usuário',
        response: assessment.responses[itemId]
      }));
  };

  return {
    otherAssessments,
    loading,
    error,
    getOtherAssessmentsForArticle,
    getOtherAssessmentsForItem,
    getOtherAssessmentsForInstance,
    getOtherAssessmentsForInstanceItem,
    refresh: loadOtherAssessments
  };
};
