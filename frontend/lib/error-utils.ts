/**
 * Error handling utilities
 *
 * Centralized utility functions for error handling.
 * Standardizes the try/catch pattern that was duplicated in ~15 places.
 *
 * @module lib/error-utils
 */

import {toast} from 'sonner';
import {logger} from './logger';
import {t} from '@/lib/copy';

// =================== TYPES ===================

export type ErrorResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: Error };

export interface WithErrorHandlingOptions {
    /** Context for logs (e.g. "loadArticles", "saveAssessment") */
  context: string;
    /** Show error toast to user (default: true) */
  showToast?: boolean;
    /** Custom toast message (uses context if not provided) */
  toastMessage?: string;
    /** Re-throw error after handling (default: false) */
  rethrow?: boolean;
    /** Callback run on error */
  onError?: (error: Error) => void;
}

// =================== ERROR NORMALIZATION ===================

/**
 * Normalizes any error to an Error instance
 *
 * @param error - Caught error (can be any)
 * @returns Normalized Error instance
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
    return new Error(t('common', 'errors_unknownError'));
}

/**
 * Safely extracts error message
 */
export function getErrorMessage(error: unknown): string {
  return normalizeError(error).message;
}

// =================== ERROR HANDLING WRAPPER ===================

/**
 * Wrapper for async operations with standardized error handling
 *
 * Previously duplicated in ~15 places with pattern:
 * try { ... await operation(); ... } catch { toast.error(...); throw err; }
 *
 * @param operation - Async function to run
 * @param options - Configuration options
 * @returns Operation result or undefined on failure
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
      logger.error(`❌ [${context}] Error:`, error);

    if (showToast) {
        const message = toastMessage || t('common', 'errors_inContext').replace('{{context}}', context);
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
 * Version that returns Result type (ok/error)
 * Useful when success must be checked explicitly
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

    logger.debug(`🔄 [${context}] Starting...`);

  try {
    const result = await operation();
      logger.debug(`✅ [${context}] Success`);
    return { ok: true, data: result };
  } catch (err) {
    const error = normalizeError(err);
      logger.error(`❌ [${context}] Error:`, error);

    if (showToast) {
        const message = toastMessage || t('common', 'errors_inContext').replace('{{context}}', context);
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
 * Wrapper for synchronous operations
 */
export function tryCatch<T>(
  operation: () => T,
  context: string
): T | undefined {
  try {
    return operation();
  } catch (err) {
    const error = normalizeError(err);
      logger.error(`❌ [${context}] Error:`, error);
    return undefined;
  }
}

// =================== TOAST HELPERS ===================

/**
 * Shows standardized error toast
 */
export function showErrorToast(
  title: string,
  error?: unknown
): void {
  const message = error ? getErrorMessage(error) : undefined;
  toast.error(title, message ? { description: message } : undefined);
}

/**
 * Shows standardized success toast
 */
export function showSuccessToast(
  title: string,
  description?: string
): void {
  toast.success(title, description ? { description } : undefined);
}

/**
 * Shows standardized info toast
 */
export function showInfoToast(
  title: string,
  description?: string
): void {
  toast.info(title, description ? { description } : undefined);
}

// =================== API ERROR HANDLING ===================

/**
 * Handles API response error
 */
export function handleApiError(
  response: { ok: boolean; error?: { code?: string; message?: string } },
  context: string
): void {
  if (!response.ok && response.error) {
      const message = response.error.message || t('common', 'errors_unknownError');
    logger.error(`❌ [${context}] API Error:`, response.error);
      toast.error(t('common', 'errors_inContext').replace('{{context}}', context), {description: message});
  }
}

/**
 * Checks if error is an authentication error
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
 * Checks if error is a network error
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
