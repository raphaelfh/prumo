import {logger} from './logger';
import {t} from '@/lib/copy';

// =================== TYPES ===================

export type ErrorResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: Error };


// =================== ERROR NORMALIZATION ===================

/**
 * Error carrying a Postgres/PostgREST error code across the service
 * boundary. normalizeError passes Error instances through unchanged,
 * so the code survives toResult — callers branch on `instanceof
 * PgError` + `.code` instead of casting.
 */
export class PgError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'PgError';
  }
}

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


// =================== ERROR HANDLING WRAPPER ===================



/**
 * Service-layer Result wrapper: runs an async operation and converts
 * the outcome to ErrorResult. No toast, no UI — logging only. Exported
 * service functions use this so they never throw across the boundary;
 * components decide presentation by branching on `ok`
 * (zero-bailouts spec, 2026-06-11).
 */
export async function toResult<T>(
  operation: () => Promise<T>,
  context: string
): Promise<ErrorResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (err) {
    const error = normalizeError(err);
    logger.error(`❌ [${context}] Error:`, error);
    return { ok: false, error };
  }
}

// =================== SYNC ERROR HANDLING ===================


// =================== TOAST HELPERS ===================




// =================== API ERROR HANDLING ===================



