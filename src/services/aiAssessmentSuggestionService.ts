/**
 * Service para Gerenciamento de Sugestões de IA para Assessment
 *
 * Centraliza todas as operações de banco de dados relacionadas a sugestões de IA
 * para avaliação de qualidade (PROBAST, QUADAS-2, ROB-2, etc.)
 *
 * Baseado em aiSuggestionService.ts (DRY + KISS)
 *
 * FOCUS: Assessment AI suggestions workflow
 *
 * @example
 * ```typescript
 * // Carregar sugestões para um artigo
 * const result = await AIAssessmentSuggestionService.loadSuggestions({
 *   articleId: '...',
 *   projectId: '...',
 *   instrumentId: '...',
 * });
 *
 * // Aceitar uma sugestão
 * await AIAssessmentSuggestionService.acceptSuggestion({
 *   suggestionId: '...',
 *   projectId: '...',
 *   articleId: '...',
 *   itemId: '...',
 *   value: { level: 'Low', evidence_passages: [] },
 *   confidence: 0.95,
 *   reviewerId: '...',
 * });
 * ```
 */

import { supabase } from '@/integrations/supabase/client';
import { queryBuilder, handleSupabaseError } from '@/lib/supabase/baseRepository';
import type {
  AIAssessmentSuggestion,
  AIAssessmentSuggestionRaw,
  AIAssessmentSuggestionHistoryItem,
  AssessmentSuggestionStatus,
  AssessmentLevel,
  EvidencePassage,
} from '@/types/assessment';
import {
  getAssessmentSuggestionKey,
  normalizeAIAssessmentSuggestion,
} from '@/lib/assessment-utils';
import {
  APIError,
  SuggestionNotFoundError,
} from '@/lib/ai-extraction/errors';

/**
 * Resultado de loadSuggestions
 */
export interface LoadAssessmentSuggestionsResult {
  suggestions: Record<string, AIAssessmentSuggestion>;  // key: ai_suggestion_${itemId}
  count: number;
}

/**
 * Parâmetros para acceptSuggestion
 */
export interface AcceptAssessmentSuggestionParams {
  suggestionId: string;
  projectId: string;
  articleId: string;
  itemId: string;
  value: {
    level: AssessmentLevel;
    evidence_passages: EvidencePassage[];
  };
  confidence: number;
  reviewerId: string;
  instrumentId?: string;
  extractionInstanceId?: string;
}

/**
 * Parâmetros para rejectSuggestion
 */
export interface RejectAssessmentSuggestionParams {
  suggestionId: string;
  reviewerId: string;
  wasAccepted?: boolean;
  itemId?: string;
  projectId?: string;
  articleId?: string;
  instrumentId?: string;
  extractionInstanceId?: string;
}

type AIAssessmentSuggestionRow = AIAssessmentSuggestionRaw & {
  ai_assessment_runs?: {
    project_id: string;
    article_id: string;
    instrument_id: string;
    extraction_instance_id: string | null;
  } | null;
};

const normalizeId = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Service para operações com sugestões de IA para assessment
 */
export class AIAssessmentSuggestionService {
  /**
   * Carrega sugestões de IA para um artigo
   *
   * Busca sugestões pendentes, aceitas e rejeitadas para assessment_items.
   * Diferente do extraction, não precisa filtrar por instâncias, filtra por instrument_id.
   *
   * @param params - Parâmetros de busca
   * @param params.articleId - ID do artigo
   * @param params.projectId - ID do projeto
   * @param params.instrumentId - ID do instrumento (opcional, filtra por instrumento)
   * @param params.extractionInstanceId - ID da extraction instance (opcional, para PROBAST por modelo)
   * @param params.statuses - Statuses para filtrar
   * @returns Mapa de sugestões indexadas por `ai_suggestion_${itemId}`
   */
  static async loadSuggestions(params: {
    articleId: string;
    projectId: string;
    instrumentId?: string;
    extractionInstanceId?: string;
    statuses?: AssessmentSuggestionStatus[];
  }): Promise<LoadAssessmentSuggestionsResult> {
    const { articleId, projectId, instrumentId, extractionInstanceId, statuses = ['pending', 'accepted', 'rejected'] } = params;

    // Query ai_suggestions com assessment_item_id NOT NULL (filtra assessment suggestions)
    // + JOIN com ai_assessment_runs para filtrar por projectId/articleId

    const query = supabase
      .from('ai_suggestions')
      .select(`
        *,
        ai_assessment_runs!ai_suggestions_assessment_run_id_fkey!inner (
          project_id,
          article_id,
          instrument_id,
          extraction_instance_id
        )
      `)
      .not('assessment_item_id', 'is', null)
      .in('status', statuses);

    // Filtros via JOIN
    if (projectId) {
      query.eq('ai_assessment_runs.project_id', projectId);
    }

    if (articleId) {
      query.eq('ai_assessment_runs.article_id', articleId);
    }

    if (instrumentId) {
      query.eq('ai_assessment_runs.instrument_id', instrumentId);
    }

    if (extractionInstanceId) {
      query.eq('ai_assessment_runs.extraction_instance_id', extractionInstanceId);
    }

    query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('❌ [loadSuggestions] Erro ao carregar sugestões:', error);
      throw new APIError(`Erro ao carregar sugestões: ${error.message}`);
    }

