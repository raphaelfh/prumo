/**
 * Service para Avaliação com IA (Assessment)
 *
 * Integração com backend FastAPI para assessment de qualidade.
 * Chama endpoints de AI assessment (/api/v1/ai-assessment).
 *
 * Usa apiClient (Constitution Principle VI) para todas as chamadas.
 *
 * @example
 * ```typescript
 * // Avaliar item único
 * const response = await AssessmentService.assessSingleItem({
 *   projectId: '...',
 *   articleId: '...',
 *   assessmentItemId: '...',
 *   instrumentId: '...',
 * });
 *
 * // Avaliar em batch
 * const batchResponse = await AssessmentService.assessBatch({
 *   projectId: '...',
 *   articleId: '...',
 *   itemIds: ['...', '...'],
 *   instrumentId: '...',
 * });
 * ```
 */

import type {
  AIAssessmentRequest,
  AIAssessmentResponse,
  BatchAIAssessmentRequest,
  BatchAIAssessmentResponse,
  ListSuggestionsRequest,
  ListSuggestionsResponse,
  ReviewAISuggestionRequest,
  ReviewAISuggestionResponse,
} from '@/types/assessment';
import { apiClient } from '@/integrations/api/client';

const ASSESSMENT_ENDPOINT = '/api/v1/ai-assessment';

/**
 * Service para operações de assessment com IA
 */
export class AssessmentService {
  /**
   * Avalia um item de assessment único com IA
   *
   * Chama o backend FastAPI para processar PDF e gerar sugestão.
   *
   * @param request - Parâmetros da avaliação
   * @returns Response com sugestão criada
   * @throws {ApiError} Se houver erro na requisição
   */
  static async assessSingleItem(
    request: Omit<AIAssessmentRequest, 'projectId' | 'articleId' | 'assessmentItemId' | 'instrumentId'> & {
      projectId: string;
      articleId: string;
      assessmentItemId: string;
      instrumentId: string;
    }
  ): Promise<AIAssessmentResponse> {
    console.log('🤖 [assessSingleItem] Iniciando avaliação AI:', {
      projectId: request.projectId,
      articleId: request.articleId,
      itemId: request.assessmentItemId,
      model: request.model || 'gpt-4o-mini',
    });

    try {
      const data = await apiClient<AIAssessmentResponse['data']>(
        `${ASSESSMENT_ENDPOINT}/ai`,
        {
          method: 'POST',
          body: {
            projectId: request.projectId,
            articleId: request.articleId,
            assessmentItemId: request.assessmentItemId,
            instrumentId: request.instrumentId,
            pdfStorageKey: request.pdfStorageKey,
            pdfBase64: request.pdfBase64,
            pdfFilename: request.pdfFilename,
            pdfFileId: request.pdfFileId,
            forceFileSearch: request.forceFileSearch || false,
            openaiApiKey: request.openaiApiKey,
            extractionInstanceId: request.extractionInstanceId,
            model: request.model || 'gpt-4o-mini',
            temperature: request.temperature || 0.1,
          },
          timeout: 120000,
        }
      );

      if (data) {
        console.log('✅ [assessSingleItem] Avaliação concluída:', {
          suggestionId: data.id,
          level: data.selectedLevel,
          confidence: data.confidenceScore,
          tokensTotal: data.metadata.tokensPrompt + data.metadata.tokensCompletion,
        });
      }

      return { ok: true, data };
    } catch (error) {
      console.error('❌ [assessSingleItem] Erro ao avaliar item:', error);
      throw error;
    }
  }

