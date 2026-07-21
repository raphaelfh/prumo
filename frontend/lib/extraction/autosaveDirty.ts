/**
 * The autosave dirty diff, extracted as a pure function so it can be unit
 * tested in isolation.
 *
 * A coord's fingerprint is the `[value, aiLink]` tuple (D0): a coord is dirty
 * when the tuple differs from BOTH:
 *  - `lastSaved` — the last tuple this client successfully wrote (stringified);
 *  - the baseline — the server-loaded value the form hydrated from
 *    (`baseline`) paired with its persisted AI link (`baselineLink`, the
 *    layer-1 links derived from the caller's own decisions).
 *
 * Including the link in the fingerprint is what records an adoption whose
 * value is byte-identical to what is already persisted — the human selection
 * event must still append a linked decision (constitution §IX); a value-only
 * diff would silently drop it.
 *
 * The baseline check is what stops the form re-POSTing hydrated values on
 * mount: `lastSaved` is empty until this client writes something, so without
 * a baseline every loaded value would look dirty and be re-recorded as a
 * brand-new proposal/decision on every page load.
 */

export function fingerprintCoord(value: unknown, link: string | null | undefined): string {
  return JSON.stringify([value ?? null, link ?? null]);
}

export function selectDirtyEntries(
  values: Record<string, unknown>,
  lastSaved: Record<string, string>,
  baseline: Record<string, unknown>,
  linkByKey: Record<string, string> = {},
  baselineLink: Record<string, string> = {},
): Array<[string, unknown]> {
  const dirty: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(values)) {
    // Skip never-touched fields; null / '' are deliberate clears and persist.
    if (value === undefined) continue;
    const current = fingerprintCoord(value, linkByKey[key]);
    if (lastSaved[key] === current) continue;
    if (key in baseline && fingerprintCoord(baseline[key], baselineLink[key]) === current) {
      continue;
    }
    dirty.push([key, value]);
  }
  return dirty;
}
