/**
 * Zoom arithmetic for the canvas view — pure, no DOM, so every rule is unit
 * tested. The wheel-inertia filter is adapted from anaralabs/lector (MIT).
 */

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
/** One zoom step: a button press, a key chord, or a mouse-wheel notch. */
export const ZOOM_STEP = 1.25;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The scroll position at `toZoom` that keeps the content under `pointer` where
 * it is. The page column scales uniformly with zoom (gaps included) and is
 * centred while narrower than the viewport, top-aligned always.
 */
export function anchoredScroll({
  pointer,
  scroll,
  viewportWidth,
  contentWidth,
  fromZoom,
  toZoom,
}: {
  pointer: Point;
  scroll: {left: number; top: number};
  viewportWidth: number;
  contentWidth: number;
  fromZoom: number;
  toZoom: number;
}): {left: number; top: number} {
  const inset = (zoom: number) => Math.max(0, (viewportWidth - contentWidth * zoom) / 2);
  // The pointer's position in the column at zoom 1.
  const x = (pointer.x + scroll.left - inset(fromZoom)) / fromZoom;
  const y = (pointer.y + scroll.top) / fromZoom;
  return {
    left: Math.max(0, x * toZoom + inset(toZoom) - pointer.x),
    top: Math.max(0, y * toZoom - pointer.y),
  };
}

const DOM_DELTA_PIXEL = 0;

/**
 * The zoom factor one ctrl/⌘ + wheel event asks for. A line or page delta (a
 * mouse notch) is one step; pixel deltas zoom continuously, capped at one step
 * per event — Chrome reports a mouse notch as ±100px.
 */
export function wheelStep({deltaY, deltaMode}: {deltaY: number; deltaMode: number}): number {
  if (deltaY === 0) return 1;
  if (deltaMode !== DOM_DELTA_PIXEL) return deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  return Math.min(ZOOM_STEP, Math.max(1 / ZOOM_STEP, Math.exp(-deltaY / 100)));
}

/** How long after a pinch plain wheel events still count as its inertia. */
export const WHEEL_INERTIA_GAP_MS = 140;
/** A plain wheel delta this many times the last one (+1) is the user scrolling, not inertia. */
export const WHEEL_INERTIA_ESCAPE_FACTOR = 1.35;

export interface WheelInertia {
  active: boolean;
  lastTime: number;
  lastAbsDeltaY: number;
  lastSign: -1 | 0 | 1;
}

export const IDLE_WHEEL_INERTIA: WheelInertia = {active: false, lastTime: 0, lastAbsDeltaY: 0, lastSign: 0};

/**
 * Classify one wheel event. A trackpad keeps sending plain wheel events for a
 * moment after a pinch; scrolling on them would fling the page just zoomed.
 * Returns the next state and whether to prevent the native scroll. ctrl/⌘
 * events are always prevented — they zoom.
 */
export function filterWheel(
  state: WheelInertia,
  event: {ctrlKey: boolean; deltaX: number; deltaY: number; timeStamp: number},
): {state: WheelInertia; prevent: boolean} {
  const abs = Math.abs(event.deltaY);
  const sign = (event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0) as -1 | 0 | 1;
  const tracked: WheelInertia = {active: true, lastTime: event.timeStamp, lastAbsDeltaY: abs, lastSign: sign};
  if (event.ctrlKey) return {state: tracked, prevent: true};
  if (!state.active) return {state, prevent: false};
  const escaped =
    // Inertia is vertical: a horizontal-dominant wheel is a pan.
    Math.abs(event.deltaX) > abs ||
    event.timeStamp - state.lastTime > WHEEL_INERTIA_GAP_MS ||
    (state.lastSign !== 0 && sign !== 0 && sign !== state.lastSign) ||
    (state.lastAbsDeltaY > 0 && abs > state.lastAbsDeltaY * WHEEL_INERTIA_ESCAPE_FACTOR + 1);
  if (escaped) return {state: IDLE_WHEEL_INERTIA, prevent: false};
  return {state: tracked, prevent: true};
}
