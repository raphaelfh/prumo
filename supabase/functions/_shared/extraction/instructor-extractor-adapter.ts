/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * InstructorExtractor Adapter - Wrapper para compatibilidade
 * 
 * Adapta InstructorExtractor para ter interface compatível com LangchainExtractor,
 * normalizando o formato de resposta para manter compatibilidade com os pipelines.
 * 
 * PRINCÍPIOS:
 * - DRY: Reutiliza InstructorExtractor sem duplicar lógica
 * - KISS: Apenas normaliza o que é necessário (tokens, formato de data)
 * - Modular: Não altera InstructorExtractor original, apenas adapta interface
 */

import { z } from "npm:zod@3.23.8";
import { Logger } from "../core/logger.ts";
import { InstructorExtractor, InstructorExtractionOptions } from "./instructor-extractor.ts";
import type { SupportedModel } from "./model-config.ts";

/**
 * Opções de extração (compatível com LangchainExtractionOptions)
 */
export interface InstructorExtractionAdapterOptions {
  model?: SupportedModel;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Resultado da extração (compatível com LangchainExtractionResult)
 */
export interface InstructorExtractionAdapterResult {
  data: Record<string, any> | Array<Record<string, any>>;
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
 * Adapter que normaliza InstructorExtractor para formato compatível com LangchainExtractor
 * 
 * NORMALIZAÇÕES:
 * 1. Tokens: metadata.usage → metadata.tokens (com fallback para 0)
 * 2. Modelo: string → SupportedModel (cast simples)
 * 3. Data: Garante formato Record ou Array
 */
export class InstructorExtractorAdapter {
  private instructorExtractor: InstructorExtractor;

  constructor(
    apiKey: string,
    logger: Logger,
  ) {
    this.instructorExtractor = new InstructorExtractor(apiKey, logger);
  }

  /**
   * Extrai dados estruturados usando Instructor.js (com interface normalizada)
   * 
   * @param text - Texto do PDF extraído
   * @param schema - Schema Zod enriquecido
   * @param prompt - Prompt com instruções detalhadas
   * @param options - Opções de extração (modelo, temperatura, etc.)
   * @returns Dados extraídos com metadata normalizada
   */
  async extract(
    text: string,
    schema: z.ZodObject<any> | z.ZodArray<any>,
    prompt: string,
    options: InstructorExtractionAdapterOptions = {},
  ): Promise<InstructorExtractionAdapterResult> {
    // Converter SupportedModel para string (cast simples)
    const modelString = options.model || "gpt-4o-mini";

    // Chamar InstructorExtractor com opções convertidas
    const instructorOptions: InstructorExtractionOptions = {
      model: modelString,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    };

    const result = await this.instructorExtractor.extract(
      text,
      schema,
      prompt,
      instructorOptions,
    );

    // Normalizar formato de tokens: metadata.usage → metadata.tokens
    const tokens = {
      prompt: result.metadata.usage?.promptTokens || 0,
      completion: result.metadata.usage?.completionTokens || 0,
      total: result.metadata.usage?.totalTokens || 0,
    };

    // Calcular total se não estiver disponível mas temos prompt/completion
    if (tokens.total === 0 && (tokens.prompt > 0 || tokens.completion > 0)) {
      tokens.total = tokens.prompt + tokens.completion;
    }

    // CRÍTICO: Extrair wrapper { items: [...] } para cardinality="many"
    // O schema pode retornar wrapper object quando cardinality="many"
    // Precisamos extrair o array de dentro do wrapper para compatibilidade com o pipeline
    let normalizedData: Record<string, any> | Array<Record<string, any>>;
    
    if (Array.isArray(result.data)) {
      // Já é array direto: usar como está
      normalizedData = result.data as Array<Record<string, any>>;
    } else if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
      // Verificar se é wrapper object { items: [...] } para cardinality="many"
      const dataObj = result.data as Record<string, any>;
      if ('items' in dataObj && Array.isArray(dataObj.items)) {
        // É wrapper: extrair array de items
        normalizedData = dataObj.items as Array<Record<string, any>>;
      } else {
        // Objeto direto (cardinality="one"): usar como está
        normalizedData = dataObj;
      }
    } else {
      // Fallback: converter para objeto vazio se tipo inválido
      normalizedData = {};
    }

    return {
      data: normalizedData,
      metadata: {
        model: result.metadata.model,
        tokens,
        duration: result.metadata.duration,
      },
    };
  }
}

