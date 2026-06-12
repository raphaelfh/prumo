// frontend/services/authService.ts
/**
 * Auth service — IO for authentication state queries.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler. This module will grow in later batches as additional
 * auth-related service functions are extracted.
 */
import {supabase} from '@/integrations/supabase/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';

// ---------------------------------------------------------------------------
// ArticleExtractionTable: current authenticated user id
// ---------------------------------------------------------------------------

/**
 * Fetch the current authenticated user id.
 */
export function getCurrentUserId(): Promise<ErrorResult<string | null>> {
  return toResult(async () => {
    const {data: {user}} = await supabase.auth.getUser();
    return user?.id ?? null;
  }, 'authService.getCurrentUserId');
}

/**
 * Fetch the current authenticated user's id, throwing (within toResult) if
 * not authenticated. Used by accept/reject flows that require a reviewer id.
 */
export function getRequiredUserId(): Promise<ErrorResult<string>> {
  return toResult(async () => {
    const {data: {user}} = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    return user.id;
  }, 'authService.getRequiredUserId');
}
