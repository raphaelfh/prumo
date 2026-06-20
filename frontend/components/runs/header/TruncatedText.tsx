import { useLayoutEffect, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Caps a text slot and shows the full string in a tooltip ONLY when the text is
 * actually truncated (scrollWidth > clientWidth). Tooltip on hover AND focus
 * (focusable trigger). No tooltip — and no focus stop — when the text fits.
 */
export function TruncatedText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  // Re-measure on text change AND on container resize (the header bar width
  // shifts when the sidebar / PDF panels toggle, which can newly truncate a
  // title that previously fit). ResizeObserver guarded for non-DOM test envs.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  const span = (
    <span
      ref={ref}
      tabIndex={truncated ? 0 : undefined}
      className={cn(
        'block truncate',
        truncated && 'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {text}
    </span>
  );
  if (!truncated) return span;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{span}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
