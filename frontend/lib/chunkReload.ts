/**
 * Recover from stale lazy chunks after a deploy.
 *
 * A tab opened before a deploy still references the previous build's hashed
 * chunks; the new deploy no longer serves them, so the next lazy route import
 * fails (`vite:preloadError`). Reloading picks up the new `index.html` and its
 * chunk graph. The sessionStorage timestamp stops a reload loop when the chunk
 * is genuinely broken — the second failure inside the window reaches the error
 * boundary instead.
 */
const LAST_RELOAD_KEY = "prumo:chunk-reload-at";
const GUARD_WINDOW_MS = 10_000;

function readLastReload(): number {
  try {
    return Number(sessionStorage.getItem(LAST_RELOAD_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLastReload(at: number): void {
  try {
    sessionStorage.setItem(LAST_RELOAD_KEY, String(at));
  } catch {
    // Storage blocked: reload anyway; the loop guard is best-effort.
  }
}

export function installChunkReload(
  reload: () => void = () => window.location.reload(),
): () => void {
  const onPreloadError = (event: Event) => {
    const now = Date.now();
    if (now - readLastReload() < GUARD_WINDOW_MS) return;
    writeLastReload(now);
    event.preventDefault();
    reload();
  };
  window.addEventListener("vite:preloadError", onPreloadError);
  return () => window.removeEventListener("vite:preloadError", onPreloadError);
}
