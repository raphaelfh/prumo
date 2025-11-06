/**
 * Instructor.js Extractor - Módulo Compartilhado
 * 
 * Módulo reutilizável para extração estruturada usando Instructor.js.
 * 
 * CARACTERÍSTICAS:
 * - Interface simples e reutilizável (DRY)
 * - Suporte a schemas Zod complexos
 * - Tratamento de erros padronizado
 * - Observabilidade integrada (logs, métricas)
 * 
 * PRINCÍPIO KISS: Interface simples que encapsula a complexidade do Instructor.js
 */

import { z } from "npm:zod@3.23.8";
import { Logger } from "../core/logger.ts";
import { AppError, ErrorCode } from "../core/error-handler.ts";
import { RetryHandler } from "../core/retry.ts";

/**
 * Opções de extração com Instructor.js
 */
export interface InstructorExtractionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
}

/**
 * Resultado da extração
 */
export interface InstructorExtractionResult<T = any> {
  data: T;
  metadata: {
    model: string;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    duration: number;
  };
}

/**
 * Classe para extração estruturada usando Instructor.js
 * 
 * MÓDULO REUTILIZÁVEL: Pode ser usado por qualquer Edge Function que precise
 * de extração estruturada com Instructor.js.
 */
export class InstructorExtractor {
  private static readonly DEFAULT_MODEL = "gpt-4o-mini";
  private static readonly DEFAULT_TIMEOUT_MS = 60000; // 60s

  constructor(
    private apiKey: string,
    private logger: Logger,
  ) {}

  /**
   * Extrai dados estruturados usando Instructor.js
   * 
   * @param text - Texto a extrair
   * @param schema - Schema Zod para validação do output
   * @param prompt - Prompt com instruções para o LLM
   * @param options - Opções de extração (modelo, temperatura, etc.)
   * @returns Dados extraídos com metadata
   */
  async extract<T extends z.ZodTypeAny>(
    text: string,
    schema: T,
    prompt: string,
    options: InstructorExtractionOptions = {},
  ): Promise<InstructorExtractionResult<z.infer<T>>> {
    const start = performance.now();

    try {
      // Validação de entrada
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Text parameter is empty or invalid",
          400,
        );
      }

      const model = options.model || InstructorExtractor.DEFAULT_MODEL;
      const maxRetries = options.maxRetries ?? 2;

      this.logger.debug("Starting Instructor.js extraction", {
        model,
        textLength: text.length,
        schemaType: schema._def?.typeName || "unknown",
      });

      // Extrair com retry
      const result = await RetryHandler.withRetry(
        async () => {
          return await this._callInstructor(text, schema, prompt, {
            model,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
          });
        },
        {
          maxAttempts: maxRetries + 1,
          initialDelayMs: 1000,
          shouldRetry: (error) => {
            // Retry apenas para erros transitórios
            if (error instanceof AppError) {
              return error.code === ErrorCode.TIMEOUT || 
                     error.code === ErrorCode.LLM_ERROR;
            }
            return false;
          },
        },
      );

      const duration = performance.now() - start;

      this.logger.info("Instructor.js extraction completed", {
        model,
        duration: `${duration.toFixed(2)}ms`,
        textLength: text.length,
      });

