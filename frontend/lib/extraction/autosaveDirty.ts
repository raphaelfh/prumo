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
 *
 * That makes the baseline a statement about the server BEFORE this client wrote
 * anything — so it only applies while the coord is unwritten. Once we have
 * written a coord, `lastSaved` is the only truth about what the server holds:
 * re-entering the value the field had on mount is a real edit (the server now
 * holds the clear that overwrote it), not a no-op. Consulting a stale baseline
 * there silently dropped the write, which on a PROBAST+AI domain judgment left
 * the computed overall dashed no matter how often the reviewer re-entered it.
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
    // Only while this client has never written the coord — see the note above.
    if (
      !(key in lastSaved) &&
      key in baseline &&
      fingerprintCoord(baseline[key], baselineLink[key]) === current
    ) {
      continue;
    }
    dirty.push([key, value]);
  }
  return dirty;
}
