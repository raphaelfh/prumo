import {describe, expect, it} from 'vitest';
import {
  IDLE_WHEEL_INERTIA,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  anchoredScroll,
  clampZoom,
  filterWheel,
  wheelStep,
  type WheelInertia,
} from '../zoomMath';

describe('clampZoom', () => {
  it('keeps a zoom inside the limits', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(1.3)).toBe(1.3);
  });
});

describe('anchoredScroll', () => {
  // A 612pt page plus 16px side gaps, in an 800px-wide scroller.
  const base = {viewportWidth: 800, contentWidth: 644};

  it('keeps the content under the pointer in place when the column starts narrower than the viewport', () => {
    // At zoom 1 the 644px column is centred (78px inset), so the pointer at
    // x=400 is over content x=322; at zoom 2 the column overflows (no inset).
    const next = anchoredScroll({...base, pointer: {x: 400, y: 300}, scroll: {left: 0, top: 1000}, fromZoom: 1, toZoom: 2});
    expect(next).toEqual({left: 322 * 2 - 400, top: 1300 * 2 - 300});
  });

  it('returns to the starting scroll position when the zoom is undone', () => {
    const pointer = {x: 250, y: 410};
    const start = {left: 120, top: 5320};
    const zoomedIn = anchoredScroll({...base, pointer, scroll: start, fromZoom: 1.5, toZoom: 3});
    const back = anchoredScroll({...base, pointer, scroll: zoomedIn, fromZoom: 3, toZoom: 1.5});
    expect(back.left).toBeCloseTo(start.left, 6);
    expect(back.top).toBeCloseTo(start.top, 6);
  });

  it('never asks for a negative scroll position', () => {
    const next = anchoredScroll({...base, pointer: {x: 400, y: 300}, scroll: {left: 0, top: 0}, fromZoom: 2, toZoom: 0.5});
    expect(next.left).toBeGreaterThanOrEqual(0);
    expect(next.top).toBeGreaterThanOrEqual(0);
  });
});

describe('wheelStep', () => {
  const LINE = 1;
  const PAGE = 2;
  const PIXEL = 0;

  it('makes a line or page delta one zoom step', () => {
    expect(wheelStep({deltaY: -3, deltaMode: LINE})).toBe(ZOOM_STEP);
    expect(wheelStep({deltaY: 3, deltaMode: LINE})).toBe(1 / ZOOM_STEP);
    expect(wheelStep({deltaY: -1, deltaMode: PAGE})).toBe(ZOOM_STEP);
  });

  it('zooms continuously on small pixel deltas (a trackpad pinch)', () => {
    expect(wheelStep({deltaY: -10, deltaMode: PIXEL})).toBeCloseTo(Math.exp(0.1), 10);
    expect(wheelStep({deltaY: 4, deltaMode: PIXEL})).toBeCloseTo(Math.exp(-0.04), 10);
  });

  it('caps a large pixel delta (a mouse notch in Chrome) at one step', () => {
    expect(wheelStep({deltaY: -100, deltaMode: PIXEL})).toBe(ZOOM_STEP);
    expect(wheelStep({deltaY: 100, deltaMode: PIXEL})).toBe(1 / ZOOM_STEP);
  });

  it('does nothing for a zero delta', () => {
    expect(wheelStep({deltaY: 0, deltaMode: PIXEL})).toBe(1);
  });
});

describe('filterWheel', () => {
  const wheel = (over: Partial<{ctrlKey: boolean; deltaX: number; deltaY: number; timeStamp: number}>) => ({
    ctrlKey: false,
    deltaX: 0,
    deltaY: 10,
    timeStamp: 1000,
    ...over,
  });
  const afterPinch = (): WheelInertia => filterWheel(IDLE_WHEEL_INERTIA, wheel({ctrlKey: true, deltaY: 10, timeStamp: 1000})).state;

  it('prevents a ctrl/⌘ wheel — it zooms', () => {
    expect(filterWheel(IDLE_WHEEL_INERTIA, wheel({ctrlKey: true})).prevent).toBe(true);
  });

  it('lets a plain wheel scroll when no pinch preceded it', () => {
    expect(filterWheel(IDLE_WHEEL_INERTIA, wheel({})).prevent).toBe(false);
  });

  it('swallows the pinch’s inertia: same direction, similar size, within 140ms', () => {
    const first = filterWheel(afterPinch(), wheel({deltaY: 9, timeStamp: 1100}));
    expect(first.prevent).toBe(true);
    expect(filterWheel(first.state, wheel({deltaY: 7, timeStamp: 1200})).prevent).toBe(true);
  });

  it('lets the user scroll after a 140ms pause', () => {
    expect(filterWheel(afterPinch(), wheel({deltaY: 9, timeStamp: 1141})).prevent).toBe(false);
  });

  it('lets the user scroll when the direction flips', () => {
    expect(filterWheel(afterPinch(), wheel({deltaY: -9, timeStamp: 1050})).prevent).toBe(false);
  });

  it('lets the user pan sideways', () => {
    expect(filterWheel(afterPinch(), wheel({deltaX: 30, deltaY: 5, timeStamp: 1050})).prevent).toBe(false);
  });

  it('lets the user scroll when the delta grows past 1.35× (+1)', () => {
    expect(filterWheel(afterPinch(), wheel({deltaY: 14.6, timeStamp: 1050})).prevent).toBe(false);
    expect(filterWheel(afterPinch(), wheel({deltaY: 14.4, timeStamp: 1050})).prevent).toBe(true);
  });
});