    // Mapear para formato { ai_suggestion_${itemId}: suggestion }
    // Manter apenas a mais recente por item
    const suggestionsMap: Record<string, AIAssessmentSuggestion> = {};

    console.log(`📊 [loadSuggestions] Processando ${(data || []).length} sugestão(ões) do banco`);

    const rows = (data || []) as AIAssessmentSuggestionRow[];

    rows.forEach((item) => {
      if (!item.assessment_item_id) {
        console.warn('⚠️ [loadSuggestions] Sugestão sem assessment_item_id ignorada:', {
          suggestionId: item.id,
          status: item.status
        });
        return;
      }

      const key = getAssessmentSuggestionKey(item.assessment_item_id);

      // Só adiciona se ainda não existe (mantém a mais recente)
      if (!suggestionsMap[key]) {
        suggestionsMap[key] = normalizeAIAssessmentSuggestion(item);
        console.log(`✅ [loadSuggestions] Sugestão adicionada: ${key}`, {
          status: item.status,
          itemId: item.assessment_item_id,
        });
      } else {
        console.log(`⏭️ [loadSuggestions] Sugestão mais recente já existe para ${key}, ignorando esta`);
      }
    });

    const finalCount = Object.keys(suggestionsMap).length;
    console.log(`🎯 [loadSuggestions] Total de ${finalCount} sugestão(ões) únicas mapeadas`);

