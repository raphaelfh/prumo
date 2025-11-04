/**
 * Service para Extração de Seção Específica
 * 
 * Service layer para chamar a edge function section-extraction.
 * Encapsula a lógica de comunicação com a API e tratamento de erros.
 * 
 * FOCO: Section extraction pipeline - extração granular por seção (entity type).
 * 
 * USO: Chamado pelo hook useSectionExtraction para extrair uma seção específica.
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

import { supabase } from "@/integrations/supabase/client";
import type {
  SectionExtractionRequest,
  SectionExtractionResponse,
  ModelExtractionRequest,
  ModelExtractionResponse,
} from "@/types/ai-extraction";
import {
  AuthenticationError,
  APIError,
} from "@/lib/ai-extraction/errors";

// Re-exportar tipos para compatibilidade
export type { 
  SectionExtractionRequest, 
  SectionExtractionResponse,
  ModelExtractionRequest,
  ModelExtractionResponse,
};

/**
 * Classe service para extração de seção
 * 
 * RESPONSABILIDADES:
 * - Construir URL da edge function
 * - Autenticar requisição com token do usuário
 * - Enviar request e parsear response
 * - Tratar erros de forma consistente
 */
export class SectionExtractionService {
  /**
   * Obtém URL da edge function
   * 
   * @returns URL completa da edge function section-extraction
   */
  private static getFunctionUrl(): string {
    const url = import.meta.env.VITE_SUPABASE_URL;
    if (!url) {
      throw new Error("VITE_SUPABASE_URL not configured");
    }
    return `${url}/functions/v1/section-extraction`;
  }

  /**
   * Obtém URL da edge function model-extraction
   * 
   * @returns URL completa da edge function model-extraction
   */
  private static getModelExtractionFunctionUrl(): string {
    const url = import.meta.env.VITE_SUPABASE_URL;
    if (!url) {
      throw new Error("VITE_SUPABASE_URL not configured");
    }
    return `${url}/functions/v1/model-extraction`;
  }

  /**
   * Extrai dados de uma seção específica
   * 
   * FLUXO:
   * 1. Verificar autenticação do usuário
   * 2. Gerar trace ID para rastreabilidade
   * 3. Enviar POST para edge function com timeout
   * 4. Parsear response com tratamento de erro robusto
   * 5. Lançar erro se falhar
   * 
   * @param request - Parâmetros da extração (projectId, articleId, templateId, entityTypeId)
   * @returns Response com runId e metadata
   * @throws Error se falhar a extração
   */
  static async extractSection(request: SectionExtractionRequest): Promise<SectionExtractionResponse> {
    // Verificar autenticação
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new AuthenticationError();
    }

    // Gerar trace ID para rastreabilidade (usado nos logs do backend)
    const traceId = crypto.randomUUID();
    const functionUrl = this.getFunctionUrl();

    console.log('[SectionExtractionService] Iniciando extração', {
      url: functionUrl,
      traceId,
      request: { ...request, options: request.options || {} },
    });

