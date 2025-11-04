/**
 * LLM Extractor para Section Extraction
 * 
 * Responsável por extrair dados estruturados usando LangChain e OpenAI.
 * 
 * TECNOLOGIA: LangChain v1 com createAgent + providerStrategy
 * - providerStrategy usa structured output nativo da OpenAI (mais confiável)
 * - Evita múltiplas tool calls (problema comum com toolStrategy)
 * - Suporta schemas complexos com aninhamento (ideal para nosso schema enriquecido)
 * 
 * SCHEMA ENRIQUECIDO: Espera resposta com { value, confidence_score, reasoning, evidence }
 * para cada campo, permitindo rastreabilidade e interpretabilidade.
 */

import { ChatOpenAI } from "npm:@langchain/openai@1";
import { createAgent, providerStrategy } from "npm:langchain@1";
import type { z } from "npm:zod@3.23.8";
import { Logger } from "../_shared/core/logger.ts";
import { RetryHandler } from "../_shared/core/retry.ts";
import { AppError, ErrorCode } from "../_shared/core/error-handler.ts";
import {
  getModelConfig,
  type SupportedModel,
  isSupportedModel,
} from "../_shared/extraction/model-config.ts";
import { CONFIG, ConfigHelpers } from "./config.ts";

/**
 * Opções de extração (modelo, temperatura, etc.)
 */
export interface SectionExtractionOptions {
  model?: SupportedModel;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Resultado da extração com metadata completa
 */
export interface SectionExtractionResult {
  data: Record<string, any> | Array<Record<string, any>>; // Dados extraídos (objeto quando "one", array quando "many")
  metadata: {
    model: string;
    tokens: {
      prompt: number;
      completion: number;
      total: number;
    };
    duration: number;
  };
}

/**
 * Classe para extração com LLM usando LangChain
 * 
 * IMPLEMENTAÇÃO:
 * - Usa createAgent com providerStrategy (structured output nativo)
 * - Retry automático para falhas transitórias
 * - Suporte a modelos: gpt-4o-mini, gpt-4o, gpt-5
 * - Tratamento de limitações específicas (ex: GPT-5 não aceita temperature customizada)
 */
export class SectionLLMExtractor {
  private static readonly DEFAULT_MODEL: SupportedModel = "gpt-4o";

  constructor(private apiKey: string, private logger: Logger) {}

  /**
   * Extrai dados estruturados usando LangChain Agent
   * 
   * FLUXO:
   * 1. Valida e configura modelo
   * 2. Cria ChatOpenAI com configuração adequada
   * 3. Cria agent com providerStrategy (structured output)
   * 4. Invoca com retry
   * 5. Extrai resposta estruturada
   * 6. Retorna dados + metadata
   * 
   * @param text - Texto do PDF extraído
   * @param schema - Schema Zod enriquecido (com confidence, reasoning, evidence)
   * @param prompt - Prompt com instruções detalhadas
   * @param options - Opções de extração (modelo, temperatura, etc.)
   * @returns Dados extraídos com metadata
   */
  async extract(
    text: string,
    schema: z.ZodObject<any> | z.ZodArray<any>, // Aceita objeto ou array
    prompt: string,
    options: SectionExtractionOptions = {},
  ): Promise<SectionExtractionResult> {
    const start = performance.now();

    try {
      // ==================== 0. VALIDAÇÃO DE PARÂMETROS ====================
      // Validar que text não é undefined/null/empty
      if (text === undefined || text === null) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid text parameter: text is ${text === undefined ? 'undefined' : 'null'}`,
          400,
          { textType: typeof text, textIsNull: text === null, textIsUndefined: text === undefined },
        );
      }

      if (typeof text !== 'string') {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid text parameter: expected string, got ${typeof text}`,
          400,
          { textType: typeof text },
        );
      }

