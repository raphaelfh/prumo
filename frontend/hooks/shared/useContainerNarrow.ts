import {useEffect, useState, type RefObject} from 'react';

/**
 * True while the observed element is narrower than `maxWidthPx`.
 *
 * CSS container queries can only show/hide; a panel that must MOUNT a
 * different host below a breakpoint (the template-config inspector docks
 * wide, overlays as a Sheet narrow — B-5 Task 5) needs the width in
 * React state, so this observes the container element instead.
 *
 * jsdom's ResizeObserver stub never fires, so the hook resolves to
 * `false` (docked) in unit tests — suites that exercise the narrow
 * branch mock this hook; the visual behavior belongs to the browser
 * pass.
 */
export function useContainerNarrow(
  ref: RefObject<HTMLElement | null>,
  maxWidthPx: number,
): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width =
        entries[entries.length - 1]?.contentRect.width ?? element.clientWidth;
      setNarrow(width > 0 && width < maxWidthPx);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, maxWidthPx]);

  return narrow;
}
