/**
 * Service para Avaliação com IA (Assessment)
 *
 * Integração com backend FastAPI para assessment de qualidade.
 * Chama endpoints de AI assessment (/api/v1/ai-assessment).
 *
 * Baseado em sectionExtractionService.ts (DRY + KISS)
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
import { APIError } from '@/lib/ai-extraction/errors';
import { supabase } from '@/integrations/supabase/client';

/**
 * Configuração do cliente FastAPI
 */
const FASTAPI_BASE_URL = import.meta.env.VITE_FASTAPI_BASE_URL || 'http://localhost:8000';
const ASSESSMENT_ENDPOINT = '/api/v1/ai-assessment';

/**
 * Helper para obter token de autenticação
 */
async function getAuthToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error || !session) {
    throw new APIError('Usuário não autenticado');
  }

  return session.access_token;
}

/**
 * Helper para fazer requisições ao backend
 */
async function fetchBackend<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAuthToken();

  const response = await fetch(`${FASTAPI_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new APIError(`Backend error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

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
   * @throws {APIError} Se houver erro na requisição
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
      const response = await fetchBackend<AIAssessmentResponse>(
        `${ASSESSMENT_ENDPOINT}/ai`,
        {
          method: 'POST',
          body: JSON.stringify({
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
          }),
        }
      );

      if (response.ok && response.data) {
        console.log('✅ [assessSingleItem] Avaliação concluída:', {
          suggestionId: response.data.id,
          level: response.data.selectedLevel,
          confidence: response.data.confidenceScore,
          tokensTotal: response.data.metadata.tokensPrompt + response.data.metadata.tokensCompletion,
        });
      }

      return response;
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
   * @throws {APIError} Se houver erro na requisição
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
      const response = await fetchBackend<BatchAIAssessmentResponse>(
        `${ASSESSMENT_ENDPOINT}/ai/batch`,
        {
          method: 'POST',
          body: JSON.stringify({
            projectId: request.projectId,
            articleId: request.articleId,
            instrumentId: request.instrumentId,
            itemIds: request.itemIds,
            pdfStorageKey: request.pdfStorageKey,
            openaiApiKey: request.openaiApiKey,
            extractionInstanceId: request.extractionInstanceId,
            model: request.model || 'gpt-4o-mini',
            forceFileSearch: request.forceFileSearch || false,
          }),
        }
      );

      if (response.ok && response.data) {
        console.log('✅ [assessBatch] Batch concluído:', {
          totalItems: response.data.totalItems,
          successfulItems: response.data.successfulItems,
          failedItems: response.data.totalItems - response.data.successfulItems,
        });
      }

      return response;
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
   * @throws {APIError} Se houver erro na requisição
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

      const response = await fetchBackend<ListSuggestionsResponse>(
        `${ASSESSMENT_ENDPOINT}/ai/suggestions?${params.toString()}`,
        {
          method: 'GET',
        }
      );

      if (response.ok && response.data) {
        console.log('✅ [listSuggestions] Sugestões carregadas:', {
          total: response.data.total,
        });
      }

      return response;
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
   * @throws {APIError} Se houver erro na requisição
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
      const response = await fetchBackend<ReviewAISuggestionResponse>(
        `${ASSESSMENT_ENDPOINT}/ai/suggestions/${suggestionId}/review`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: request.action,
            modifiedValue: request.modifiedValue,
            reviewNotes: request.reviewNotes,
          }),
        }
      );

      if (response.ok && response.data) {
        console.log('✅ [reviewSuggestion] Revisão concluída:', {
          action: response.data.action,
          assessmentCreated: response.data.assessmentCreated,
          assessmentId: response.data.assessmentId,
        });
      }

      return response;
    } catch (error) {
      console.error('❌ [reviewSuggestion] Erro ao revisar sugestão:', error);
      throw error;
    }
  }

  /**
   * Helper para converter camelCase para snake_case (backend)
   * Usado internamente pelo service
   */
  private static toSnakeCase(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      result[snakeKey] = value;
    }

    return result;
  }

  /**
   * Helper para converter snake_case para camelCase (frontend)
   * Usado internamente pelo service
   */
  private static toCamelCase(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = value;
    }

    return result;
  }
}
