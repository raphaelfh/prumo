/**
 * Section-specific extraction service via FastAPI
 *
 * Service layer to call FastAPI backend (Render) for data extraction.
 * Encapsulates API communication and error handling.
 *
 * FOCUS: Section extraction pipeline - granular extraction per section (entity type).
 *
 * USAGE: Called by extraction hooks to process articles with AI.
 *
 * @example
 * ```typescript
 * const result = await SectionExtractionService.extractSection({
 *   projectId: '...',
 *   articleId: '...',
 *   templateId: '...',
 *   entityTypeId: '...',
 *   options: { model: 'gpt-4o' }
 * });
 *
 * console.warn(`Created ${result.data?.suggestionsCreated} suggestions`);
 * ```
 */

import {ApiError, modelExtractionClient, sectionExtractionClient} from '@/integrations/api/client';
import type {
    BatchSectionExtractionRequest,
    BatchSectionExtractionResponse,
    ModelExtractionRequest,
    ModelExtractionResponse,
    SectionExtractionRequest,
    SectionExtractionResponse,
} from "@/types/ai-extraction";
import {APIError} from "@/lib/ai-extraction/errors";

// Re-export types for compatibility
export type {
  SectionExtractionRequest,
  SectionExtractionResponse,
  ModelExtractionRequest,
  ModelExtractionResponse,
};

/**
 * Service class for section extraction via FastAPI
 *
 * RESPONSIBILITIES:
 * - Call FastAPI (Render) endpoints
 * - Parse responses and convert to expected format
 * - Handle errors consistently
 */
export class SectionExtractionService {
  /**
   * Extracts data for a specific section via FastAPI
   *
   * FLOW:
   * 1. Generate trace ID for traceability
   * 2. Send POST to FastAPI backend
   * 3. Parse response with robust error handling
   * 4. Return data in expected format
   *
   * @param request - Extraction params (projectId, articleId, templateId, entityTypeId)
   * @returns Response with runId and metadata
   * @throws APIError if extraction fails
   */
  static async extractSection(request: SectionExtractionRequest): Promise<SectionExtractionResponse> {
    const traceId = crypto.randomUUID();

      console.warn('[SectionExtractionService] Starting extraction via FastAPI', {
      traceId,
      request: { ...request, options: request.options || {} },
    });

    try {
        // NOTE: apiClient returns responseData.data directly, not {ok, data}
        // So the type here is the inner content of SectionExtractionResponse['data']
      type SectionExtractionData = NonNullable<SectionExtractionResponse['data']>;

      const data = await sectionExtractionClient<SectionExtractionData>({
        projectId: request.projectId,
        articleId: request.articleId,
        templateId: request.templateId,
        entityTypeId: request.entityTypeId,
        parentInstanceId: request.parentInstanceId,
        model: request.options?.model,
      });

        console.warn('[SectionExtractionService] FastAPI extraction completed', {
        runId: data?.runId,
        suggestionsCreated: data?.suggestionsCreated,
      });

      // Construir resposta no formato esperado pelo hook
      return {
        ok: true,
        data: data,
        traceId,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw new APIError(error.message, error.status, {
          code: error.code,
          traceId: error.traceId,
        });
      }
      throw new APIError(
          error instanceof Error ? error.message : "Unknown error",
        undefined,
        { originalError: String(error) },
      );
    }
  }

  /**
   * Extracts prediction models from the article automatically via FastAPI
   *
   * FLOW:
   * 1. Generate trace ID for traceability
   * 2. Send POST to FastAPI backend (model-extraction)
   * 3. Parse response with robust error handling
   * 4. Return list of created models
   *
   * @param request - Extraction params (projectId, articleId, templateId)
   * @returns Response with runId, created models and metadata
   * @throws APIError if extraction fails
   */
  static async extractModels(request: ModelExtractionRequest): Promise<ModelExtractionResponse> {
    const traceId = crypto.randomUUID();

      console.warn('[SectionExtractionService] Starting model extraction via FastAPI', {
      traceId,
      request: { ...request, options: request.options || {} },
    });

    try {
        // NOTE: apiClient returns responseData.data directly, not {ok, data}
        // So the type here is the inner content of ModelExtractionResponse['data']
      type ModelExtractionData = NonNullable<ModelExtractionResponse['data']>;

      const data = await modelExtractionClient<ModelExtractionData>({
        projectId: request.projectId,
        articleId: request.articleId,
        templateId: request.templateId,
        model: request.options?.model,
      });

        console.warn('[SectionExtractionService] Model extraction via FastAPI completed', {
        runId: data?.runId,
        modelsCreated: data?.modelsCreated?.length || 0,
      });

      // Construir resposta no formato esperado pelo hook
      return {
        ok: true,
        data: data,
        traceId,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw new APIError(error.message, error.status, {
          code: error.code,
          traceId: error.traceId,
        });
      }
      throw new APIError(
          error instanceof Error ? error.message : "Unknown error",
        undefined,
        { originalError: String(error) },
      );
    }
  }

  /**
   * Extracts all sections of a model in one go via FastAPI
   *
   * FLOW:
   * 1. Generate trace ID for traceability
   * 2. Send POST to FastAPI backend with extractAllSections=true
   * 3. Parse response with robust error handling
   * 4. Return aggregated result
   *
   * @param request - Extraction params (projectId, articleId, templateId, parentInstanceId)
   * @returns Response with aggregated results for all sections
   * @throws APIError if extraction fails
   */
  static async extractAllSections(request: BatchSectionExtractionRequest): Promise<BatchSectionExtractionResponse> {
    const traceId = crypto.randomUUID();

      console.warn('[SectionExtractionService] Starting full sections extraction via FastAPI', {
      traceId,
      request: { ...request, options: request.options || {} },
    });

    try {
        // NOTE: apiClient returns responseData.data directly, not {ok, data}
        // So the type here is the inner content of BatchSectionExtractionResponse['data']
      type BatchSectionExtractionData = NonNullable<BatchSectionExtractionResponse['data']>;

      const data = await sectionExtractionClient<BatchSectionExtractionData>({
        projectId: request.projectId,
        articleId: request.articleId,
        templateId: request.templateId,
        parentInstanceId: request.parentInstanceId,
        extractAllSections: true,
        sectionIds: request.sectionIds,
        pdfText: request.pdfText,
        model: request.options?.model,
      });

        console.warn('[SectionExtractionService] Full sections extraction via FastAPI completed', {
        totalSections: data?.totalSections,
        successfulSections: data?.successfulSections,
        failedSections: data?.failedSections,
      });

      // Construir resposta no formato esperado pelo hook
      return {
        ok: true,
        data: data,
        traceId,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw new APIError(error.message, error.status, {
          code: error.code,
          traceId: error.traceId,
        });
      }
      throw new APIError(
          error instanceof Error ? error.message : "Unknown error",
        undefined,
        { originalError: String(error) },
      );
    }
  }
}
