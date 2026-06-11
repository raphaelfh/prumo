import * as React from "react";

const MOBILE_BREAKPOINT = 768;
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

export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

/**
 * True when viewport is below Tailwind sm (640px).
 * Use for switching table vs card list in responsive list views.
 */
export function useIsNarrow() {
  return useMediaQuery(`(max-width: ${NARROW_BREAKPOINT - 1}px)`);
}
