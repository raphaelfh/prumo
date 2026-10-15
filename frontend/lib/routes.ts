/**
 * Route paths that more than one module has to agree on.
 *
 * The password-reset path is used three ways — as the route itself, as the
 * `redirect_to` sent to Supabase, and as the recovery fallback target — and a
 * disagreement between them fails silently (the user just lands on the wrong
 * page), so it is defined once.
 */
export const RESET_PASSWORD_PATH = "/auth/reset-password";

// A `.`/`..` path segment, raw or percent-encoded (`%2e`, any case).
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * A same-origin relative path to return to after sign-in; "/" for anything else.
 *
 * The URL parser reads `\` as `/`, drops tabs and newlines and resolves dot
 * segments, any of which can turn a relative-looking path into `//host`; so a
 * candidate carrying `//`, a dot segment or a tab or newline is refused outright
 * rather than trusting whatever the router later does with it.
 */
export function safeReturnPath(from: unknown): string {
  if (typeof from !== "string" || !from.startsWith("/") || /[\t\n\r]/.test(from)) return "/";
  const slashed = from.replaceAll("\\", "/");
  const path = slashed.split(/[?#]/, 1)[0];
  if (slashed.includes("//") || path.split("/").some((segment) => DOT_SEGMENT.test(segment))) return "/";
  const url = new URL(from, window.location.origin);
  return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : "/";
}
