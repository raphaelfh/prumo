/**
 * Extractor Factory - Factory modular para escolher extractor
 * 
 * Permite trocar facilmente entre LangChain e Instructor.js
 * mantendo interface compatível.
 * 
 * PRINCÍPIOS:
 * - Modular: Fácil trocar extractor sem alterar pipelines
 * - KISS: Configuração simples via variável de ambiente
 * - DRY: Interface unificada para ambos extractors
 */

import { Logger } from "../core/logger.ts";
import { LangchainExtractor, type ExtractionConfig } from "./langchain-extractor.ts";
import { InstructorExtractorAdapter } from "./instructor-extractor-adapter.ts";

// Declaração de tipos do Deno (ambiente de execução)
declare const Deno: {
  env: { get(key: string): string | undefined };
};

/**
 * Tipo de extractor disponível
 */
export type ExtractorType = "langchain" | "instructor";

/**
 * Interface unificada para todos os extractors
 */
export interface UnifiedExtractor {
  extract(
    text: string,
    schema: any,
    prompt: string,
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<{
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
  }>;
}

/**
 * Factory para criar extractor baseado em configuração
 * 
 * CONFIGURAÇÃO:
 * - Variável de ambiente: EXTRACTION_ENGINE (default: "langchain")
 * - Valores: "langchain" ou "instructor"
 */
export class ExtractorFactory {
  /**
   * Determina qual extractor usar baseado em configuração
   */
  static getExtractorType(): ExtractorType {
    // Variável de ambiente: EXTRACTION_ENGINE
    const envEngine = Deno.env.get("EXTRACTION_ENGINE")?.toLowerCase();
    
    if (envEngine === "instructor") {
      return "instructor";
    }
    
    // Default: langchain (mais estável)
    return "langchain";
  }

  /**
   * Cria extractor baseado no tipo configurado
   */
  static createExtractor(
    apiKey: string,
    logger: Logger,
    config?: ExtractionConfig,
  ): UnifiedExtractor {
    const extractorType = ExtractorFactory.getExtractorType();

    logger.info("Creating extractor", {
      type: extractorType,
      source: "EXTRACTION_ENGINE env var or default",
    });

    if (extractorType === "instructor") {
      return new InstructorExtractorAdapter(apiKey, logger);
    }

    // Default: LangChain
    // Se não tem config, usar valores padrão
    const defaultConfig: ExtractionConfig = config || {
      retry: {
        maxAttempts: 3,
        initialDelayMs: 1000,
      },
      llm: {
        timeout: {
          base: 60000, // 60s
          warningThreshold: 0.8,
        },
        maxTextLength: {
          base: 100000, // 100k chars
        },
      },
    };

    return new LangchainExtractor(apiKey, logger, defaultConfig);
  }
}

