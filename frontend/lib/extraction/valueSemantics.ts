/**
 * THE frontend emptiness + absent_reason predicate — the single source of truth
 * for "does this coordinate hold a value?", mirroring the backend oracle
 * `backend/app/services/value_semantics.py` 1:1. A shared cross-checked test
 * vector (`valueSemantics.test.ts` ⇔ `test_value_semantics.py`) keeps the two
 * implementations mechanically in lock-step, replacing the three open-coded
 * copies that used to drift.
 *
 * Empty ⇔ no resolved `absent_reason` marker AND, after peeling one `{value}`
 * envelope, the value is `null` / `undefined` / `''`. Whitespace, `0`, `false`,
 * `[]` and non-envelope dicts are all filled.
 *
 * A coordinate may carry a coded disposition sibling
 * `{ value: null, absent_reason: <code> }` (ADR-0016) — the source is silent, or
 * the item is not applicable / not evaluated. A resolved marker counts as
 * **filled** even though the typed value stays `null`. The reason is validated
 * against the closed vocabulary, so a garbage code never counts.
 */

/**
 * The closed `absent_reason` vocabulary. Phase 1 will replace this local list
 * with the generated `AbsentReason` type once the marker rides a typed API
 * response field (`frontend/types/api/schema.d.ts`); until then it is defined
 * once here, matching the backend `AbsentReason` StrEnum.
 */
const ABSENT_REASON_CODES = ['no_information', 'not_applicable', 'not_evaluated'] as const;
const ABSENT_REASON_SET = new Set<string>(ABSENT_REASON_CODES);

/** Peel a single `{value: X}` envelope; a bare scalar / non-envelope dict / array is returned untouched. */
export function unwrapValueEnvelope(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

/**
 * The coded disposition carried by `raw`, or `null`. Only a member of the closed
 * vocabulary counts — an absent, empty, or out-of-vocabulary reason yields `null`
 * (so a garbage code is never treated as a resolution).
 */
export function valueAbsentReason(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'absent_reason' in raw) {
    const reason = (raw as { absent_reason: unknown }).absent_reason;
    if (typeof reason === 'string' && ABSENT_REASON_SET.has(reason)) {
      return reason;
    }
  }
  return null;
}

/** True when `raw` carries no information — no resolved marker, and null/undefined/'' after one peel. */
export function isValueEmpty(raw: unknown): boolean {
  if (valueAbsentReason(raw) !== null) return false;
  const value = unwrapValueEnvelope(raw);
  return value === null || value === undefined || value === '';
}

/** True when a stored value counts as "filled" — a real value or a resolved marker. The inverse of `isValueEmpty`. */
export function isValueFilled(raw: unknown): boolean {
  return !isValueEmpty(raw);
}
