import {useRef, useState} from 'react';

import {cn} from '@/lib/utils';

/** Arrow-key increment, in px. Home/End jump to the clamp edges. */
const STEP = 16;

export interface PaneClamp {
  min: number;
  max: number;
  /** Double-click restores this. */
  initial: number;
}

export interface PaneResizerProps {
  /** Which side of this divider the pane it resizes sits on. */
  pane: 'left' | 'right';
  width: number;
  /** min / max / initial travel together — see `paneLayout`. */
  clamp: PaneClamp;
  /**
   * Extra pixels this pane may still claim before the pane BETWEEN the two
   * resizers hits its own floor. Read live (it is a DOM measurement, not
   * state) because the answer changes as the container resizes and as the
   * opposite pane is dragged.
   */
  slack: () => number;
  /** Accessible name — the pane it resizes, not "resize handle". */
  label: string;
  onWidth: (width: number) => void;
  className?: string;
}

/**
 * A 1px pane divider that drags, with pixel clamps.
 *
 * Deliberately NOT `ui/resizable` (react-resizable-panels): that library
 * sizes panels in PERCENT of the group, so a "never below 180px" floor
 * drifts with the window — 10% is 180px on an 1800px card and 90px on a
 * 900px one, which is exactly the collapse-to-unusable behaviour the
 * clamps exist to prevent. It also wants its panels mounted at all times,
 * while both of these panes unmount when toggled off.
 *
 * The divider IS the boundary hairline (`bg-border`); the panes either
 * side draw none, so hovering it never produces a double rule.
 */
export function PaneResizer({
  pane,
  width,
  clamp: {min, max, initial},
  slack,
  label,
  onWidth,
  className,
}: PaneResizerProps) {
  const start = useRef<{x: number; width: number} | null>(null);
  const [dragging, setDragging] = useState(false);

  /**
   * Shrinking is always allowed inside [min, max]. GROWING additionally
   * stops at the live ceiling — and never pulls the pane back below where
   * it already is, so a container that is already too narrow cannot make a
   * keypress yank the pane to its minimum.
   */
  const apply = (next: number) => {
    const bounded = Math.min(max, Math.max(min, Math.round(next)));
    if (bounded <= width) {
      onWidth(bounded);
      return;
    }
    onWidth(Math.min(bounded, Math.max(width, width + slack())));
  };

  /** Positive `dx` = the divider moved right, whichever pane owns it. */
  const nudge = (dx: number) => apply(width + (pane === 'left' ? dx : -dx));

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-testid="pane-resizer"
      onPointerDown={(event) => {
        // preventDefault stops the drag from turning into a text selection
        // across the grid, which makes the whole surface flash blue.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = {x: event.clientX, width};
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const from = start.current;
        if (!from) return;
        const dx = event.clientX - from.x;
        apply(from.width + (pane === 'left' ? dx : -dx));
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        start.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDragging(false);
      }}
      onDoubleClick={() => apply(initial)}
      onKeyDown={(event) => {
        const step: Record<string, () => void> = {
          ArrowLeft: () => nudge(-STEP),
          ArrowRight: () => nudge(STEP),
          Home: () => apply(min),
          End: () => apply(max),
        };
        const run = step[event.key];
        if (!run) return;
        event.preventDefault();
        run();
      }}
      className={cn(
        'relative w-px shrink-0 cursor-col-resize touch-none bg-border',
        // ::after is the 9px pointer strip — a 1px drag target is unusable.
        'after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[""]',
        // ::before is the 3px accent bar for hover / keyboard focus / drag.
        // It has to be a pseudo-element: a focus RING on a 1px box renders as
        // a chunky dark slab, and widening the box itself shifts both panes
        // by 2px every time focus lands on it.
        'before:absolute before:inset-y-0 before:-left-px before:w-[3px] before:bg-transparent before:transition-colors before:content-[""]',
        'hover:before:bg-primary/50',
        'focus-visible:outline-hidden focus-visible:before:bg-ring',
        dragging && 'before:bg-primary',
        className,
      )}
    />
  );
}
