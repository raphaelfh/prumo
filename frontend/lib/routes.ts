/**
 * Route paths that more than one module has to agree on.
 *
 * The password-reset path is used three ways — as the route itself, as the
 * `redirect_to` sent to Supabase, and as the recovery fallback target — and a
 * disagreement between them fails silently (the user just lands on the wrong
 * page), so it is defined once.
 */
export const RESET_PASSWORD_PATH = "/auth/reset-password";

/** A same-origin relative path to return to after sign-in; "/" for anything else. */
export function safeReturnPath(from: unknown): string {
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) return "/";
  const url = new URL(from, window.location.origin);
  return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : "/";
}
