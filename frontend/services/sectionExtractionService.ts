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

import {ApiError, apiClient, modelExtractionClient} from '@/integrations/api/client';
import type {
    BatchSectionExtractionRequest,
    BatchSectionExtractionResponse,
    BatchSectionResult,
    ModelExtractionRequest,
    ModelExtractionResponse,
    SectionExtractionRequest,
    SectionExtractionResponse,
} from "@/types/ai-extraction";
import {APIError} from "@/lib/ai-extraction/errors";
import {toResult, type ErrorResult} from '@/lib/error-utils';
import {getExtractionJobStatus} from './extractionRunService';
import type {components} from '@/types/api/schema';

type SectionOutcome = components['schemas']['SectionOutcome'];
type ExtractionJobResult = components['schemas']['ExtractionJobResult'];

// Re-export types for compatibility
export type {
  SectionExtractionRequest,
  SectionExtractionResponse,
  ModelExtractionRequest,
  ModelExtractionResponse,
};

/** Maps a SectionOutcome (snake_case wire format) to BatchSectionResult (camelCase). */
function mapSectionOutcome(s: SectionOutcome): BatchSectionResult {
  return {
    entityTypeId: s.entity_type_id,
    entityTypeName: s.entity_type_name ?? '',
    success: s.success,
    suggestionsCreated: s.suggestions_created,
    error: s.error ?? undefined,
  };
}

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 300; // ~10 min

/**
 * Poll getExtractionJobStatus until the job reaches a terminal state
 * (completed | failed | cancelled) or the safety cap is hit.
 * Returns ErrorResult<ExtractionJobResult> — never throws.
 */
async function pollUntilDone(jobId: string): Promise<ErrorResult<ExtractionJobResult>> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    const statusResult = await getExtractionJobStatus(jobId);
    if (!statusResult.ok) {
      return statusResult;
    }
    const { status, result, error } = statusResult.data;
    if (status === 'completed' && result) {
      return { ok: true, data: result };
    }
    if (status === 'failed' || status === 'cancelled') {
      return {
        ok: false,
        error: new Error(error ?? `Extraction job ${status}: ${jobId}`),
      };
    }
    // pending | running — keep polling
  }
  return {
    ok: false,
    error: new Error(`Extraction job timed out after ${POLL_MAX_ATTEMPTS} polls: ${jobId}`),
  };
}

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
   * Extracts data for a specific section via FastAPI (async job pattern).
   *
   * FLOW:
   * 1. POST → 202 with { job_id }
   * 2. Poll getExtractionJobStatus every 2000ms until terminal (max 300 polls)
   * 3. Map completed result to SectionExtractionResponse shape
   * 4. On failure/timeout returns { ok: false } shape
   *
   * @param request - Extraction params (projectId, articleId, templateId, entityTypeId)
   * @returns Response with runId and metadata (old SectionExtractionResponse shape)
   */
  static async extractSection(request: SectionExtractionRequest): Promise<SectionExtractionResponse> {
    const traceId = crypto.randomUUID();

    console.warn('[SectionExtractionService] Starting extraction via FastAPI', {
      traceId,
      request: { ...request, options: request.options || {} },
    });

    // POST — get job_id
    const raw = await apiClient<{ job_id: string }>('/api/v1/extraction/sections', {
      method: 'POST',
      body: {
        projectId: request.projectId,
        articleId: request.articleId,
        templateId: request.templateId,
        entityTypeId: request.entityTypeId,
        parentInstanceId: request.parentInstanceId,
        runId: request.runId,
        model: request.options?.model ?? 'gpt-4o-mini',
      },
    }).catch((err: unknown) => {
      if (err instanceof ApiError) {
        throw new APIError(err.message, err.status, { code: err.code, traceId: err.traceId });
      }
      throw new APIError(err instanceof Error ? err.message : String(err), undefined, { originalError: String(err) });
    });

    const jobId = raw.job_id;

    // Poll until done
    const jobResult = await pollUntilDone(jobId);

    if (!jobResult.ok) {
      throw new APIError(jobResult.error.message, undefined, { traceId });
    }

    const result = jobResult.data;

    console.warn('[SectionExtractionService] FastAPI extraction completed', {
      extractionRunId: result.extractionRunId,
      suggestionsCreated: result.suggestionsCreated,
    });

    return {
      ok: true,
      data: {
        runId: result.extractionRunId,
        entityTypeId: result.entityTypeId ?? '',
        suggestionsCreated: result.suggestionsCreated ?? 0,
      },
      traceId,
    };
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
   * Extracts all sections of a model in one go via FastAPI (async job pattern).
   *
   * FLOW:
   * 1. POST → 202 with { job_id }
   * 2. Poll getExtractionJobStatus every 2000ms until terminal (max 300 polls)
   * 3. Map completed result to BatchSectionExtractionResponse shape
   * 4. On failure/timeout throws APIError
   *
   * @param request - Extraction params (projectId, articleId, templateId, parentInstanceId)
   * @returns Response with aggregated results for all sections
   */
  static async extractAllSections(request: BatchSectionExtractionRequest): Promise<BatchSectionExtractionResponse> {
    const traceId = crypto.randomUUID();

    console.warn('[SectionExtractionService] Starting full sections extraction via FastAPI', {
      traceId,
      request: { ...request, options: request.options || {} },
    });

    // POST — get job_id
    const raw = await apiClient<{ job_id: string }>('/api/v1/extraction/sections', {
      method: 'POST',
      body: {
        projectId: request.projectId,
        articleId: request.articleId,
        templateId: request.templateId,
        parentInstanceId: request.parentInstanceId,
        extractAllSections: true,
        sectionIds: request.sectionIds,
        pdfText: request.pdfText,
        model: request.options?.model ?? 'gpt-4o-mini',
      },
    }).catch((err: unknown) => {
      if (err instanceof ApiError) {
        throw new APIError(err.message, err.status, { code: err.code, traceId: err.traceId });
      }
      throw new APIError(err instanceof Error ? err.message : String(err), undefined, { originalError: String(err) });
    });

    const jobId = raw.job_id;

    // Poll until done
    const jobResult = await pollUntilDone(jobId);

    if (!jobResult.ok) {
      throw new APIError(jobResult.error.message, undefined, { traceId });
    }

    const result = jobResult.data;

    console.warn('[SectionExtractionService] Full sections extraction via FastAPI completed', {
      totalSections: result.totalSections,
      successfulSections: result.successfulSections,
      failedSections: result.failedSections,
    });

    return {
      ok: true,
      data: {
        runId: result.extractionRunId,
        totalSections: result.totalSections ?? 0,
        successfulSections: result.successfulSections ?? 0,
        failedSections: result.failedSections ?? 0,
        totalSuggestionsCreated: result.totalSuggestionsCreated ?? 0,
        totalTokensUsed: 0,
        durationMs: 0,
        sections: (result.sections ?? []).map(mapSectionOutcome),
      },
      traceId,
    };
  }
}