      return {
        data: result,
        metadata: {
          model,
          duration,
        },
      };
    } catch (error) {
      const duration = performance.now() - start;

      this.logger.error("Instructor.js extraction failed", error, {
        duration: `${duration.toFixed(2)}ms`,
        textLength: text.length,
      });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        ErrorCode.LLM_ERROR,
        error instanceof Error ? error.message : "Extraction failed",
        500,
        { originalError: String(error) },
      );
    }
  }

  /**
   * Chamada real ao Instructor.js
   * 
   * PRIVADO: Encapsula a lógica de integração com Instructor.js
   * 
   * NOTA: A API do Instructor.js pode variar. Esta implementação usa a estrutura
   * mais comum. Ajuste conforme a versão específica da biblioteca.
   */
  private async _callInstructor<T extends z.ZodTypeAny>(
    text: string,
    schema: T,
    prompt: string,
    options: {
      model: string;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<z.infer<T>> {
    try {
      // Importar Instructor.js
      // Tentar diferentes formas de import dependendo da versão
      let instructorFn: any;
      let createOpenAIClient: any;

      try {
        // Tentar import do @instructor-ai/instructor (versão mais recente)
        const instructorModule = await import("npm:@instructor-ai/instructor@^1.0.0");
        const openaiModule = await import("npm:openai@^4.0.0");
        
        // A API do Instructor.js pode variar - tentar diferentes formatos
        instructorFn = instructorModule.default || instructorModule.instructor || instructorModule;
        
        // OpenAI é uma classe, precisa ser instanciada com 'new'
        const OpenAI = openaiModule.default || openaiModule.OpenAI;
        createOpenAIClient = OpenAI;
      } catch {
        // Fallback: tentar outras formas de import
        try {
          const instructorModule = await import("npm:instructor@^1.0.0");
          instructorFn = instructorModule.default || instructorModule.instructor || instructorModule;
        } catch {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            "Instructor.js package not found. Install: npm:@instructor-ai/instructor",
            500,
          );
        }
      }

      // Criar cliente OpenAI (usar 'new' se for uma classe)
      let client: any;
      if (createOpenAIClient) {
        // Verificar se é uma classe (instanciar com 'new')
        if (typeof createOpenAIClient === 'function' && createOpenAIClient.prototype) {
          client = new createOpenAIClient({ apiKey: this.apiKey });
        } else {
          // Se não for classe, usar como função
          client = createOpenAIClient({ apiKey: this.apiKey });
        }
      } else {
        client = { apiKey: this.apiKey };
      }

      // Criar cliente Instructor
      // API pode variar: instructor({ client }) ou instructor(client)
      const instructorClient = typeof instructorFn === 'function'
        ? instructorFn({ client })
        : instructorFn;

      // Configurar modelo
      const model = options.model || InstructorExtractor.DEFAULT_MODEL;

      // Criar prompt completo
      const fullPrompt = `${prompt}\n\nTexto a extrair:\n${text}`;

      // Chamar Instructor.js com timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        InstructorExtractor.DEFAULT_TIMEOUT_MS,
      );

      try {
        // Tentar diferentes formas de chamada da API
        let result: any;

        // Forma 1: instructorClient.chat.completions.create com response_model
        if (instructorClient.chat?.completions?.create) {
          this.logger.debug("Calling Instructor.js with chat.completions.create", {
            model,
            promptLength: fullPrompt.length,
            schemaType: schema._def?.typeName || "unknown",
          });

          try {
            const response = await instructorClient.chat.completions.create({
              model,
              messages: [
                {
                  role: "user",
                  content: fullPrompt,
                },
              ],
              response_model: {
                schema,
                name: "extraction_result",
              },
              ...(options.temperature !== undefined && { temperature: options.temperature }),
              ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
            }, {
              signal: controller.signal,
            });

            result = response.parsed || response;
            
            // Log sucesso
            this.logger.debug("Instructor.js response received", {
              hasParsed: !!response.parsed,
              hasData: !!result,
            });
          } catch (apiError: any) {
            // Log erro específico da API
            const apiErrorMessage = apiError instanceof Error ? apiError.message : String(apiError);
            this.logger.error("Instructor.js API call failed", apiError instanceof Error ? apiError : new Error(apiErrorMessage), {
              model,
              errorMessage: apiErrorMessage,
              errorType: apiError?.type || "unknown",
              errorCode: apiError?.code || "unknown",
            });
            throw apiError; // Re-throw para tratamento externo
          }
        }
        // Forma 2: instructorClient.extract ou similar
        else if (instructorClient.extract) {
          result = await instructorClient.extract({
            text: fullPrompt,
            schema,
            model,
            ...(options.temperature !== undefined && { temperature: options.temperature }),
            ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
          }, {
            signal: controller.signal,
          });
        }
        // Forma 3: API direta
        else {
          throw new AppError(
            ErrorCode.INTERNAL_ERROR,
            "Instructor.js API format not recognized. Please check documentation.",
            500,
          );
        }

        clearTimeout(timeoutId);

        // Validar resultado
        if (!result) {
          throw new AppError(
            ErrorCode.LLM_ERROR,
            "Instructor.js returned no data",
            500,
          );
        }

        // Validar com schema Zod
        const validated = schema.safeParse(result);
        if (!validated.success) {
          throw new AppError(
            ErrorCode.LLM_ERROR,
            "Extracted data does not match schema",
            500,
            { validationErrors: validated.error.errors },
          );
        }

        return validated.data as z.infer<T>;
      } catch (error: any) {
        clearTimeout(timeoutId);

        const errorMessage = error instanceof Error ? error.message : String(error || "Unknown error");
        
        // Tratar timeout específico
        if (error.name === "AbortError" || error.message?.includes("timeout") || errorMessage.toLowerCase().includes("timeout")) {
          throw new AppError(
            ErrorCode.TIMEOUT,
            `Extraction timeout after ${InstructorExtractor.DEFAULT_TIMEOUT_MS}ms`,
            408,
            { timeoutMs: InstructorExtractor.DEFAULT_TIMEOUT_MS },
          );
        }

        // Tratar erro de resposta inválida ANTES de re-throw
        const isInvalidResponse = errorMessage.toLowerCase().includes("invalid response") ||
          errorMessage.toLowerCase().includes("upstream server") ||
          errorMessage.toLowerCase().includes("invalid response was received");

        if (isInvalidResponse) {
          throw new AppError(
            ErrorCode.LLM_ERROR,
            `OpenAI API returned an invalid response. This may be a temporary issue. Try again or use a different model.`,
            500,
            {
              error: errorMessage,
              suggestion: "This error may be caused by the model being unavailable or overloaded. Try using gpt-4o-mini for more stable responses.",
            },
          );
        }

        // Re-throw outros erros para tratamento externo
        throw error;
      }
    } catch (error) {
      // Tratar erros específicos do Instructor.js
      if (error instanceof AppError) {
        throw error;
      }

      // Verificar se é erro de API OpenAI
      const errorMessage = error instanceof Error ? error.message : (error && typeof error === 'object' && 'message' in error ? String(error.message) : "Unknown error");
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Identificar tipo de erro para melhor tratamento
      const isTimeout = errorMessage.toLowerCase().includes("timeout");
      const isRateLimit = errorMessage.toLowerCase().includes("rate limit") ||
        errorMessage.toLowerCase().includes("429");
      const isInvalidResponse = errorMessage.toLowerCase().includes("invalid response") ||
        errorMessage.toLowerCase().includes("upstream server") ||
        errorMessage.toLowerCase().includes("invalid response was received");

      this.logger.error("Instructor.js extraction failed", error instanceof Error ? error : new Error(errorMessage), {
        errorMessage,
        errorStack,
        errorType: isTimeout ? "timeout" : isRateLimit ? "rate_limit" : isInvalidResponse ? "invalid_response" : "unknown",
      });

      if (isTimeout) {
        throw new AppError(
          ErrorCode.TIMEOUT,
          `Extraction timeout: ${errorMessage}`,
          408,
          { timeoutMs: InstructorExtractor.DEFAULT_TIMEOUT_MS },
        );
      }

      if (isInvalidResponse) {
        throw new AppError(
          ErrorCode.LLM_ERROR,
          `OpenAI API returned an invalid response. This may be a temporary issue. Try again or use a different model.`,
          500,
          {
            error: errorMessage,
            suggestion: "This error may be caused by the model being unavailable or overloaded. Try using gpt-4o-mini for more stable responses.",
          },
        );
      }

      if (isRateLimit) {
        throw new AppError(
          ErrorCode.LLM_ERROR,
          `OpenAI API rate limit exceeded: ${errorMessage}`,
          429,
          {
            error: errorMessage,
            suggestion: "Wait a few seconds and try again, or reduce the frequency of requests.",
          },
        );
      }

      throw new AppError(
        ErrorCode.LLM_ERROR,
        `Instructor.js extraction failed: ${errorMessage}`,
        500,
        { originalError: String(error) },
      );
    }
  }
}

