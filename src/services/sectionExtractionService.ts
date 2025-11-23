/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

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
import { callEdgeFunction, AuthenticationError as BaseAuthError } from '@/lib/supabase/baseRepository';
import type {
  SectionExtractionRequest,
  SectionExtractionResponse,
  ModelExtractionRequest,
  ModelExtractionResponse,
  BatchSectionExtractionRequest,
  BatchSectionExtractionResponse,
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
    // Gerar trace ID para rastreabilidade (usado nos logs do backend)
    const traceId = crypto.randomUUID();
    // Extrair nome da função da URL (ex: 'section-extraction' de URL completa)
    const functionUrl = this.getFunctionUrl();
    const functionName = functionUrl.split('/functions/v1/')[1]?.split('?')[0] || 'section-extraction';

    console.log('[SectionExtractionService] Iniciando extração', {
      functionName,
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
      // Usar callEdgeFunction do baseRepository com headers customizados
      const result = await callEdgeFunction<SectionExtractionResponse>(
        functionName,
        request,
        {
          timeout: TIMEOUT_MS,
          signal: controller.signal,
          headers: {
            'x-client-trace-id': traceId,
          },
        }
      );

      clearTimeout(timeoutId);

      // Verificar se a resposta indica erro
      if (!result.ok) {
        const errorMessage = result.error?.message || "Section extraction failed";
        const errorCode = result.error?.code || 'UNKNOWN_ERROR';
        console.error('[SectionExtractionService] Erro na extração', {
          errorCode,
          errorMessage,
          details: result.error?.details,
        });
        throw new APIError(errorMessage, undefined, {
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

      // Se já é um APIError ou BaseAuthError, converter para APIError ou re-throw
      if (error instanceof BaseAuthError) {
        throw new AuthenticationError();
      }

      if (error instanceof APIError) {
        throw error;
      }

      // Se é SupabaseRepositoryError, extrair contexto e converter para APIError
      if (error instanceof Error && error.name === 'SupabaseRepositoryError') {
        const context = (error as any).context || {};
        const errorType = context.errorType;
        const errorCode = context.errorCode || 'UNKNOWN_ERROR';
        const errorDetails = context.errorDetails || {};
        
        // Erro de serviço indisponível (503)
        if (errorType === 'SERVICE_UNAVAILABLE' || context.status === 503) {
          console.error('[SectionExtractionService] Serviço indisponível', {
            error: error.message,
            context,
          });
          throw new APIError(
            error.message || "A função não está disponível. Verifique se o Supabase local está rodando (supabase start).",
            undefined,
            {
              code: 'SERVICE_UNAVAILABLE',
              originalError: error.message,
              suggestion: context.suggestion,
            },
          );
        }

        // Erro de rede (DNS, conexão)
        if (errorType === 'NETWORK_ERROR' ||
          error.message.includes('Não foi possível conectar ao servidor') ||
          error.message.includes('name resolution failed') ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('NetworkError')) {
          console.error('[SectionExtractionService] Erro de rede na requisição', {
            error: error.message,
            context,
          });
          throw new APIError(
            "Não foi possível conectar ao servidor. Verifique se o Supabase local está rodando (supabase start) e se a URL está configurada corretamente.",
            undefined,
            {
              code: 'NETWORK_ERROR',
              originalError: error.message,
              suggestion: context.suggestion || 'Execute "supabase start" para iniciar o servidor local',
            },
          );
        }
        
        // Mensagem mais específica baseada no código de erro
        let message = error.message;
        if (errorCode === 'PDF_PROCESSING_ERROR') {
          message = errorDetails.suggestion || "Erro ao processar PDF. Verifique se o arquivo está válido e não está corrompido.";
        } else if (errorCode === 'LLM_ERROR') {
          message = "Erro ao processar com IA. Tente novamente ou contate o suporte.";
        } else if (errorCode === 'TIMEOUT') {
          message = "A extração demorou muito tempo e foi cancelada. Tente novamente.";
        }
        
        throw new APIError(
          message,
          context.status || undefined,
          { 
            code: errorCode,
            details: errorDetails,
            originalError: error.message,
          },
        );
      }
      
      // Verificar outros tipos de erro
      if (error instanceof Error) {
        // Timeout específico
        if (error.name === 'AbortError' || error.message.includes('Timeout')) {
          console.error('[SectionExtractionService] Timeout na requisição', {
            timeout: TIMEOUT_MS,
            functionName,
          });
          throw new APIError(
            "A extração demorou muito tempo e foi cancelada. Tente novamente com um PDF menor ou verifique os logs do servidor.",
            408,
            { timeout: TIMEOUT_MS },
          );
        }
      }

      // Erro genérico
      console.error('[SectionExtractionService] Erro na requisição', {
        error: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
        context: (error as any)?.context,
      });

      throw new APIError(
        error instanceof Error ? error.message : "Erro desconhecido ao realizar extração",
        undefined,
        { 
          originalError: error instanceof Error ? error.message : String(error),
          errorName: error instanceof Error ? error.name : 'Unknown',
        },
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
    // Gerar trace ID para rastreabilidade
    const traceId = crypto.randomUUID();
    // Extrair nome da função da URL (ex: 'model-extraction' de URL completa)
    const functionUrl = this.getModelExtractionFunctionUrl();
    const functionName = functionUrl.split('/functions/v1/')[1]?.split('?')[0] || 'model-extraction';

    console.log('[SectionExtractionService] Iniciando extração de modelos', {
      functionName,
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
      // Usar callEdgeFunction do baseRepository com headers customizados
      const result = await callEdgeFunction<ModelExtractionResponse>(
        functionName,
        request,
        {
          timeout: TIMEOUT_MS,
          signal: controller.signal,
          headers: {
            'x-client-trace-id': traceId,
          },
        }
      );

      clearTimeout(timeoutId);

      // Verificar se a resposta indica erro
      if (!result.ok) {
        const errorMessage = result.error?.message || "Model extraction failed";
        const errorCode = result.error?.code || 'UNKNOWN_ERROR';
        console.error('[SectionExtractionService] Erro na extração de modelos', {
          errorCode,
          errorMessage,
          details: result.error?.details,
        });
        throw new APIError(errorMessage, undefined, {
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
          functionName,
        });
        throw new APIError(
          "A extração de modelos demorou muito tempo e foi cancelada. Tente novamente com um PDF menor ou verifique os logs do servidor.",
          408,
          { timeout: TIMEOUT_MS },
        );
      }

      // Se já é um APIError ou BaseAuthError, converter para APIError ou re-throw
      if (error instanceof BaseAuthError) {
        throw new AuthenticationError();
      }

      if (error instanceof APIError) {
        throw error;
      }

      // Se é SupabaseRepositoryError, verificar tipo de erro
      if (error instanceof Error && error.name === 'SupabaseRepositoryError') {
        const errorContext = (error as any)?.context || {};
        const errorType = errorContext.errorType;

        // Erro de serviço indisponível (503)
        if (errorType === 'SERVICE_UNAVAILABLE' || errorContext.status === 503) {
          console.error('[SectionExtractionService] Serviço indisponível (modelos)', {
            error: error.message,
            context: errorContext,
          });
          throw new APIError(
            error.message || "A função não está disponível. Verifique se o Supabase local está rodando (supabase start).",
            undefined,
            {
              code: 'SERVICE_UNAVAILABLE',
              originalError: error.message,
              suggestion: errorContext.suggestion,
            },
          );
        }

        // Erro de rede (DNS, conexão)
        if (errorType === 'NETWORK_ERROR' ||
          error.message.includes('Não foi possível conectar ao servidor') ||
          error.message.includes('name resolution failed') ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('NetworkError')) {
          console.error('[SectionExtractionService] Erro de rede na requisição (modelos)', {
            error: error.message,
            context: errorContext,
          });
          throw new APIError(
            "Não foi possível conectar ao servidor. Verifique se o Supabase local está rodando (supabase start) e se a URL está configurada corretamente.",
            undefined,
            {
              code: 'NETWORK_ERROR',
              originalError: error.message,
              suggestion: errorContext.suggestion || 'Execute "supabase start" para iniciar o servidor local',
            },
          );
        }
      }

      // Verificar outros tipos de erro
      if (error instanceof Error) {
        // Timeout específico
        if (error.message.includes('Timeout') || error.name === 'AbortError') {
          throw new APIError(
            "A extração de modelos demorou muito tempo e foi cancelada.",
            408,
            { timeout: TIMEOUT_MS },
          );
        }
      }

      // Erro de rede ou outro erro
      console.error('[SectionExtractionService] Erro na requisição (modelos)', {
        error: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        context: (error as any)?.context,
      });

      throw new APIError(
        error instanceof Error ? error.message : "Erro desconhecido ao realizar extração de modelos",
        undefined,
        { originalError: String(error) },
      );
    }
  }

  /**
   * Extrai todas as seções de um modelo de uma vez com memória resumida
   * 
   * FLUXO:
   * 1. Verificar autenticação do usuário
   * 2. Gerar trace ID para rastreabilidade
   * 3. Enviar POST para edge function com extractAllSections=true
   * 4. Parsear response com tratamento de erro robusto
   * 5. Retornar resultado agregado
   * 
   * @param request - Parâmetros da extração (projectId, articleId, templateId, parentInstanceId)
   * @returns Response com resultados agregados de todas as seções
   * @throws Error se falhar a extração
   */
  static async extractAllSections(request: BatchSectionExtractionRequest): Promise<BatchSectionExtractionResponse> {
    // Gerar trace ID para rastreabilidade
    const traceId = crypto.randomUUID();
    const functionUrl = this.getFunctionUrl();
    const functionName = functionUrl.split('/functions/v1/')[1]?.split('?')[0] || 'section-extraction';

    console.log('[SectionExtractionService] Iniciando extração de todas as seções', {
      functionName,
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
      // Usar callEdgeFunction do baseRepository com headers customizados
      const result = await callEdgeFunction<BatchSectionExtractionResponse>(
        functionName,
        request,
        {
          timeout: TIMEOUT_MS,
          signal: controller.signal,
          headers: {
            'x-client-trace-id': traceId,
          },
        }
      );

      clearTimeout(timeoutId);

      // Verificar se a resposta indica erro
      if (!result.ok) {
        const errorMessage = result.error?.message || "Batch section extraction failed";
        const errorCode = result.error?.code || 'UNKNOWN_ERROR';
        console.error('[SectionExtractionService] Erro na extração de todas as seções', {
          errorCode,
          errorMessage,
          details: result.error?.details,
        });
        throw new APIError(errorMessage, undefined, {
          code: errorCode,
          details: result.error?.details,
        });
      }

      console.log('[SectionExtractionService] Extração de todas as seções concluída', {
        totalSections: result.data?.totalSections,
        successfulSections: result.data?.successfulSections,
        failedSections: result.data?.failedSections,
        totalSuggestionsCreated: result.data?.totalSuggestionsCreated,
      });

      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      // Tratamento específico para timeout
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[SectionExtractionService] Timeout na requisição (todas as seções)', {
          timeout: TIMEOUT_MS,
          functionName,
        });
        throw new APIError(
          "A extração de todas as seções demorou muito tempo e foi cancelada. Tente novamente com um PDF menor ou verifique os logs do servidor.",
          408,
          { timeout: TIMEOUT_MS },
        );
      }

      // Se já é um APIError ou BaseAuthError, converter para APIError ou re-throw
      if (error instanceof BaseAuthError) {
        throw new AuthenticationError();
      }

      if (error instanceof APIError) {
        throw error;
      }

      // Se é SupabaseRepositoryError, verificar tipo de erro
      if (error instanceof Error && error.name === 'SupabaseRepositoryError') {
        const errorContext = (error as any)?.context || {};
        const errorType = errorContext.errorType;

        // Erro de serviço indisponível (503)
        if (errorType === 'SERVICE_UNAVAILABLE' || errorContext.status === 503) {
          console.error('[SectionExtractionService] Serviço indisponível (todas as seções)', {
            error: error.message,
            context: errorContext,
          });
          throw new APIError(
            error.message || "A função não está disponível. Verifique se o Supabase local está rodando (supabase start).",
            undefined,
            {
              code: 'SERVICE_UNAVAILABLE',
              originalError: error.message,
              suggestion: errorContext.suggestion,
            },
          );
        }

        // Erro de rede (DNS, conexão)
        if (errorType === 'NETWORK_ERROR' ||
          error.message.includes('Não foi possível conectar ao servidor') ||
          error.message.includes('name resolution failed') ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('NetworkError')) {
          console.error('[SectionExtractionService] Erro de rede na requisição (todas as seções)', {
            error: error.message,
            context: errorContext,
          });
          throw new APIError(
            "Não foi possível conectar ao servidor. Verifique se o Supabase local está rodando (supabase start) e se a URL está configurada corretamente.",
            undefined,
            {
              code: 'NETWORK_ERROR',
              originalError: error.message,
              suggestion: errorContext.suggestion || 'Execute "supabase start" para iniciar o servidor local',
            },
          );
        }
      }

      // Verificar outros tipos de erro
      if (error instanceof Error) {
        // Timeout específico
        if (error.message.includes('Timeout') || error.name === 'AbortError') {
          throw new APIError(
            "A extração de todas as seções demorou muito tempo e foi cancelada.",
            408,
            { timeout: TIMEOUT_MS },
          );
        }
      }

      // Erro de rede ou outro erro
      console.error('[SectionExtractionService] Erro na requisição (todas as seções)', {
        error: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        context: (error as any)?.context,
      });

      throw new APIError(
        error instanceof Error ? error.message : "Erro desconhecido ao realizar extração de todas as seções",
        undefined,
        { originalError: String(error) },
      );
    }
  }
}

