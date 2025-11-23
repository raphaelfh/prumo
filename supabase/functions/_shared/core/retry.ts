/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Retry Handler para Edge Functions
 * 
 * Retry com exponential backoff e jitter para lidar com falhas transitórias.
 * 
 * CARACTERÍSTICAS:
 * - Exponential backoff configurável
 * - Jitter aleatório para evitar thundering herd
 * - Função shouldRetry customizável
 * - Suporte a máximo de tentativas
 */

interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Handler de retry com exponential backoff
 */
export class RetryHandler {
  /**
   * Executa função com retry automático
   * 
   * @param fn - Função a executar (async)
   * @param options - Opções de retry
   * @returns Resultado da função
   */
  static async withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {},
  ): Promise<T> {
    const {
      maxAttempts = 3,
      initialDelayMs = 1000,
      maxDelayMs = 10000,
      backoffMultiplier = 2,
      shouldRetry = () => true, // Por padrão, retry para qualquer erro
    } = options;

    let lastError: unknown;
    let attempt = 0;

    while (attempt < maxAttempts) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        attempt++;

        // Se não deve retry ou é a última tentativa, propagar erro
        if (!shouldRetry(error) || attempt >= maxAttempts) {
          throw error;
        }

        // Calcular delay com exponential backoff e jitter
        const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        const jitter = Math.random() * 0.3 * baseDelay; // 30% de jitter
        const delay = Math.min(baseDelay + jitter, maxDelayMs);

        // Aguardar antes da próxima tentativa
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Se chegou aqui, todas as tentativas falharam
    throw lastError;
  }
}

