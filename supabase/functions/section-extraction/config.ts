/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Configuração Centralizada para Section Extraction
 * 
 * Todas as constantes do pipeline são definidas aqui, com suporte a override
 * via variáveis de ambiente para facilitar ajustes sem recompilar.
 */

/**
 * Configuração completa do pipeline
 */
export const CONFIG = {
  /**
   * Configurações relacionadas ao LLM
   */
  llm: {
    /**
     * Timeouts para invocações LLM (em milissegundos)
     */
    timeout: {
      // CRÍTICO: Edge Functions do Supabase têm timeout de 150s (rigoroso)
      // Devemos garantir que LLM + retries + overhead < 150s
      // 
      // PROBLEMA: 30s é muito pouco - mesmo extrações simples (2 campos) estão dando timeout
      // Aumentar para 45s que ainda permite retry dentro do limite de 150s
      // 
      // Cálculo conservador com maxAttempts=2:
      //   - Tentativa 1: 45s
      //   - Delay: 1s
      //   - Tentativa 2: 45s  
      //   Total LLM: 91s
      //   + PDF processing: ~5s
      //   + Schema building: ~2s
      //   + DB operations: ~5s
      //   + Overhead: ~5s
      //   TOTAL: ~108s << 150s ✓ (margem de segurança de 42s)
      base: parseInt(Deno.env.get("LLM_TIMEOUT_MS") || "60000"), // 60s padrão (razoável para extrações)
      gpt5: parseInt(Deno.env.get("LLM_TIMEOUT_GPT5_MS") || "100000"), // 100s para GPT-5
      /**
       * Porcentagem do timeout para disparar warning proativo (0.8 = 80%)
       */
      warningThreshold: 0.8,
    },
    /**
     * Tamanhos máximos de texto para processamento (em caracteres)
     */
    maxTextLength: {
      // CRÍTICO: Texto muito longo causa LLM demorar muito
      // Reduzir para acelerar extrações e evitar timeouts
      base: parseInt(Deno.env.get("MAX_TEXT_LENGTH") || "50000"), // 100k caracteres (reduzido de 100k)
      gpt5: parseInt(Deno.env.get("MAX_TEXT_LENGTH_GPT5") || "100000"), // 200k para GPT-5 (reduzido de 200k)
    },
  },
  /**
   * Configurações relacionadas a PDFs
   */
  pdf: {
    /**
     * Tamanho máximo de PDF em MB
     */
    maxSizeMB: parseInt(Deno.env.get("MAX_PDF_SIZE_MB") || "50"), // 50MB padrão
  },
  /**
   * Configurações de retry
   */
  retry: {
    /**
     * Número máximo de tentativas (incluindo a inicial)
     */
    // CRÍTICO: Reduzir maxAttempts para evitar timeout do Supabase (150s)
    // Com timeout de 40s, maxAttempts=2 garante que nunca ultrapasse 150s
    maxAttempts: parseInt(Deno.env.get("RETRY_MAX_ATTEMPTS") || "2"), // Reduzido de 3 para 2
    /**
     * Delay inicial entre tentativas (em milissegundos)
     */
    initialDelayMs: parseInt(Deno.env.get("RETRY_INITIAL_DELAY_MS") || "1000"), // Reduzido de 2s para 1s
    /**
     * Delay inicial para processamento de PDF (menor que LLM)
     */
    pdfInitialDelayMs: parseInt(Deno.env.get("RETRY_PDF_INITIAL_DELAY_MS") || "1000"),
  },
} as const;

/**
 * Helpers para acessar configurações baseadas no modelo
 */
export const ConfigHelpers = {
  /**
   * Retorna timeout apropriado para o modelo especificado
   */
  getTimeoutMs(modelName: string): number {
    return modelName === "gpt-5"
      ? CONFIG.llm.timeout.gpt5
      : CONFIG.llm.timeout.base;
  },

  /**
   * Retorna tamanho máximo de texto para o modelo especificado
   */
  getMaxTextLength(modelName: string): number {
    return modelName === "gpt-5"
      ? CONFIG.llm.maxTextLength.gpt5
      : CONFIG.llm.maxTextLength.base;
  },

  /**
   * Calcula o threshold de warning de timeout (em milissegundos)
   */
  getTimeoutWarningMs(modelName: string): number {
    const timeout = this.getTimeoutMs(modelName);
    return Math.floor(timeout * CONFIG.llm.timeout.warningThreshold);
  },
};

