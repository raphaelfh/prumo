/**
 * Configuração para Structured Extraction Edge Function
 * 
 * Centraliza todas as constantes e configurações da função.
 */

/**
 * Configuração completa
 */
export const CONFIG = {
  /**
   * Configurações do LLM
   */
  llm: {
    /**
     * Timeout para chamadas LLM (ms)
     */
    timeout: {
      base: parseInt(Deno.env.get("LLM_TIMEOUT_MS") || "60000"), // 60s padrão
    },
    /**
     * Tamanho máximo de texto (caracteres)
     */
    maxTextLength: parseInt(Deno.env.get("MAX_TEXT_LENGTH") || "50000"), // 50k caracteres
  },
  /**
   * Configurações de retry
   */
  retry: {
    maxAttempts: parseInt(Deno.env.get("RETRY_MAX_ATTEMPTS") || "2"),
    initialDelayMs: parseInt(Deno.env.get("RETRY_INITIAL_DELAY_MS") || "1000"),
  },
} as const;

