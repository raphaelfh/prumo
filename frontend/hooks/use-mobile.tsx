import * as React from "react";

/** Below Tailwind sm (640px): use card list instead of table */
const NARROW_BREAKPOINT = 640;

// matchMedia is an external store; useSyncExternalStore reads it without
// the mount-effect setState the previous implementation needed.
function useMediaQuery(query: string): boolean {
  // kept: useSyncExternalStore re-subscribes whenever `subscribe` changes
  // identity — that stability is a React API contract, not a perf detail,
  // so it stays explicit instead of relying on compiler output.
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}


/**
 * True when viewport is below Tailwind sm (640px).
 * Use for switching table vs card list in responsive list views.
 */
export function useIsNarrow() {
  return useMediaQuery(`(max-width: ${NARROW_BREAKPOINT - 1}px)`);
}

/** Tailwind lg (1024px). Below it the docked split is not viable and the
 *  articles panel falls back to an overlay sheet. */
const DESKTOP_BREAKPOINT = 1024;

/** True when the viewport is below Tailwind lg (1024px). */
export function useIsBelowDesktop() {
  return !useMediaQuery(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
}