  /**
   * Avalia múltiplos itens em batch com IA
   *
   * Otimiza processamento ao reutilizar PDF e construir contexto de memória.
   *
   * @param request - Parâmetros do batch
   * @returns Response com lista de sugestões criadas
   * @throws {ApiError} Se houver erro na requisição
   */
  static async assessBatch(
    request: BatchAIAssessmentRequest
  ): Promise<BatchAIAssessmentResponse> {
    console.log('🤖 [assessBatch] Iniciando avaliação AI em batch:', {
      projectId: request.projectId,
      articleId: request.articleId,
      itemsCount: request.itemIds.length,
      model: request.model || 'gpt-4o-mini',
    });

    try {
      const data = await apiClient<BatchAIAssessmentResponse['data']>(
        `${ASSESSMENT_ENDPOINT}/ai/batch`,
        {
          method: 'POST',
          body: {
            projectId: request.projectId,
            articleId: request.articleId,
            instrumentId: request.instrumentId,
            itemIds: request.itemIds,
            pdfStorageKey: request.pdfStorageKey,
            openaiApiKey: request.openaiApiKey,
            extractionInstanceId: request.extractionInstanceId,
            model: request.model || 'gpt-4o-mini',
            forceFileSearch: request.forceFileSearch || false,
          },
          timeout: 120000,
        }
      );

      if (data) {
        console.log('✅ [assessBatch] Batch concluído:', {
          totalItems: data.totalItems,
          successfulItems: data.successfulItems,
          failedItems: data.totalItems - data.successfulItems,
        });
      }

      return { ok: true, data };
    } catch (error) {
      console.error('❌ [assessBatch] Erro ao avaliar batch:', error);
      throw error;
    }
  }

  /**
   * Lista sugestões de IA pendentes de revisão
   *
   * @param request - Filtros de busca
   * @returns Lista de sugestões
   * @throws {ApiError} Se houver erro na requisição
   */
  static async listSuggestions(
    request: ListSuggestionsRequest
  ): Promise<ListSuggestionsResponse> {
    console.log('📋 [listSuggestions] Listando sugestões:', {
      projectId: request.projectId,
      articleId: request.articleId,
      instrumentId: request.instrumentId,
      status: request.status,
    });

    try {
      const params = new URLSearchParams({
        project_id: request.projectId,
        article_id: request.articleId,
      });

      if (request.instrumentId) {
        params.append('instrument_id', request.instrumentId);
      }

      if (request.extractionInstanceId) {
        params.append('extraction_instance_id', request.extractionInstanceId);
      }

      if (request.status) {
        params.append('status_filter', request.status);
      }

      const data = await apiClient<ListSuggestionsResponse['data']>(
        `${ASSESSMENT_ENDPOINT}/ai/suggestions?${params.toString()}`,
        {
          method: 'GET',
        }
      );

      if (data) {
        console.log('✅ [listSuggestions] Sugestões carregadas:', {
          total: data.total,
        });
      }

      return { ok: true, data };
    } catch (error) {
      console.error('❌ [listSuggestions] Erro ao listar sugestões:', error);
      throw error;
    }
  }

  /**
   * Revisa uma sugestão de IA (aceita/rejeita/modifica)
   *
   * @param suggestionId - ID da sugestão
   * @param request - Ação de revisão
   * @returns Response com resultado da revisão
   * @throws {ApiError} Se houver erro na requisição
   */
  static async reviewSuggestion(
    suggestionId: string,
    request: ReviewAISuggestionRequest
  ): Promise<ReviewAISuggestionResponse> {
    console.log('✏️ [reviewSuggestion] Revisando sugestão:', {
      suggestionId,
      action: request.action,
    });

    try {
      const data = await apiClient<ReviewAISuggestionResponse['data']>(
        `${ASSESSMENT_ENDPOINT}/ai/suggestions/${suggestionId}/review`,
        {
          method: 'POST',
          body: {
            action: request.action,
            modifiedValue: request.modifiedValue,
            reviewNotes: request.reviewNotes,
          },
        }
      );

      if (data) {
        console.log('✅ [reviewSuggestion] Revisão concluída:', {
          action: data.action,
          assessmentCreated: data.assessmentCreated,
          assessmentId: data.assessmentId,
        });
      }

      return { ok: true, data };
    } catch (error) {
      console.error('❌ [reviewSuggestion] Erro ao revisar sugestão:', error);
      throw error;
    }
  }

}
