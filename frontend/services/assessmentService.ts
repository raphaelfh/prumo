/**
 * AI Assessment service
 *
 * Integrates with FastAPI backend for quality assessment.
 * Calls AI assessment endpoints (/api/v1/ai-assessment).
 *
 * Uses apiClient (Constitution Principle VI) for all calls.
 *
 * @example
 * ```typescript
 * // Assess single item
 * const response = await AssessmentService.assessSingleItem({
 *   projectId: '...',
 *   articleId: '...',
 *   assessmentItemId: '...',
 *   instrumentId: '...',
 * });
 *
 * // Assess in batch
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
import {apiClient} from '@/integrations/api/client';

const ASSESSMENT_ENDPOINT = '/api/v1/ai-assessment';

/**
 * Service for AI assessment operations
 */
export class AssessmentService {
  /**
   * Assesses a single assessment item with AI
   *
   * Calls FastAPI backend to process PDF and generate suggestion.
   *
   * @param request - Assessment parameters
   * @returns Response with created suggestion
   * @throws {ApiError} On request error
   */
  static async assessSingleItem(
    request: Omit<AIAssessmentRequest, 'projectId' | 'articleId' | 'assessmentItemId' | 'instrumentId'> & {
      projectId: string;
      articleId: string;
      assessmentItemId: string;
      instrumentId: string;
    }
  ): Promise<AIAssessmentResponse> {
      console.log('[assessSingleItem] Starting AI assessment:', {
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
          console.log('[assessSingleItem] Assessment completed:', {
          suggestionId: data.id,
          level: data.selectedLevel,
          confidence: data.confidenceScore,
          tokensTotal: data.metadata.tokensPrompt + data.metadata.tokensCompletion,
        });
      }

      return { ok: true, data };
    } catch (error) {
        console.error('[assessSingleItem] Error assessing item:', error);
      throw error;
    }
  }

  /**
   * Assesses multiple items in batch with AI
   *
   * Optimizes by reusing PDF and building memory context.
   *
   * @param request - Batch parameters
   * @returns Response with list of created suggestions
   * @throws {ApiError} On request error
   */
  static async assessBatch(
    request: BatchAIAssessmentRequest
  ): Promise<BatchAIAssessmentResponse> {
      console.log('[assessBatch] Starting AI batch assessment:', {
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
          console.log('[assessBatch] Batch completed:', {
          totalItems: data.totalItems,
          successfulItems: data.successfulItems,
          failedItems: data.totalItems - data.successfulItems,
        });
      }

      return { ok: true, data };
    } catch (error) {
        console.error('[assessBatch] Error assessing batch:', error);
      throw error;
    }
  }

  /**
   * Lists AI suggestions pending review
   *
   * @param request - Search filters
   * @returns List of suggestions
   * @throws {ApiError} On request error
   */
  static async listSuggestions(
    request: ListSuggestionsRequest
  ): Promise<ListSuggestionsResponse> {
      console.log('[listSuggestions] Listing suggestions:', {
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
          console.log('[listSuggestions] Suggestions loaded:', {
          total: data.total,
        });
      }

      return { ok: true, data };
    } catch (error) {
        console.error('[listSuggestions] Error listing suggestions:', error);
      throw error;
    }
  }

  /**
   * Reviews an AI suggestion (accept/reject/modify)
   *
   * @param suggestionId - Suggestion ID
   * @param request - Review action
   * @returns Response with review result
   * @throws {ApiError} On request error
   */
  static async reviewSuggestion(
    suggestionId: string,
    request: ReviewAISuggestionRequest
  ): Promise<ReviewAISuggestionResponse> {
      console.log('[reviewSuggestion] Reviewing suggestion:', {
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
          console.log('[reviewSuggestion] Review completed:', {
          action: data.action,
          assessmentCreated: data.assessmentCreated,
          assessmentId: data.assessmentId,
        });
      }

      return { ok: true, data };
    } catch (error) {
        console.error('[reviewSuggestion] Error reviewing suggestion:', error);
      throw error;
    }
  }

}