    return {
      suggestions: suggestionsMap,
      count: finalCount,
    };
  }

  /**
   * Busca histórico completo de sugestões para um item específico
   *
   * @param itemId - ID do assessment item
   * @param limit - Limite de resultados (padrão: 10)
   * @returns Lista de sugestões ordenadas por data (mais recente primeiro)
   */
  static async getHistory(
    itemId: string,
    limit: number = 10
  ): Promise<AIAssessmentSuggestionHistoryItem[]> {
    const { data, error } = await queryBuilder<AIAssessmentSuggestionRaw>(
      'ai_suggestions',
      {
        select: '*',
        filters: {
          assessment_item_id: itemId,
        },
        orderBy: { column: 'created_at', ascending: false },
        limit,
      }
    );

    if (error) {
      console.error('❌ [getHistory] Erro ao buscar histórico:', error);
      throw new APIError(`Erro ao buscar histórico: ${error.message}`);
    }

    return (data || []).map(item => ({
      id: item.id,
      value: typeof item.suggested_value === 'object' && 'level' in item.suggested_value
        ? item.suggested_value
        : { level: String(item.suggested_value), evidence_passages: [] },
      confidence: item.confidence_score ?? 0,
      reasoning: item.reasoning ?? '',
      status: item.status,
      timestamp: new Date(item.created_at),
      reviewedBy: item.reviewed_by ?? undefined,
      reviewedAt: item.reviewed_at ? new Date(item.reviewed_at) : undefined,
    }));
  }

  /**
   * Aceita uma sugestão de IA
   *
   * Workflow:
   * 1. Verifica se já existe assessment_response (poderia ter sido aceita antes)
   * 2. Se não existir: cria novo assessment ou atualiza existente
   * 3. Atualiza status da sugestão para 'accepted'
   * 4. Marca reviewed_by e reviewed_at
   *
   * @param params - Parâmetros da aceitação
   * @throws {SuggestionNotFoundError} Se sugestão não for encontrada
   * @throws {APIError} Se houver erro na operação
   */
  static async acceptSuggestion(params: AcceptAssessmentSuggestionParams): Promise<void> {
    const { suggestionId, projectId, articleId, itemId, value, confidence, reviewerId, instrumentId, extractionInstanceId } = params;

    console.log('✅ [acceptSuggestion] Iniciando aceitação:', {
      suggestionId,
      itemId,
      reviewerId,
    });

    // 1. Buscar sugestão para verificar se existe
    const { data: suggestion, error: fetchError } = await supabase
      .from('ai_suggestions')
      .select('*')
      .eq('id', suggestionId)
      .single();

    if (fetchError || !suggestion) {
      throw new SuggestionNotFoundError(`Sugestão ${suggestionId} não encontrada`);
    }

    let resolvedInstrumentId = normalizeId(instrumentId);
    let resolvedExtractionInstanceId =
      extractionInstanceId === undefined ? null : normalizeId(extractionInstanceId);

    if (!resolvedInstrumentId || extractionInstanceId === undefined) {
      const { data: runData, error: runError } = await supabase
        .from('ai_assessment_runs')
        .select('instrument_id, extraction_instance_id')
        .eq('id', suggestion.assessment_run_id)
        .maybeSingle();

      if (runError) {
        console.warn('⚠️ [acceptSuggestion] Erro ao carregar run context:', runError);
      } else if (runData) {
        resolvedInstrumentId = resolvedInstrumentId ?? normalizeId(runData.instrument_id);
        if (extractionInstanceId === undefined) {
          resolvedExtractionInstanceId = normalizeId(runData.extraction_instance_id);
        }
      }
    }

    // 2. Buscar assessment existente do usuário
    let assessmentQuery = supabase
      .from('assessments')
      .select('id, responses')
      .eq('project_id', projectId)
      .eq('article_id', articleId)
      .eq('user_id', reviewerId)
      .eq('is_current_version', true);

    if (resolvedInstrumentId) {
      assessmentQuery = assessmentQuery.eq('instrument_id', resolvedInstrumentId);
    }

    if (resolvedExtractionInstanceId) {
      assessmentQuery = assessmentQuery.eq('extraction_instance_id', resolvedExtractionInstanceId);
    } else {
      assessmentQuery = assessmentQuery.is('extraction_instance_id', null);
    }

    const { data: existingAssessment, error: assessmentFetchError } = await assessmentQuery
      .maybeSingle();

    if (assessmentFetchError) {
      console.error('❌ [acceptSuggestion] Erro ao buscar assessment:', assessmentFetchError);
      throw new APIError(`Erro ao buscar assessment: ${assessmentFetchError.message}`);
    }

    // 3. Atualizar ou criar assessment com resposta
    const responses = existingAssessment?.responses || {};
    responses[itemId] = {
      item_id: itemId,
      selected_level: value.level,
      confidence: confidence,
      notes: null,
      evidence: value.evidence_passages,
    };

    if (existingAssessment) {
      // Atualizar assessment existente
      const { error: updateError } = await supabase
        .from('assessments')
        .update({
          responses,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingAssessment.id);

      if (updateError) {
        console.error('❌ [acceptSuggestion] Erro ao atualizar assessment:', updateError);
        throw new APIError(`Erro ao atualizar assessment: ${updateError.message}`);
      }
    } else {
      const resolvedToolType = await (async () => {
        if (!resolvedInstrumentId) return 'CUSTOM';
        const { data: instrumentData, error: instrumentError } = await supabase
          .from('assessment_instruments')
          .select('tool_type')
          .eq('id', resolvedInstrumentId)
          .maybeSingle();
        if (instrumentError) {
          console.warn('⚠️ [acceptSuggestion] Erro ao buscar instrumento:', instrumentError);
          return 'CUSTOM';
        }
        return instrumentData?.tool_type ?? 'CUSTOM';
      })();

      // Criar novo assessment
      const { error: insertError } = await supabase
        .from('assessments')
        .insert({
          project_id: projectId,
          article_id: articleId,
          user_id: reviewerId,
          instrument_id: resolvedInstrumentId,
          tool_type: resolvedToolType,
          responses,
          status: 'in_progress',
          completion_percentage: 0,
          extraction_instance_id: resolvedExtractionInstanceId,
          is_blind: false,
          is_current_version: true,
        });

      if (insertError) {
        console.error('❌ [acceptSuggestion] Erro ao criar assessment:', insertError);
        throw new APIError(`Erro ao criar assessment: ${insertError.message}`);
      }
    }

    // 4. Atualizar status da sugestão
    const { error: updateSuggestionError } = await supabase
      .from('ai_suggestions')
      .update({
        status: 'accepted',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', suggestionId);

    if (updateSuggestionError) {
      console.error('❌ [acceptSuggestion] Erro ao atualizar status da sugestão:', updateSuggestionError);
      throw new APIError(`Erro ao atualizar sugestão: ${updateSuggestionError.message}`);
    }

    console.log('✅ [acceptSuggestion] Sugestão aceita com sucesso:', { suggestionId, itemId });
  }

  /**
   * Rejeita uma sugestão de IA
   *
   * Workflow:
   * 1. Se foi aceita anteriormente: remove resposta do assessment
   * 2. Atualiza status da sugestão para 'rejected'
   * 3. Marca reviewed_by e reviewed_at
   *
   * @param params - Parâmetros da rejeição
   * @throws {SuggestionNotFoundError} Se sugestão não for encontrada
   * @throws {APIError} Se houver erro na operação
   */
  static async rejectSuggestion(params: RejectAssessmentSuggestionParams): Promise<void> {
    const {
      suggestionId,
      reviewerId,
      wasAccepted,
      itemId,
      projectId,
      articleId,
      instrumentId,
      extractionInstanceId,
    } = params;

    console.log('❌ [rejectSuggestion] Iniciando rejeição:', {
      suggestionId,
      itemId,
      reviewerId,
      wasAccepted,
    });

    // 1. Se foi aceita, remover resposta do assessment
    if (wasAccepted && itemId && projectId && articleId) {
      const resolvedInstrumentId = normalizeId(instrumentId);
      const resolvedExtractionInstanceId = normalizeId(extractionInstanceId);

      let assessmentQuery = supabase
        .from('assessments')
        .select('id, responses')
        .eq('project_id', projectId)
        .eq('article_id', articleId)
        .eq('user_id', reviewerId)
        .eq('is_current_version', true);

      if (resolvedInstrumentId) {
        assessmentQuery = assessmentQuery.eq('instrument_id', resolvedInstrumentId);
      }

      if (resolvedExtractionInstanceId) {
        assessmentQuery = assessmentQuery.eq('extraction_instance_id', resolvedExtractionInstanceId);
      } else {
        assessmentQuery = assessmentQuery.is('extraction_instance_id', null);
      }

      const { data: existingAssessment, error: fetchError } = await assessmentQuery
        .maybeSingle();

      if (fetchError) {
        console.error('❌ [rejectSuggestion] Erro ao buscar assessment:', fetchError);
        throw new APIError(`Erro ao buscar assessment: ${fetchError.message}`);
      }

      if (existingAssessment && existingAssessment.responses[itemId]) {
        const updatedResponses = { ...existingAssessment.responses };
        delete updatedResponses[itemId];

        const { error: updateError } = await supabase
          .from('assessments')
          .update({
            responses: updatedResponses,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingAssessment.id);

        if (updateError) {
          console.error('❌ [rejectSuggestion] Erro ao remover resposta:', updateError);
          throw new APIError(`Erro ao remover resposta: ${updateError.message}`);
        }

        console.log('🗑️ [rejectSuggestion] Resposta removida do assessment:', { itemId });
      }
    }

    // 2. Atualizar status da sugestão
    const { error: updateError } = await supabase
      .from('ai_suggestions')
      .update({
        status: 'rejected',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', suggestionId);

    if (updateError) {
      console.error('❌ [rejectSuggestion] Erro ao atualizar status da sugestão:', updateError);
      throw new APIError(`Erro ao atualizar sugestão: ${updateError.message}`);
    }

    console.log('❌ [rejectSuggestion] Sugestão rejeitada com sucesso:', { suggestionId, itemId });
  }

  /**
   * Aceita múltiplas sugestões em batch (acima de threshold de confiança)
   *
   * @param params - Parâmetros do batch
   * @param params.suggestions - Sugestões a processar
   * @param params.threshold - Limite mínimo de confiança (0-1)
   * @param params.reviewerId - ID do revisor
   * @param params.projectId - ID do projeto
   * @param params.articleId - ID do artigo
   * @param params.instrumentId - ID do instrumento
   * @returns Quantidade de sugestões aceitas
   */
  static async batchAcceptSuggestions(params: {
    suggestions: Record<string, AIAssessmentSuggestion>;
    threshold?: number;
    reviewerId: string;
    projectId: string;
    articleId: string;
    instrumentId?: string;
    extractionInstanceId?: string;
  }): Promise<number> {
    const { suggestions, threshold = 0.8, reviewerId, projectId, articleId, instrumentId, extractionInstanceId } = params;

    let accepted = 0;

    for (const [key, suggestion] of Object.entries(suggestions)) {
      if (
        suggestion.status === 'pending' &&
        suggestion.confidence_score >= threshold
      ) {
        try {
          await this.acceptSuggestion({
            suggestionId: suggestion.id,
            projectId,
            articleId,
            itemId: suggestion.assessment_item_id,
            value: suggestion.suggested_value,
            confidence: suggestion.confidence_score,
            reviewerId,
            instrumentId,
            extractionInstanceId,
          });
          accepted++;
        } catch (error) {
          console.error(`❌ [batchAccept] Erro ao aceitar sugestão ${suggestion.id}:`, error);
          // Continuar com próximas sugestões
        }
      }
    }

    console.log(`✅ [batchAccept] ${accepted} sugestão(ões) aceita(s) com threshold ${threshold}`);
    return accepted;
  }
}
