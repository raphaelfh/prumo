// frontend/services/authService.ts
/**
 * Auth service — IO for authentication state queries and mutations.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. try/catch and
 * throw are free here — module-level functions are not compiled by the
 * React Compiler.
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

// ---------------------------------------------------------------------------
// ApiKeysSection: session access token
// ---------------------------------------------------------------------------

/**
 * Return the current session's access token.
 * Throws when there is no active session.
 *
 * NOTE: callers surface the error message directly as a toast.
 */
export function getAccessToken(): Promise<ErrorResult<string>> {
  return toResult(async () => {
    const {data: {session}} = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Session expired — please sign in again');
    return session.access_token;
  }, 'authService.getAccessToken');
}

// ---------------------------------------------------------------------------
// SecuritySection / ResetPassword: update password
// ---------------------------------------------------------------------------

/**
 * Update the authenticated user's password.
 *
 * NOTE: toast messages are handled by the caller.
 */
export function updateUserPassword(password: string): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase.auth.updateUser({password});
    if (error) throw error;
  }, 'authService.updateUserPassword');
}

// ---------------------------------------------------------------------------
// Auth page: sign in / register / forgot-password
// ---------------------------------------------------------------------------

export interface SignInResult {
  /** True when supabase returned a session immediately (e-mail confirmation disabled). */
  sessionReady: boolean;
}

/**
 * Sign in with email + password.
 *
 * NOTE: error messages are mapped by the caller (mapAuthError) before display.
 */
export function signInWithPassword(
  email: string,
  password: string,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase.auth.signInWithPassword({email, password});
    if (error) throw error;
  }, 'authService.signInWithPassword');
}

/**
 * Register a new account with email + password.
 * Returns whether a session was created immediately (e-mail confirmation disabled).
 *
 * NOTE: error messages are mapped by the caller (mapAuthError) before display.
 */
export function signUp(
  email: string,
  password: string,
  fullName: string,
  emailRedirectTo: string,
): Promise<ErrorResult<SignInResult>> {
  return toResult(async () => {
    const {data, error} = await supabase.auth.signUp({
      email,
      password,
      options: {data: {full_name: fullName}, emailRedirectTo},
    });
    if (error) throw error;
    return {sessionReady: !!data.session};
  }, 'authService.signUp');
}

/**
 * Send a password-reset e-mail.
 *
 * NOTE: error messages are mapped by the caller (mapAuthError) before display.
 */
export function resetPasswordForEmail(
  email: string,
  redirectTo: string,
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {error} = await supabase.auth.resetPasswordForEmail(email, {redirectTo});
    if (error) throw error;
  }, 'authService.resetPasswordForEmail');
}
