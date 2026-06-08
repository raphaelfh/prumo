/**
 * The autosave dirty diff, extracted as a pure function so it can be unit
 * tested in isolation.
 *
 * A coord is dirty when its current value differs from BOTH:
 *  - `lastSaved` — the last value this client successfully wrote (stringified);
 *  - `baseline`  — the server-loaded value the form hydrated from (raw).
 *
 * The baseline check is what stops the form re-POSTing hydrated values on
 * mount: `lastSaved` is empty until this client writes something, so without
 * a baseline every loaded value would look dirty and be re-recorded as a
 * brand-new proposal/decision on every page load.
 */
export function selectDirtyEntries(
  values: Record<string, unknown>,
  lastSaved: Record<string, string>,
  baseline: Record<string, unknown>,
): Array<[string, unknown]> {
  const dirty: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(values)) {
    // Skip never-touched fields; null / '' are deliberate clears and persist.
    if (value === undefined) continue;
    const stringified = JSON.stringify(value ?? null);
    if (lastSaved[key] === stringified) continue;
    if (key in baseline && JSON.stringify(baseline[key] ?? null) === stringified) {
      continue;
    }
    dirty.push([key, value]);
  }
  return dirty;
}
