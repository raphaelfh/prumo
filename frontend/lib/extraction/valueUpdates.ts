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

