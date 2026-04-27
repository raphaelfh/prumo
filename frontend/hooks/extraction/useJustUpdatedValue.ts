/**
 * Subscribe a single field input to "value just changed" pings from the
 * extraction value bus. Returns true for ~1500ms after a matching key is
 * dispatched, so the input can render a `data-just-updated` attribute that
 * drives the brief CSS highlight animation.
 *
 * Why a hook rather than a React Context:
 *   - Each input only cares about its own key; broadcasting via context
 *     would re-render every subscriber on every dispatch.
 *   - Singleton bus ↔ memoised hook keeps the consumer cost at one
 *     useEffect + one useState per input.
 */

import { useEffect, useRef, useState } from "react";

import { subscribeValueUpdates } from "@/lib/extraction/valueUpdates";

const HIGHLIGHT_DURATION_MS = 1500;

export function useJustUpdatedValue(key: string): boolean {
  const [active, setActive] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeValueUpdates((keys) => {
      if (!keys.includes(key)) return;
      setActive(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setActive(false);
        timeoutRef.current = null;
      }, HIGHLIGHT_DURATION_MS);
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [key]);

  return active;
}