// ---------------------------------------------------------------------------
// Async-job section extraction (B4/B5 — POST returns 202 + job_id)
// ---------------------------------------------------------------------------

/**
 * Parameters for the async section extraction POST.
 * Mirrors the SectionExtractionRequest schema fields consumed by the
 * backend endpoint.
 */
export interface AsyncSectionExtractionParams {
  projectId: string;
  articleId: string;
  templateId: string;
  runId?: string;
  entityTypeId?: string;
  parentInstanceId?: string;
  skipFieldsWithHumanProposals?: boolean;
  autoAdvanceToReview?: boolean;
  model?: string;
}

/**
 * POST /api/v1/extraction/sections — enqueues a section extraction job.
 *
 * The backend returns 202 with ``ApiResponse.success({ job_id })``
 * (snake_case). This function normalises to camelCase ``{ jobId }``
 * for the hook layer.
 *
 * Returns ErrorResult — never throws across the boundary.
 */
export function extractSectionAsync(
  params: AsyncSectionExtractionParams,
): Promise<ErrorResult<{ jobId: string }>> {
  return toResult(
    async () => {
      const raw = await apiClient<{ job_id: string }>(
        '/api/v1/extraction/sections',
        {
          method: 'POST',
          body: {
            projectId: params.projectId,
            articleId: params.articleId,
            templateId: params.templateId,
            runId: params.runId,
            entityTypeId: params.entityTypeId,
            parentInstanceId: params.parentInstanceId,
            skipFieldsWithHumanProposals:
              params.skipFieldsWithHumanProposals ?? true,
            autoAdvanceToReview: params.autoAdvanceToReview ?? false,
            model: params.model ?? 'gpt-4o-mini',
          },
        },
      );
      return { jobId: raw.job_id };
    },
    'sectionExtractionService.extractSectionAsync',
  );
}
