import * as React from "react";

const MOBILE_BREAKPOINT = 768;
/** Below Tailwind sm (640px): use card list instead of table */
const NARROW_BREAKPOINT = 640;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * True when viewport is below Tailwind sm (640px).
 * Use for switching table vs card list in responsive list views.
 */
export function useIsNarrow() {
    const [isNarrow, setIsNarrow] = React.useState<boolean | undefined>(undefined);

    React.useEffect(() => {
        const mql = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT - 1}px)`);
        const onChange = () => {
            setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
        };
        mql.addEventListener("change", onChange);
        setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
        return () => mql.removeEventListener("change", onChange);
    }, []);

    return !!isNarrow;
}
