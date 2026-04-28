/**
 * Console-error capture for UI E2E specs.
 *
 * Wires ``page.on('console')`` and ``page.on('pageerror')`` listeners that
 * accumulate browser-side errors during a test, with a small, explicit
 * allowlist for known noise (Vite HMR, asset 404s, react-pdf measurement
 * warnings the viewer recovers from). At the end of the test, the caller
 * asserts the bucket is empty — any unexpected error fails the test with
 * the full message in the failure output.
 *
 * The Data Extraction Dashboard tab regression that prompted this helper
 * (a stale PostgREST embed against the dropped
 * ``extraction_reviewer_states_current_decision_id_fkey`` FK after
 * migration 0005 went in) only surfaced as a ``console.error`` plus a
 * Sonner toast — neither was caught by the existing flows. The pattern
 * here lets every UI spec catch that class of bug for free.
 */

import type { ConsoleMessage, Page } from "@playwright/test";

const DEFAULT_ALLOWLIST_PATTERNS: RegExp[] = [
  /Failed to load resource/i,
  /HMR/i,
  /hot-update/i,
  /favicon\.ico/i,
  // react-pdf emits one or two of these on the very first measurement
  // pass against a fresh PDF; the page reaches steady state right after.
  /Maximum update depth exceeded/i,
];

export interface ConsoleErrorWatcher {
  /** All unexpected console.error / pageerror messages collected so far. */
  errors: () => string[];
  /** Asserts the bucket is empty — call at the end of the test. */
  assertNone: () => void;
  /** Allow the test to register additional patterns to ignore at runtime. */
  ignore: (pattern: RegExp) => void;
  /** Detach listeners; the watcher is unusable after this. */
  dispose: () => void;
}

/**
 * Attach console + pageerror listeners. Returns a watcher with an
 * ``assertNone`` to call once the page has reached the state under test.
 *
 * Usage:
 *   const watcher = watchConsoleErrors(page);
 *   await page.goto(url);
 *   await ... // exercise the page
 *   watcher.assertNone();
 */
export function watchConsoleErrors(
  page: Page,
  options: { allow?: RegExp[] } = {},
): ConsoleErrorWatcher {
  const allowlist = [...DEFAULT_ALLOWLIST_PATTERNS, ...(options.allow ?? [])];
  const captured: string[] = [];

  const isAllowed = (text: string): boolean =>
    allowlist.some((pattern) => pattern.test(text));

  const onConsole = (msg: ConsoleMessage): void => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isAllowed(text)) return;
    captured.push(`[console.error] ${text}`);
  };

  const onPageError = (err: Error): void => {
    const text = err.message ?? String(err);
    if (isAllowed(text)) return;
    captured.push(`[pageerror] ${text}`);
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  return {
    errors: () => [...captured],
    assertNone: () => {
      if (captured.length > 0) {
        throw new Error(
          `Unexpected console errors:\n${captured.map((line) => `  • ${line}`).join("\n")}`,
        );
      }
    },
    ignore: (pattern) => {
      allowlist.push(pattern);
    },
    dispose: () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}
