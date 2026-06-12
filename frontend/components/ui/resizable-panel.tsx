/**
 * Resizable side panel with drag handle, click-to-collapse, snap-collapse, and persistence.
 * UX:
 * - During drag the visible width clamps to [minWidth, maxWidth] — past minWidth the
 *   panel "sticks" while the cursor keeps moving. If the cursor travels far enough
 *   past the minimum (raw position below snapCollapseAt) the panel closes on release.
 * - 8px transparent hit area; a 1px neutral bar fades in on hover and stays visible
 *   while dragging.
 * - Smooth animated close (width + opacity to 0) instead of instant unmount.
 * See docs/superpowers/design-system/sidebar-and-panels.md §1.
 */
import React, {useEffect, useRef, useState} from 'react';
import {cn} from '@/lib/utils';

export interface ResizablePanelProps {
  id: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  snapCollapseAt: number;
  side: 'left' | 'right';
  collapsed?: boolean;
  onCollapse?: () => void;
  className?: string;
  children: React.ReactNode;
}

const DRAG_THRESHOLD_PX = 4;
const CLOSE_ANIMATION_MS = 200;

function storageKey(id: string): string {
  return `prumo:${id}:width`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function readStoredWidth(id: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredWidth(id: string, w: number): void {
  try {
    localStorage.setItem(storageKey(id), String(w));
  } catch {
    /* ignore */
  }
}


export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  id,
  defaultWidth,
  minWidth,
  maxWidth,
  snapCollapseAt,
  side,
  collapsed,
  onCollapse,
  className,
  children,
}) => {
  const initialWidth = clamp(readStoredWidth(id, defaultWidth), minWidth, maxWidth);
  const [width, setWidth] = useState<number>(initialWidth);
  /** Visual width including rubber-band overshoot; only differs from `width` while dragging. */
  const [visualWidth, setVisualWidth] = useState<number>(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  /** True while the close animation is playing; aside stays mounted but transitions to 0. */
  const [isClosing, setIsClosing] = useState(false);
  const dragStartRef = useRef<{startX: number; startWidth: number; moved: boolean; rawFinal: number} | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{visual: number; raw: number} | null>(null);
  // Holds the exact listener identities currently registered on `document`, so
  // pointer-up can detach both move and up handlers without the up handler
  // having to reference its own binding inside its initializer (which the React
  // Compiler's mutation-aliasing inference cannot model).
  const listenersRef = useRef<{move: EventListener; up: EventListener} | null>(null);

  const persist = (w: number) => {
    writeStoredWidth(id, w);
  };

  const flushPending = () => {
    rafRef.current = null;
    if (pendingRef.current != null) {
      setVisualWidth(pendingRef.current.visual);
      pendingRef.current = null;
    }
  };

  const onPointerMove = (e: PointerEvent | MouseEvent | TouchEvent) => {
    const start = dragStartRef.current;
    if (!start) return;
    if ('preventDefault' in e) e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const delta = clientX - start.startX;
    const dx = side === 'right' ? delta : -delta;
    if (Math.abs(dx) >= DRAG_THRESHOLD_PX) start.moved = true;
    const raw = start.startWidth + dx;
    start.rawFinal = raw;
    // Visible width sticks within [min, max]; raw is what we use to detect snap-close.
    const visual = clamp(raw, minWidth, maxWidth);
    pendingRef.current = {visual, raw};
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(flushPending);
    }
  };

  // Detaches whatever move/up listeners are currently registered. Reading the
  // identities back from a ref means the up handler never has to reference its
  // own binding (which the compiler cannot reason about). Both event-name pairs
  // are removed regardless of which input started the drag — matching the
  // original handler, which always cleaned up all four.
  const detachListeners = () => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    document.removeEventListener('mousemove', listeners.move);
    document.removeEventListener('mouseup', listeners.up);
    document.removeEventListener('touchmove', listeners.move);
    document.removeEventListener('touchend', listeners.up);
    listenersRef.current = null;
  };

  const onPointerUp = () => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    detachListeners();
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    setIsDragging(false);
    if (!start) return;

    if (!start.moved) {
      // Pure click → toggle collapse via parent (animated by the collapsed-prop effect below).
      onCollapse?.();
      return;
    }

    const rawFinal = start.rawFinal;
    if (rawFinal < snapCollapseAt) {
      // Snap-close: parent will set collapsed=true; the close animation plays via the prop effect.
      // Reset stored width so next expand starts at default.
      setWidth(defaultWidth);
      persist(defaultWidth);
      onCollapse?.();
      return;
    }
    const finalWidth = clamp(rawFinal, minWidth, maxWidth);
    setWidth(finalWidth);
    setVisualWidth(finalWidth);
    persist(finalWidth);
  };

  const attachListeners = (kind: 'mouse' | 'touch') => {
    const move = onPointerMove as EventListener;
    const up = onPointerUp as EventListener;
    listenersRef.current = {move, up};
    if (kind === 'mouse') {
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    } else {
      document.addEventListener('touchmove', move);
      document.addEventListener('touchend', up);
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = {startX: e.clientX, startWidth: width, moved: false, rawFinal: width};
    setIsDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    attachListeners('mouse');
  };

  const onTouchStart = (e: React.TouchEvent) => {
    dragStartRef.current = {startX: e.touches[0].clientX, startWidth: width, moved: false, rawFinal: width};
    setIsDragging(true);
    attachListeners('touch');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onCollapse?.();
      return;
    }
    const step = 16;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = clamp(width - step, minWidth, maxWidth);
      setWidth(next);
      setVisualWidth(next);
      persist(next);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = clamp(width + step, minWidth, maxWidth);
      setWidth(next);
      setVisualWidth(next);
      persist(next);
    }
  };

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== storageKey(id) || e.newValue == null) return;
      const n = Number(e.newValue);
      if (Number.isFinite(n)) {
        const clamped = clamp(n, minWidth, maxWidth);
        setWidth(clamped);
        setVisualWidth(clamped);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [id, minWidth, maxWidth]);

  // Animate the open → close transition driven by the external `collapsed` prop.
  // We only kick the animation off when `collapsed` flips from false → true; an initial
  // render with `collapsed=true` should stay unmounted (no entry animation).
  // Adjusted during render (not in an effect) so the same <aside> node stays mounted
  // across the flip and the width/opacity transition can actually play.
  const [prevCollapsed, setPrevCollapsed] = useState(collapsed);
  if (collapsed !== prevCollapsed) {
    setPrevCollapsed(collapsed);
    setIsClosing(!!collapsed);
  }
  useEffect(() => {
    if (!isClosing) return undefined;
    const t = setTimeout(() => setIsClosing(false), CLOSE_ANIMATION_MS);
    return () => clearTimeout(t);
  }, [isClosing]);

  if (collapsed && !isClosing) return null;

  const contentOpacity = collapsed ? 0 : 1;
  const renderedWidth = collapsed ? 0 : visualWidth;

  return (
    <aside
      className={cn(
        'relative flex-shrink-0 overflow-hidden',
        // Disable the smooth transition during active drag — the cursor drives width directly.
        isDragging ? '' : 'transition-[width,opacity] duration-200 ease-out motion-reduce:duration-0',
        className,
      )}
      style={{width: `${renderedWidth}px`, opacity: contentOpacity}}
    >
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        aria-controls={id}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onKeyDown={onKeyDown}
        title="Click to collapse · Drag to resize"
        className={cn(
          // Wider hit area (8px) for easier grabbing; visual bar centered inside.
          'absolute top-0 bottom-0 w-2 cursor-col-resize z-10 group/handle',
          side === 'right' ? '-right-1' : '-left-1',
          'focus-visible:outline-none',
        )}
      >
        <div
          className={cn(
            // Single neutral 1px bar; opacity is the only thing that changes.
            // Linear/Notion-style: invisible at rest, subtle on hover, slightly stronger while dragging.
            'pointer-events-none absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-foreground/30 transition-opacity duration-150',
            isDragging ? 'opacity-100' : 'opacity-0 group-hover/handle:opacity-60',
          )}
        />
      </div>
    </aside>
  );
};

export default ResizablePanel;
