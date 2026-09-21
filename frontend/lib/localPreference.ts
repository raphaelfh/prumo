/**
 * Per-browser UI preferences — a remembered toggle, never a correctness input.
 *
 * Reads and writes are guarded: a private window or blocked site data throws on
 * ACCESS, not just on write, and a preference that cannot be read is simply the
 * default. Nothing here is per-account, so a preference never crosses devices.
 */

const PREFIX = 'prumo.pref.';

export function readBooleanPreference(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(PREFIX + key);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

export function writeBooleanPreference(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(PREFIX + key, String(value));
  } catch {
    /* a remembered toggle is a convenience */
  }
}
