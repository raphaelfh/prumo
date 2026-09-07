/**
 * Route paths that more than one module has to agree on.
 *
 * The password-reset path is used three ways — as the route itself, as the
 * `redirect_to` sent to Supabase, and as the recovery fallback target — and a
 * disagreement between them fails silently (the user just lands on the wrong
 * page), so it is defined once.
 */
export const RESET_PASSWORD_PATH = "/auth/reset-password";
