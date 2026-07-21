/**
 * Canonical value comparison for reviewer decisions and AI proposal versions.
 * `stableStringify` is the single source the agreement math
 * (useReviewerSummary) and the review popover's adoption chip both use — do
 * not fork it.
 */

/**
 * Canonical JSON with object keys sorted recursively — matches the backend's
 * `json.dumps(value, sort_keys=True)` so the two agreement checks stay in lock
 * step (Phase B finding F1). Key order never affects equality; a differing
 * sibling key (e.g. `unit`) does.
 *
 * Caveat: JS has no int/float distinction, so `5` and `5.0` both stringify to
 * `"5"` here while the backend keeps `5` vs `5.0`. Harmless in practice — form
 * values are stored as strings (`"5"`), never bare JSON numbers — so a numeric
 * mismatch would only arise from a non-form writer, which is out of scope.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * A decision's `value` is an envelope (`{value: X}` or
 * `{value: null, absent_reason}` — see writeRunFieldValue), while a history
 * version's `value` is the raw proposal value (which for an abstention is
 * itself marker-shaped). Wrap the version to envelope shape, then compare.
 */
export function decisionMatchesVersion(
  decisionEnvelope: unknown,
  versionValue: unknown,
): boolean {
  if (decisionEnvelope === null || decisionEnvelope === undefined) return false;
  // The write path normalizes '' → null before enveloping, while the
  // suggestion read path coerces a legacy bare-null proposal to '' — treat
  // the two as the same emptiness so a verbatim adoption of an empty
  // version never reads "Edited by".
  const normalized = versionValue === "" ? null : versionValue;
  const wrapped =
    normalized !== null &&
    typeof normalized === "object" &&
    !Array.isArray(normalized) &&
    "absent_reason" in (normalized as Record<string, unknown>)
      ? normalized
      : {value: normalized};
  return stableStringify(decisionEnvelope) === stableStringify(wrapped);
}
