import * as React from 'react';

export type HeaderTier = 'compact' | 'comfortable' | 'spacious';

// Single source of the tier thresholds. Mirrors the CSS container-query
// cutoffs used for label/divider collapse (@[34rem] / @[48rem]) so the
// JS-gated kebab fold and the CSS-gated labels switch at the same widths.
export const HEADER_TIER_PX = { compact: 544, comfortable: 768 } as const;

function tierForWidth(w: number): HeaderTier {
  if (w < HEADER_TIER_PX.compact) return 'compact';
  if (w < HEADER_TIER_PX.comfortable) return 'comfortable';
  return 'spacious';
}

/**
 * Returns the responsive tier for a header element based on its observed width.
 *
 * @param ref - A STABLE React ref (created once with `useRef`). The effect
 *   depends on `ref` object identity: if you pass a new object each render
 *   (e.g. `{ current: el }` inline), the ResizeObserver will disconnect and
 *   reconnect on every render. Always pass a ref produced by `useRef`.
 */
export function useHeaderTier(ref: React.RefObject<HTMLElement | null>): HeaderTier {
  const [tier, setTier] = React.useState<HeaderTier>('spacious');
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setTier((prev) => {
        const next = tierForWidth(width);
        return prev === next ? prev : next;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return tier;
}

export function useScrolled(threshold = 0): boolean {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}
