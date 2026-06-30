import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Reports whether the run header is narrower than `breakpointPx`, by measuring
 * its nearest `<header>` ancestor with a ResizeObserver.
 *
 * Why JS measurement and not a container query: the affordances that fold at
 * narrow widths live inside the kebab's `DropdownMenuContent`, which Radix
 * portals OUT of the `@container/headerbar` element — so `@[..]/headerbar:`
 * utilities cannot gate them. A measured width can. The default breakpoint
 * mirrors the `@[40rem]` (640px) container query used for the StageRail/RoleChip
 * fold, so inline collapse and kebab fold cross over at the same width.
 *
 * Guarded for non-DOM/test envs: `ResizeObserver` is mocked to a no-op there,
 * but the synchronous first `measure()` still sets the initial state from
 * `getBoundingClientRect`, which keeps the hook deterministic under test.
 */
export function useHeaderCompact(breakpointPx = 640) {
  const ref = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const anchor = ref.current;
    const target = anchor?.closest('header') ?? anchor?.parentElement ?? null;
    if (!target) return;
    const measure = () => setCompact(target.getBoundingClientRect().width < breakpointPx);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    return () => ro.disconnect();
  }, [breakpointPx]);

  return { ref, compact };
}
