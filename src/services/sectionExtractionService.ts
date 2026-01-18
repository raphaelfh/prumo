/**
 * Service para Extração de Seção Específica via FastAPI
 *
 * Service layer para chamar o backend FastAPI (Render) para extração de dados.
 * Encapsula a lógica de comunicação com a API e tratamento de erros.
 *
 * FOCO: Section extraction pipeline - extração granular por seção (entity type).
 *
 * USO: Chamado pelos hooks de extração para processar artigos com IA.
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
 * console.log(`Criadas ${result.data?.suggestionsCreated} sugestões`);
 * ```
 */

import { sectionExtractionClient, modelExtractionClient, ApiError } from '@/integrations/api/client';
import type {
  SectionExtractionRequest,
  SectionExtractionResponse,
  ModelExtractionRequest,
  ModelExtractionResponse,
  BatchSectionExtractionRequest,
  BatchSectionExtractionResponse,
} from "@/types/ai-extraction";
import { APIError } from "@/lib/ai-extraction/errors";

// Re-exportar tipos para compatibilidade
export type {
  SectionExtractionRequest,
  SectionExtractionResponse,
  ModelExtractionRequest,
  ModelExtractionResponse,
};

/**
 * Classe service para extração de seção via FastAPI
 *
 * RESPONSABILIDADES:
 * - Chamar endpoints do FastAPI (Render)
 * - Parsear responses e converter para formato esperado
 * - Tratar erros de forma consistente
 */
export class SectionExtractionService {
  /**
   * Extrai dados de uma seção específica via FastAPI
   *
   * FLUXO:
   * 1. Gerar trace ID para rastreabilidade
   * 2. Enviar POST para FastAPI backend
   * 3. Parsear response com tratamento de erro robusto
   * 4. Retornar dados no formato esperado
   *
   * @param request - Parâmetros da extração (projectId, articleId, templateId, entityTypeId)
   * @returns Response com runId e metadata
   * @throws APIError se falhar a extração
   */
  static async extractSection(request: SectionExtractionRequest): Promise<SectionExtractionResponse> {
    const traceId = crypto.randomUUID();

    console.log('[SectionExtractionService] Iniciando extração via FastAPI', {
      traceId,
      request: { ...request, options: request.options || {} },
    });

    try {
      // NOTA: apiClient retorna responseData.data diretamente, não {ok, data}
      // Portanto, o tipo aqui é o conteúdo interno de SectionExtractionResponse['data']
      type SectionExtractionData = NonNullable<SectionExtractionResponse['data']>;

      const data = await sectionExtractionClient<SectionExtractionData>({
        projectId: request.projectId,
        articleId: request.articleId,
        templateId: request.templateId,
        entityTypeId: request.entityTypeId,
        parentInstanceId: request.parentInstanceId,
        model: request.options?.model,
      });

      console.log('[SectionExtractionService] Extração via FastAPI concluída', {
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
        error instanceof Error ? error.message : "Erro desconhecido",
        undefined,
        { originalError: String(error) },
      );
    }
  }

  /**
   * Extrai modelos de predição do artigo automaticamente via FastAPI
   *
   * FLUXO:
   * 1. Gerar trace ID para rastreabilidade
   * 2. Enviar POST para FastAPI backend (model-extraction)
   * 3. Parsear response com tratamento de erro robusto
   * 4. Retornar lista de modelos criados
   *
   * @param request - Parâmetros da extração (projectId, articleId, templateId)
   * @returns Response com runId, modelos criados e metadata
   * @throws APIError se falhar a extração
   */
  static async extractModels(request: ModelExtractionRequest): Promise<ModelExtractionResponse> {
    const traceId = crypto.randomUUID();

    console.log('[SectionExtractionService] Iniciando extração de modelos via FastAPI', {
      traceId,
      request: { ...request, options: request.options || {} },
    });

    try {
      // NOTA: apiClient retorna responseData.data diretamente, não {ok, data}
      // Portanto, o tipo aqui é o conteúdo interno de ModelExtractionResponse['data']
      type ModelExtractionData = NonNullable<ModelExtractionResponse['data']>;

      const data = await modelExtractionClient<ModelExtractionData>({
        projectId: request.projectId,
        articleId: request.articleId,
        templateId: request.templateId,
        model: request.options?.model,
      });

      console.log('[SectionExtractionService] Extração de modelos via FastAPI concluída', {
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
        error instanceof Error ? error.message : "Erro desconhecido",
        undefined,
        { originalError: String(error) },
      );
    }
  }

  /**
   * Extrai todas as seções de um modelo de uma vez via FastAPI
   *
   * FLUXO:
   * 1. Gerar trace ID para rastreabilidade
   * 2. Enviar POST para FastAPI backend com extractAllSections=true
   * 3. Parsear response com tratamento de erro robusto
   * 4. Retornar resultado agregado
   *
   * @param request - Parâmetros da extração (projectId, articleId, templateId, parentInstanceId)
   * @returns Response com resultados agregados de todas as seções
   * @throws APIError se falhar a extração
   */
  static async extractAllSections(request: BatchSectionExtractionRequest): Promise<BatchSectionExtractionResponse> {
    const traceId = crypto.randomUUID();

    console.log('[SectionExtractionService] Iniciando extração de todas as seções via FastAPI', {
      traceId,
      request: { ...request, options: request.options || {} },
    });

    try {
      // NOTA: apiClient retorna responseData.data diretamente, não {ok, data}
      // Portanto, o tipo aqui é o conteúdo interno de BatchSectionExtractionResponse['data']
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

      console.log('[SectionExtractionService] Extração de todas as seções via FastAPI concluída', {
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
        error instanceof Error ? error.message : "Erro desconhecido",
        undefined,
        { originalError: String(error) },
      );
    }
  }
}
