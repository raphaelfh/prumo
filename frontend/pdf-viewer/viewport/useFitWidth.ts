/**
 * While `fitWidth` is on, the zoom follows the scroller's width: the widest
 * page plus its side gaps fills it. However often the scroller resizes (a
 * split-pane drag), the zoom updates at most once per animation frame;
 * CanvasLayer's re-render delay keeps the drag from re-rendering pages.
 * Adapted from anaralabs/lector (MIT).
 */
import {useEffect} from 'react';
import {useViewerStore, useViewerStoreApi} from '../core/context';
import type {PageLayout} from './usePageLayout';
import {clampZoom} from './zoomMath';

/** Zoom changes smaller than this are rounding, not a resize: ignoring them stops a scrollbar feedback loop. */
const ZOOM_EPSILON = 0.001;

export function useFitWidth({scroller, layout}: {scroller: HTMLElement | null; layout: PageLayout}): void {
  const storeApi = useViewerStoreApi();
  const fitWidth = useViewerStore((s) => s.fitWidth);
  const {naturalWidth, numPages} = layout;

  useEffect(() => {
    if (!scroller || !fitWidth || numPages === 0) return;
    const PENDING = -1;
    let frame: number | null = null;
    const fit = () => {
      frame = null;
      // A hidden scroller (display: none) has no width to fit.
      if (scroller.clientWidth === 0) return;
      const {zoom, actions} = storeApi.getState();
      const next = clampZoom(scroller.clientWidth / naturalWidth);
      if (Math.abs(next - zoom) > ZOOM_EPSILON) actions.setZoom(next, {fitWidth: true});
    };
    const schedule = () => {
      if (frame !== null) return;
      // A placeholder id: a browser's rAF is always async, but a test's may
      // run `fit` synchronously and already clear `frame` before this call
      // returns — the check below then leaves that clear alone instead of
      // reinstating a "pending" frame no one will ever clear.
      frame = PENDING;
      const id = requestAnimationFrame(fit);
      if (frame === PENDING) frame = id;
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    schedule();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [scroller, fitWidth, naturalWidth, numPages, storeApi]);
}
