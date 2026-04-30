/**
 * Tiny event bus for "this extracted value just changed" notifications.
 *
 * Producer: `useExtractedValues.mergeValuesById` calls
 * `dispatchValueUpdates(keys)` when a refresh discovered a new or changed
 * value for an existing field. Each key is `${instanceId}_${fieldId}`.
 *
 * Consumer: a small hook (`useJustUpdatedValue`) that extraction inputs use
 * to flip a `data-just-updated` attribute for ~1.5s after the change. The
 * attribute drives a CSS animation defined in App.css so the highlight is
 * visual-only and doesn't trigger React state churn for unaffected fields.
 *
 * The bus is intentionally a module-level singleton: extractions are global
 * to a single open extraction page and the producer/consumers all live
 * inside the same React tree. No context plumbing required.
 */

type Listener = (keys: string[]) => void;

const listeners = new Set<Listener>();

export function dispatchValueUpdates(keys: string[]): void {
  if (keys.length === 0) return;
  listeners.forEach((listener) => {
    try {
      listener(keys);
    } catch {
      // Listener crashes shouldn't break the producer.
    }
  });
}

export function subscribeValueUpdates(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Cheap, depth-aware equality check sufficient for the values produced by
 * `extractValueFromDb` (primitives, plain objects, arrays of primitives).
 * Avoids pulling lodash for one call site.
 */
export function shallowValueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!Object.is(a[i], b[i])) return false;
    }
    return true;
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}