    // CRÍTICO: Timeout do frontend deve ser MENOR que o timeout do Supabase (150s)
    // Edge Functions têm timeout rigoroso de 150s
    // Usar 145s para garantir que detectamos timeout antes do Supabase matar a função
    const TIMEOUT_MS = 145 * 1000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);

    try {
    // Enviar requisição para edge function
      const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        "x-client-trace-id": traceId,
      },
      body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log('[SectionExtractionService] Resposta recebida', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
    });

      // Ler resposta uma única vez
      const contentType = response.headers.get("content-type");
      const responseText = await response.text();

      // Verificar se resposta é JSON
      if (!contentType?.includes("application/json")) {
        console.error('[SectionExtractionService] Resposta não é JSON', {
          contentType,
          status: response.status,
          text: responseText.substring(0, 500),
        });
        throw new APIError(
          `Resposta inválida do servidor (tipo: ${contentType})`,
          response.status,
          { responseText: responseText.substring(0, 500) },
        );
      }

      // Parsear resposta com tratamento de erro
      let result: SectionExtractionResponse;
      try {
        console.log('[SectionExtractionService] JSON recebido', {
          length: responseText.length,
          preview: responseText.substring(0, 200),
        });
        result = JSON.parse(responseText) as SectionExtractionResponse;
      } catch (parseError) {
        console.error('[SectionExtractionService] Erro ao parsear JSON', {
          parseError,
          responseText: responseText.substring(0, 500),
        });
        throw new APIError(
          "Erro ao processar resposta do servidor",
          response.status,
          { 
            parseError: parseError instanceof Error ? parseError.message : String(parseError),
            responsePreview: responseText.substring(0, 500),
          },
        );
      }

    // Verificar se houve erro
    if (!response.ok || !result.ok) {
      const errorMessage = result.error?.message || "Section extraction failed";
        const errorCode = result.error?.code || 'UNKNOWN_ERROR';
        console.error('[SectionExtractionService] Erro na extração', {
          status: response.status,
          errorCode,
          errorMessage,
          details: result.error?.details,
        });
        throw new APIError(errorMessage, response.status, {
          code: errorCode,
          details: result.error?.details,
        });
    }

      console.log('[SectionExtractionService] Extração concluída com sucesso', {
        runId: result.data?.runId,
        suggestionsCreated: result.data?.suggestionsCreated,
      });

    return result;
    } catch (error) {
      clearTimeout(timeoutId);

      // Tratamento específico para timeout
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[SectionExtractionService] Timeout na requisição', {
          timeout: TIMEOUT_MS,
          url: functionUrl,
        });
        throw new APIError(
          "A extração demorou muito tempo e foi cancelada. Tente novamente com um PDF menor ou verifique os logs do servidor.",
          408, // Request Timeout
          { timeout: TIMEOUT_MS },
        );
      }

      // Se já é um APIError, re-throw
      if (error instanceof APIError || error instanceof AuthenticationError) {
        throw error;
      }

      // Erro de rede ou outro erro
      console.error('[SectionExtractionService] Erro na requisição', {
        error: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new APIError(
        error instanceof Error ? error.message : "Erro desconhecido ao realizar extração",
        undefined,
        { originalError: String(error) },
      );
    }
  }

  /**
   * Extrai modelos de predição do artigo automaticamente
   * 
   * FLUXO:
   * 1. Verificar autenticação do usuário
   * 2. Gerar trace ID para rastreabilidade
   * 3. Enviar POST para edge function model-extraction com timeout
   * 4. Parsear response com tratamento de erro robusto
   * 5. Retornar lista de modelos criados
   * 
   * @param request - Parâmetros da extração (projectId, articleId, templateId)
   * @returns Response com runId, modelos criados e metadata
   * @throws Error se falhar a extração
   */
  static async extractModels(request: ModelExtractionRequest): Promise<ModelExtractionResponse> {
    // Verificar autenticação
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new AuthenticationError();
    }

    // Gerar trace ID para rastreabilidade
    const traceId = crypto.randomUUID();
    const functionUrl = this.getModelExtractionFunctionUrl();

    console.log('[SectionExtractionService] Iniciando extração de modelos', {
      url: functionUrl,
      traceId,
      request: { ...request, options: request.options || {} },
    });

    // Timeout: 145s (menor que Supabase 150s)
    const TIMEOUT_MS = 145 * 1000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);

    try {
      // Enviar requisição para edge function
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          "x-client-trace-id": traceId,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log('[SectionExtractionService] Resposta recebida (modelos)', {
        status: response.status,
        ok: response.ok,
      });

      // Ler resposta
      const contentType = response.headers.get("content-type");
      const responseText = await response.text();

      if (!contentType?.includes("application/json")) {
        console.error('[SectionExtractionService] Resposta não é JSON', {
          contentType,
          status: response.status,
          text: responseText.substring(0, 500),
        });
        throw new APIError(
          `Resposta inválida do servidor (tipo: ${contentType})`,
          response.status,
          { responseText: responseText.substring(0, 500) },
        );
      }

      // Parsear resposta
      let result: ModelExtractionResponse;
      try {
        result = JSON.parse(responseText) as ModelExtractionResponse;
      } catch (parseError) {
        console.error('[SectionExtractionService] Erro ao parsear JSON', {
          parseError,
          responseText: responseText.substring(0, 500),
        });
        throw new APIError(
          "Erro ao processar resposta do servidor",
          response.status,
          { 
            parseError: parseError instanceof Error ? parseError.message : String(parseError),
            responsePreview: responseText.substring(0, 500),
          },
        );
      }

      // Verificar se houve erro
      if (!response.ok || !result.ok) {
        const errorMessage = result.error?.message || "Model extraction failed";
        const errorCode = result.error?.code || 'UNKNOWN_ERROR';
        console.error('[SectionExtractionService] Erro na extração de modelos', {
          status: response.status,
          errorCode,
          errorMessage,
          details: result.error?.details,
        });
        throw new APIError(errorMessage, response.status, {
          code: errorCode,
          details: result.error?.details,
        });
      }

      console.log('[SectionExtractionService] Extração de modelos concluída', {
        runId: result.data?.runId,
        modelsCreated: result.data?.modelsCreated?.length || 0,
      });

      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      // Tratamento específico para timeout
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[SectionExtractionService] Timeout na requisição (modelos)', {
          timeout: TIMEOUT_MS,
          url: functionUrl,
        });
        throw new APIError(
          "A extração de modelos demorou muito tempo e foi cancelada. Tente novamente com um PDF menor ou verifique os logs do servidor.",
          408,
          { timeout: TIMEOUT_MS },
        );
      }

      // Se já é um APIError, re-throw
      if (error instanceof APIError || error instanceof AuthenticationError) {
        throw error;
      }

      // Erro de rede ou outro erro
      console.error('[SectionExtractionService] Erro na requisição (modelos)', {
        error: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
      });

      throw new APIError(
        error instanceof Error ? error.message : "Erro desconhecido ao realizar extração de modelos",
        undefined,
        { originalError: String(error) },
      );
    }
  }
}

