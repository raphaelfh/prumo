/**
 * Display host for a custom endpoint's base URL (§5.2, C2).
 *
 * Both endpoint surfaces (the management dialog's rows and the picker's
 * group headings) show the HOST, not the full base URL — the full URL
 * blows the popover-family density and the path carries no information a
 * manager scanning a list needs.
 *
 * Lives in lib/ so components can import it without dragging a service
 * (and its api client, which needs supabase env at import time) into the
 * module graph — see `llmEngineUpdateBody.ts` for the same split.
 */
export function endpointHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    // A stored URL the browser cannot parse still has to render.
    return baseUrl;
  }
}