      if (text.trim().length === 0) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Text parameter is empty - cannot extract from empty document",
          400,
        );
      }

      // ==================== 1. VALIDAÇÃO E CONFIGURAÇÃO DO MODELO ====================
      const modelName = (options.model || SectionLLMExtractor.DEFAULT_MODEL) as SupportedModel;

      if (!isSupportedModel(modelName)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Unsupported model: ${modelName}. Supported models: gpt-4o-mini, gpt-4o, gpt-5`,
          400,
        );
      }

      // Obter configuração do modelo usando helper centralizado
      // Isso lida com limitações específicas (ex: GPT-5 não aceita temperature customizada)
      const modelConfig = getModelConfig(modelName, this.apiKey, {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      });

      this.logger.debug("Configuring LLM model", {
        model: modelName,
        hasTemperature: !!modelConfig.temperature,
        hasMaxTokens: !!modelConfig.maxTokens,
      });

      // ==================== 2. CRIAÇÃO DO MODELO CHATOPENAI ====================
      // ChatOpenAI é o wrapper do LangChain para modelos OpenAI
      const model = new ChatOpenAI(modelConfig);

      // ==================== 3. CRIAÇÃO DO AGENT COM PROVIDERSTRATEGY ====================
      // providerStrategy usa structured output nativo da OpenAI
      // Vantagens:
      // - Uma única resposta estruturada (evita múltiplas tool calls)
      // - Mais confiável e eficiente
      // - Suporta schemas complexos com aninhamento
      // - Validação estrita pelo provedor
      const agent = createAgent({
        model,
        tools: [], // Sem tools adicionais, apenas structured output
        responseFormat: providerStrategy(schema),
      });

      // Detectar tipo de schema para logging
      const isArraySchema = schema._def?.typeName === "ZodArray";
      const schemaFieldsCount = isArraySchema
        ? (schema._def.type.shape ? Object.keys(schema._def.type.shape).length : 0)
        : (schema.shape ? Object.keys(schema.shape).length : 0);

      this.logger.debug("Agent created with providerStrategy", {
        model: modelName,
        schemaType: isArraySchema ? "array" : "object",
        schemaFields: schemaFieldsCount,
      });

      // ==================== 4. INVOCAÇÃO COM RETRY E TIMEOUT ====================
      // Retry automático para falhas transitórias (timeout, rate limit, etc.)
      // Não retry para erros de validação (erro do usuário, não transitório)
      // Timeout configurável por modelo (modelos maiores podem precisar mais tempo)
      const LLM_TIMEOUT_MS = ConfigHelpers.getTimeoutMs(modelName);
      const MAX_TEXT_LENGTH = ConfigHelpers.getMaxTextLength(modelName);
      const TIMEOUT_WARNING_MS = ConfigHelpers.getTimeoutWarningMs(modelName);

      const result = await RetryHandler.withRetry(
        async () => {
          try {
            // Limitar texto para evitar exceder limites de tokens
            // Truncar mantendo contexto (priorizar início do documento)
            // VALIDAÇÃO: Garantir que text é string válida antes de usar substring
            if (!text || typeof text !== 'string') {
              throw new AppError(
                ErrorCode.VALIDATION_ERROR,
                `Text is not a valid string (type: ${typeof text})`,
                400,
                { textType: typeof text },
              );
            }

            let truncatedText = text;
            if (text.length > MAX_TEXT_LENGTH) {
              this.logger.warn("Text too long, truncating", {
                originalLength: text.length,
                maxLength: MAX_TEXT_LENGTH,
                model: modelName,
              });
              truncatedText = text.substring(0, MAX_TEXT_LENGTH);
              // Adicionar nota no prompt sobre truncamento
              const truncationNote = `\n\n[NOTE: Document was truncated to ${MAX_TEXT_LENGTH} characters due to length. Extracting from beginning of document.]`;
              truncatedText += truncationNote;
            }

            // ==================== TIMEOUT WARNING PROATIVO ====================
            // Alertar quando próximo do timeout (80% do tempo) para monitoramento
            let timeoutWarningTimer: number | null = null;
            const warningStartTime = performance.now();
            
            timeoutWarningTimer = setTimeout(() => {
              const elapsed = performance.now() - warningStartTime;
              this.logger.warn("LLM extraction approaching timeout", {
                model: modelName,
                elapsedMs: Math.round(elapsed),
                timeoutMs: LLM_TIMEOUT_MS,
                warningThreshold: `${(CONFIG.llm.timeout.warningThreshold * 100).toFixed(0)}%`,
                timeRemainingMs: LLM_TIMEOUT_MS - elapsed,
              });
              // Métrica para rastrear quando extrações estão próximas do timeout
              this.logger.metric("llm_extraction_timeout_warning", elapsed, "ms", {
                model: modelName,
                timeoutMs: LLM_TIMEOUT_MS,
              });
            }, TIMEOUT_WARNING_MS) as unknown as number;

            try {
              // CRÍTICO: Promise.race não cancela a promise original
              // Se timeout ocorrer, agent.invoke() continua rodando em background
              // Isso pode fazer a função ultrapassar 150s do Supabase
              //
              // SOLUÇÃO: Usar AbortController para cancelar a invocação quando timeout ocorrer
              // (se LangChain suportar - verificar documentação)
              // Por enquanto, usar Promise.race mas garantir que timeout é respeitado estritamente

            // Criar promise com timeout para evitar espera indefinida
              // Usar invoke com callbacks para capturar metadata completa
              let timeoutId: number | null = null;
              
            const invokePromise = agent.invoke({
              messages: [
                {
                  role: "user",
                  content: `${prompt}\n\n---DOCUMENT TEXT START---\n${truncatedText}\n---DOCUMENT TEXT END---`,
                },
              ],
              }) as Promise<any>; // Promise que retorna resultado completo

            // Aplicar timeout explícito
              const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(
                  () => {
                    this.logger.warn("LLM invocation timeout - rejecting promise", {
                      timeoutMs: LLM_TIMEOUT_MS,
                      model: modelName,
                      textLength: truncatedText.length,
                    });
                    reject(new Error(`LLM invocation timeout (${LLM_TIMEOUT_MS / 1000}s)`));
                  },
                  LLM_TIMEOUT_MS,
                ) as unknown as number;
            });

              try {
            const response = await Promise.race([invokePromise, timeoutPromise]);
                
                // Limpar timers se completou a tempo
                if (timeoutId !== null) {
                  clearTimeout(timeoutId);
                }
                if (timeoutWarningTimer !== null) {
                  clearTimeout(timeoutWarningTimer);
                }
                
            return response;
              } catch (raceError) {
                // Limpar todos os timers em caso de erro
                if (timeoutId !== null) {
                  clearTimeout(timeoutId);
                }
                if (timeoutWarningTimer !== null) {
                  clearTimeout(timeoutWarningTimer);
                }
                
                // IMPORTANTE: Se timeout ocorreu, não esperar invokePromise terminar
                // Re-throw imediatamente para evitar que função continue rodando
                throw raceError;
              }
            } catch (invokeError) {
              // Limpar warning timer em caso de erro
              if (timeoutWarningTimer !== null) {
                clearTimeout(timeoutWarningTimer);
              }
              throw invokeError;
            }
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            const errorStack = err instanceof Error ? err.stack : undefined;

            // Identificar tipo de erro para melhor tratamento
            const isTimeout = errorMessage.toLowerCase().includes("timeout");
            const isRateLimit = errorMessage.toLowerCase().includes("rate limit") ||
              errorMessage.toLowerCase().includes("429");
            const isValidationError = errorMessage.toLowerCase().includes("validation") ||
              errorMessage.toLowerCase().includes("schema");

            this.logger.error("Agent invocation failed", err as Error, {
              errorMessage,
              errorStack,
              model: modelName,
              errorType: isTimeout ? "timeout" : isRateLimit ? "rate_limit" : isValidationError ? "validation" : "unknown",
            });

            // Timeout é erro específico que deve ser retry-able
            if (isTimeout) {
              throw new AppError(
                ErrorCode.TIMEOUT,
                `LLM extraction timeout after ${LLM_TIMEOUT_MS / 1000}s: ${errorMessage}`,
                500,
                {
                  error: errorMessage,
                  model: modelName,
                  timeout: LLM_TIMEOUT_MS,
                },
              );
            }

            throw new AppError(
              ErrorCode.LLM_ERROR,
              `LLM extraction failed: ${errorMessage}`,
              500,
              {
                error: errorMessage,
                stack: errorStack,
                model: modelName,
              },
            );
          }
        },
        {
          maxAttempts: CONFIG.retry.maxAttempts,
          initialDelayMs: CONFIG.retry.initialDelayMs,
          shouldRetry: (e: unknown) => {
            // Não retry para erros de validação (problema no schema/prompt, não transitório)
            const errorMessage = (e instanceof Error ? e.message : String(e))?.toLowerCase() || "";
            const isValidationError = errorMessage.includes("validation") ||
              errorMessage.includes("schema") ||
              errorMessage.includes("invalid schema") ||
              errorMessage.includes("required") ||
              errorMessage.includes("missing");
            
            // CRÍTICO: Erros de schema NÃO devem ser retried - são erros permanentes
            // que indicam problema na configuração, não problema transitório
            if (isValidationError) {
              this.logger.error("Schema validation error - NOT retrying", e as Error, {
                errorMessage,
                suggestion: "Check schema definition - this is a permanent configuration error",
              });
              return false;
            }
            
            // CRÍTICO: Timeouts NÃO devem ser retried se já tentamos 2 vezes
            // Timeout indica que LLM está demorando muito, não problema transitório
            // Retry de timeout só piora o problema (aumenta tempo total)
            // 
            // Apenas retry para rate limits (429) que são problemas transitórios
            const isRateLimit = errorMessage.includes("rate limit") ||
              errorMessage.includes("429");
            
            // NÃO retry para timeouts - timeout indica problema permanente (texto muito longo, etc)
            if (errorMessage.includes("timeout") || (e instanceof AppError && e.code === ErrorCode.TIMEOUT)) {
              this.logger.warn("LLM timeout - NOT retrying", {
                errorMessage,
                suggestion: "Timeout indicates LLM is too slow. Reduce text length or number of fields.",
              });
              return false;
            }
            
            // Apenas retry para rate limits
            return isRateLimit;
          },
        },
      );

      const duration = performance.now() - start;

      // ==================== 5. EXTRAÇÃO DA RESPOSTA ESTRUTURADA ====================
      // providerStrategy retorna resposta em diferentes propriedades dependendo da versão do LangChain
      // Tentar múltiplas propriedades para compatibilidade
      interface LangChainResult {
        structuredResponse?: unknown;
        response?: unknown;
        output?: unknown;
        response_metadata?: {
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
          tokenUsage?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
          };
        };
        usage_metadata?: {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        };
        [key: string]: unknown;
      }

      const typedResult = result as LangChainResult & {
        messages?: Array<{
          response_metadata?: {
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
            tokenUsage?: {
              promptTokens?: number;
              completionTokens?: number;
              totalTokens?: number;
            };
          };
          usage_metadata?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
          };
        }>;
      };

      // Log completo da estrutura para debugging
      // CRÍTICO: Validar que typedResult pode ser stringified antes de usar substring
      const resultString = typedResult !== undefined && typedResult !== null
        ? JSON.stringify(typedResult)
        : '(result is null or undefined)';
      
      this.logger.debug("Agent result structure", {
        hasStructuredResponse: !!typedResult.structuredResponse,
        resultKeys: typedResult ? Object.keys(typedResult) : [],
        hasMessages: Array.isArray(typedResult.messages),
        messagesCount: typedResult.messages?.length || 0,
        responseMetadata: !!typedResult.response_metadata,
        responseMetadataKeys: typedResult.response_metadata ? Object.keys(typedResult.response_metadata) : [],
        firstMessageKeys: typedResult.messages?.[0] ? Object.keys(typedResult.messages[0]) : [],
        fullStructure: typeof resultString === 'string' ? resultString.substring(0, 1000) : resultString, // Primeiros 1000 chars para debug
      });

      // Tentar extrair usage de múltiplos locais possíveis
      // 1. Do resultado direto
      let usage = 
        typedResult.response_metadata?.usage ||
        typedResult.response_metadata?.tokenUsage ||
        typedResult.usage_metadata ||
        {};

      // 2. Se não encontrou, tentar das mensagens (comum em createAgent)
      if (!usage || Object.keys(usage).length === 0) {
        const lastMessage = typedResult.messages?.[typedResult.messages.length - 1];
        if (lastMessage) {
          usage = 
            lastMessage.response_metadata?.usage ||
            lastMessage.response_metadata?.tokenUsage ||
            lastMessage.usage_metadata ||
            usage;
        }
      }

      // 3. Tentar de todas as mensagens (alguns casos especiais)
      if (!usage || Object.keys(usage).length === 0) {
        for (const msg of typedResult.messages || []) {
          const msgUsage = 
            msg.response_metadata?.usage ||
            msg.response_metadata?.tokenUsage ||
            msg.usage_metadata;
          if (msgUsage && Object.keys(msgUsage).length > 0) {
            usage = msgUsage;
            break;
          }
        }
      }

      // Extrair resposta estruturada
      // providerStrategy pode retornar em diferentes formatos dependendo da versão
      const structuredResponse =
        typedResult.structuredResponse ||
        typedResult.response ||
        typedResult.output ||
        result;

      // Validação: garantir que temos uma resposta estruturada válida
      if (!structuredResponse || typeof structuredResponse !== "object") {
        this.logger.error("Invalid structured response", new Error("No structured response found"), {
          resultType: typeof result,
          resultKeys: Object.keys(typedResult),
          hasStructuredResponse: !!typedResult.structuredResponse,
          hasResponse: !!typedResult.response,
          hasOutput: !!typedResult.output,
        });
        throw new AppError(
          ErrorCode.LLM_ERROR,
          "Invalid response from LLM: no structured data found",
          500,
          {
            resultType: typeof result,
            availableKeys: Object.keys(typedResult),
          },
        );
      }

      // ==================== 6. VALIDAÇÃO E FILTRAGEM DE CAMPOS ====================
      // Validar que os campos retornados pela LLM correspondem ao schema esperado
      // IMPORTANTE: schema pode ser objeto wrapper com array (para cardinality="many")
      // ou objeto direto (para cardinality="one")
      let validatedResponse: any;
      
      if (schema._def?.typeName === "ZodObject") {
        // Verificar se é wrapper object { items: [...] } para cardinality="many"
        const shape = schema.shape || {};
        const hasItemsField = "items" in shape;
        
        if (hasItemsField && structuredResponse && typeof structuredResponse === "object" && !Array.isArray(structuredResponse)) {
          // É wrapper object: extrair items array e validar cada item
          const itemsField = structuredResponse.items;
          if (Array.isArray(itemsField)) {
            const innerSchema = shape.items._def?.type; // Schema do array interno
            if (innerSchema && innerSchema._def?.typeName === "ZodArray") {
              const itemSchema = innerSchema._def.type; // Schema do item
              validatedResponse = {
                items: itemsField.map((item: any) => 
                  this.validateAndFilterLLMResponse(item as Record<string, unknown>, itemSchema, modelName)
                ),
              };
            } else {
              validatedResponse = structuredResponse; // Fallback
            }
          } else {
            validatedResponse = structuredResponse;
          }
        } else {
          // Objeto direto: validar normalmente
          validatedResponse = this.validateAndFilterLLMResponse(
            structuredResponse as Record<string, unknown>,
            schema,
            modelName,
          );
        }
      } else {
        // Fallback para outros tipos de schema
        validatedResponse = structuredResponse;
      }

      // ==================== 7. VALIDAÇÃO E NORMALIZAÇÃO DOS DADOS ====================
      // Garantir que a resposta tem pelo menos alguns campos extraídos
      // IMPORTANTE: validatedResponse pode ser objeto wrapper { items: [...] } ou objeto direto
      let actualDataForMetrics: any;
      let isArrayResponse = false;
      
      // Verificar se é wrapper object com items
      if (validatedResponse && typeof validatedResponse === "object" && !Array.isArray(validatedResponse) && "items" in validatedResponse) {
        actualDataForMetrics = validatedResponse.items;
        isArrayResponse = Array.isArray(actualDataForMetrics);
      } else {
        actualDataForMetrics = validatedResponse;
        isArrayResponse = Array.isArray(validatedResponse);
      }

      const extractedFields = isArrayResponse
        ? (actualDataForMetrics.length > 0 ? Object.keys(actualDataForMetrics[0] || {}) : [])
        : Object.keys(actualDataForMetrics);
      
      // Contar quantos campos têm evidence e reasoning
      // IMPORTANTE: actualDataForMetrics pode ser array ou objeto
      let fieldsWithEvidence = 0;
      let fieldsWithReasoning = 0;
      let totalConfidence = 0;
      let validConfidenceCount = 0;
      
      if (isArrayResponse) {
        // Processar array: iterar sobre cada item e seus campos
        for (const item of actualDataForMetrics) {
          if (item && typeof item === "object") {
            for (const [fieldName, fieldData] of Object.entries(item)) {
              if (fieldData && typeof fieldData === "object") {
                const data = fieldData as any;
                if (data.evidence?.text) {
                  fieldsWithEvidence++;
                }
                if (data.reasoning && typeof data.reasoning === "string" && data.reasoning.length > 0) {
                  fieldsWithReasoning++;
                }
                if (typeof data.confidence_score === "number") {
                  totalConfidence += data.confidence_score;
                  validConfidenceCount++;
                }
              }
            }
          }
        }
      } else {
        // Processar objeto: comportamento padrão
        for (const [fieldName, fieldData] of Object.entries(actualDataForMetrics)) {
          if (fieldData && typeof fieldData === "object") {
            const data = fieldData as any;
            if (data.evidence?.text) {
              fieldsWithEvidence++;
            }
            if (data.reasoning && typeof data.reasoning === "string" && data.reasoning.length > 0) {
              fieldsWithReasoning++;
            }
            if (typeof data.confidence_score === "number") {
              totalConfidence += data.confidence_score;
              validConfidenceCount++;
            }
          }
        }
      }

      if (extractedFields.length === 0) {
        this.logger.warn("LLM returned empty extraction", {
          model: modelName,
          resultStructure: Object.keys(typedResult),
        });
      } else {
        this.logger.info("Extraction quality metrics", {
          fieldsExtracted: extractedFields.length,
          fieldsWithEvidence,
          fieldsWithReasoning,
          evidenceCoverage: `${((fieldsWithEvidence / extractedFields.length) * 100).toFixed(1)}%`,
          reasoningCoverage: `${((fieldsWithReasoning / extractedFields.length) * 100).toFixed(1)}%`,
          avgConfidence: validConfidenceCount > 0 
            ? (totalConfidence / validConfidenceCount).toFixed(3)
            : "N/A",
        });
      }

      // Normalizar contagem de tokens (diferentes formatos de resposta)
      // LangChain pode retornar em diferentes formatos, tentar todos
      const usageAny = usage as Record<string, unknown>;
      
      const tokens = {
        prompt: 
          (usageAny.prompt_tokens as number) ||
          (usageAny.promptTokens as number) ||
          0,
        completion: 
          (usageAny.completion_tokens as number) ||
          (usageAny.completionTokens as number) ||
          0,
        total: 
          (usageAny.total_tokens as number) ||
          (usageAny.totalTokens as number) ||
          0,
      };

      // Se total é 0 mas temos prompt ou completion, calcular
      if (tokens.total === 0 && (tokens.prompt > 0 || tokens.completion > 0)) {
        tokens.total = tokens.prompt + tokens.completion;
      }

      // Log detalhado do usage encontrado
      this.logger.debug("Token usage extracted", {
        usageObject: usage,
        tokensExtracted: tokens,
        usageKeys: Object.keys(usageAny),
      });

      // ==================== 7. LOG E RETORNO ====================
      this.logger.info("LLM extraction completed", {
        duration: `${duration.toFixed(0)}ms`,
        tokens: tokens.total,
        model: modelName,
        fieldsExtracted: extractedFields.length,
        fieldNames: extractedFields.slice(0, 10), // Limitar log a 10 primeiros campos
      });

      // Extrair dados finais: se é wrapper { items: [...] }, retornar apenas o array
      // Se é objeto direto, retornar como está
      let finalData: any;
      if (validatedResponse && typeof validatedResponse === "object" && !Array.isArray(validatedResponse) && "items" in validatedResponse) {
        finalData = validatedResponse.items; // Extrair array de items
      } else {
        finalData = validatedResponse; // Objeto direto ou array
      }

      return {
        data: finalData,
        metadata: {
          model: modelName,
          tokens,
          duration,
        },
      };
    } catch (err) {
      this.logger.error("LLM extraction failed", err as Error);
      throw err;
    }
  }

  /**
   * Valida e filtra resposta da LLM contra o schema esperado
   * 
   * Remove campos não esperados (logando warning) e mantém apenas
   * campos que existem no schema.
   * 
   * @param llmResponse - Resposta bruta da LLM
   * @param schema - Schema Zod esperado
   * @param modelName - Nome do modelo usado (para logging)
   * @returns Resposta filtrada contendo apenas campos esperados
   */
  private validateAndFilterLLMResponse(
    llmResponse: Record<string, unknown>,
    schema: z.ZodObject<any>,
    modelName: string,
  ): Record<string, unknown> {
    const expectedFields = Object.keys(schema.shape);
    const returnedFields = Object.keys(llmResponse);
    
    // Identificar campos não esperados
    const unexpectedFields = returnedFields.filter(
      field => !expectedFields.includes(field),
    );
    
    // Identificar campos esperados que não foram retornados
    const missingFields = expectedFields.filter(
      field => !returnedFields.includes(field),
    );

    // Logar warning se há campos inesperados
    if (unexpectedFields.length > 0) {
      this.logger.warn("LLM returned unexpected fields - filtering out", {
        model: modelName,
        unexpectedFields,
        unexpectedCount: unexpectedFields.length,
        expectedFields,
        returnedFields,
        action: "Fields will be ignored, only expected fields will be processed",
      });
      
      // Métrica para rastrear frequência de campos inesperados
      this.logger.metric("llm_unexpected_fields_count", unexpectedFields.length, "count", {
        model: modelName,
      });
    }

    // Logar info se há campos esperados faltando (apenas para debug)
    if (missingFields.length > 0) {
      this.logger.debug("Expected fields not returned by LLM", {
        model: modelName,
        missingFields,
        missingCount: missingFields.length,
      });
    }

    // Filtrar resposta: manter apenas campos esperados
    const filteredResponse: Record<string, unknown> = {};
    for (const field of expectedFields) {
      if (field in llmResponse) {
        filteredResponse[field] = llmResponse[field];
      }
    }

    return filteredResponse;
  }
}

