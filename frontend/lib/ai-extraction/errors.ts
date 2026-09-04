import {t} from '@/lib/copy';

/**
 * Custom error classes for AI Extraction
 *
 * Domain-specific errors for better handling and user-friendly messages.
 */

/**
 * Base error for AI Extraction
 */
class AIExtractionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AIExtractionError';
  }
}







/**
 * Erro de rede/API
 */
export class APIError extends AIExtractionError {
  constructor(
    message: string,
    statusCode?: number,
    details?: Record<string, unknown>,
    // The backend envelope's `error.code` when the failure came through the
    // FastAPI client; the class tag otherwise (network, unknown shape).
    code = 'API_ERROR',
  ) {
    super(message, code, { statusCode, ...details });
    this.name = 'APIError';
  }
}

/**
 * Helper to determine if an error is AIExtractionError type
 */
function isAIExtractionError(error: unknown): error is AIExtractionError {
  return error instanceof AIExtractionError;
}

/**
 * Extracts user-friendly error message
 */
export function getErrorMessage(error: unknown): string {
  if (isAIExtractionError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

    return t('common', 'errors_unknownError');
}

/**
 * Extracts error code for specific handling
 */
export function getErrorCode(error: unknown): string | null {
  if (isAIExtractionError(error)) {
    return error.code;
  }

  return null;
}

