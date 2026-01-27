/**
 * Utilities para Error Handling
 *
 * Funções utilitárias centralizadas para tratamento de erros.
 * Padroniza o padrão try/catch que estava duplicado em ~15 lugares.
 *
 * @module lib/error-utils
 */

import { toast } from 'sonner';
import { logger } from './logger';

// =================== TYPES ===================

export interface ErrorResult<T> {
  ok: true;
  data: T;
} | {
  ok: false;
  error: Error;
}

export interface WithErrorHandlingOptions {
  /** Contexto para logs (ex: "loadArticles", "saveAssessment") */
  context: string;
  /** Mostrar toast de erro ao usuário (default: true) */
  showToast?: boolean;
  /** Mensagem customizada para toast (usa context se não fornecido) */
  toastMessage?: string;
  /** Re-lançar erro após tratamento (default: false) */
  rethrow?: boolean;
  /** Callback executado em caso de erro */
  onError?: (error: Error) => void;
}

// =================== ERROR NORMALIZATION ===================

/**
 * Normaliza qualquer erro para instância de Error
 *
 * @param error - Erro capturado (pode ser any)
 * @returns Instância de Error normalizada
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return new Error(String((error as { message: unknown }).message));
  }
  return new Error('Erro desconhecido');
}

/**
 * Extrai mensagem de erro de forma segura
 */
export function getErrorMessage(error: unknown): string {
  return normalizeError(error).message;
}

// =================== ERROR HANDLING WRAPPER ===================

/**
 * Wrapper para operações async com tratamento de erro padronizado
 *
 * Anteriormente duplicado em ~15 lugares com padrão:
 * ```typescript
 * try {
 *   console.log('🔄 [funcao] Iniciando...');
 *   const result = await operation();
 *   console.log('✅ [funcao] Sucesso');
 *   return result;
 * } catch (err: any) {
 *   console.error('❌ [funcao] Erro:', err);
 *   toast.error(`Erro ao ...: ${err.message}`);
 *   throw err;
 * }
 * ```
 *
 * @example
 * ```typescript
 * const articles = await withErrorHandling(
 *   () => fetchArticles(projectId),
 *   { context: 'loadArticles', showToast: true }
 * );
 * ```
 *
 * @param operation - Função async a ser executada
 * @param options - Opções de configuração
 * @returns Resultado da operação ou undefined se falhar
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  options: WithErrorHandlingOptions
): Promise<T | undefined> {
  const {
    context,
    showToast = true,
    toastMessage,
    rethrow = false,
    onError,
  } = options;

  logger.debug(`🔄 [${context}] Iniciando...`);

  try {
    const result = await operation();
    logger.debug(`✅ [${context}] Sucesso`);
    return result;
  } catch (err) {
    const error = normalizeError(err);
    logger.error(`❌ [${context}] Erro:`, error);

    if (showToast) {
      const message = toastMessage || `Erro em ${context}`;
      toast.error(message, {
        description: error.message,
      });
    }

    if (onError) {
      onError(error);
    }

    if (rethrow) {
      throw error;
    }

    return undefined;
  }
}

/**
 * Versão que retorna Result type (ok/error)
 * Útil quando precisa verificar sucesso explicitamente
 *
 * @example
 * ```typescript
 * const result = await withErrorHandlingResult(
 *   () => saveData(data),
 *   { context: 'saveData' }
 * );
 *
 * if (result.ok) {
 *   console.log('Salvo:', result.data);
 * } else {
 *   console.log('Falhou:', result.error.message);
 * }
 * ```
 */
export async function withErrorHandlingResult<T>(
  operation: () => Promise<T>,
  options: WithErrorHandlingOptions
): Promise<ErrorResult<T>> {
  const {
    context,
    showToast = true,
    toastMessage,
    onError,
  } = options;

  logger.debug(`🔄 [${context}] Iniciando...`);

  try {
    const result = await operation();
    logger.debug(`✅ [${context}] Sucesso`);
    return { ok: true, data: result };
  } catch (err) {
    const error = normalizeError(err);
    logger.error(`❌ [${context}] Erro:`, error);

    if (showToast) {
      const message = toastMessage || `Erro em ${context}`;
      toast.error(message, {
        description: error.message,
      });
    }

    if (onError) {
      onError(error);
    }

    return { ok: false, error };
  }
}

// =================== SYNC ERROR HANDLING ===================

/**
 * Wrapper para operações síncronas
 */
export function tryCatch<T>(
  operation: () => T,
  context: string
): T | undefined {
  try {
    return operation();
  } catch (err) {
    const error = normalizeError(err);
    logger.error(`❌ [${context}] Erro:`, error);
    return undefined;
  }
}

// =================== TOAST HELPERS ===================

/**
 * Mostra toast de erro padronizado
 */
export function showErrorToast(
  title: string,
  error?: unknown
): void {
  const message = error ? getErrorMessage(error) : undefined;
  toast.error(title, message ? { description: message } : undefined);
}

/**
 * Mostra toast de sucesso padronizado
 */
export function showSuccessToast(
  title: string,
  description?: string
): void {
  toast.success(title, description ? { description } : undefined);
}

/**
 * Mostra toast de info padronizado
 */
export function showInfoToast(
  title: string,
  description?: string
): void {
  toast.info(title, description ? { description } : undefined);
}

// =================== API ERROR HANDLING ===================

/**
 * Trata erro de resposta de API
 */
export function handleApiError(
  response: { ok: boolean; error?: { code?: string; message?: string } },
  context: string
): void {
  if (!response.ok && response.error) {
    const message = response.error.message || 'Erro desconhecido';
    logger.error(`❌ [${context}] API Error:`, response.error);
    toast.error(`Erro: ${context}`, { description: message });
  }
}

/**
 * Verifica se erro é de autenticação
 */
export function isAuthError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('unauthorized') ||
    message.includes('unauthenticated') ||
    message.includes('not authenticated') ||
    message.includes('jwt') ||
    message.includes('token')
  );
}

/**
 * Verifica se erro é de rede
 */
export function isNetworkError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connection') ||
    message.includes('timeout')
  );
}
