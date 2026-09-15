// Adapted from anaralabs/lector (MIT)
/**
 * Pinch (touch, trackpad) and ctrl/⌘ + wheel zoom on the canvas view.
 *
 * A gesture previews its zoom as a CSS transform on the page column, keeps
 * the content under the pointer in place by writing the scroll position at
 * most once per animation frame, and commits the zoom to the store only when
 * it ends — so pages re-lay out and re-render once, not per event. A zoom
 * that does not come from a gesture (buttons, keys, fit width) is anchored
 * at the top centre of the viewport.
 */
import {usePinch} from '@use-gesture/react';
import {useEffect, useLayoutEffect, useMemo, useRef} from 'react';
import type {StoreApi} from 'zustand';
import {useViewerStoreApi} from '../core/context';
import type {ViewerState} from '../core/state';
import type {PageLayout} from './usePageLayout';
import {IDLE_WHEEL_INERTIA, anchoredScroll, clampZoom, filterWheel, wheelStep, type Point} from './zoomMath';

/** A ctrl/⌘ + wheel gesture ends once its events pause this long. */
const WHEEL_GESTURE_END_MS = 150;

interface Elements {
  scroller: HTMLElement;
  sizer: HTMLElement;
  pages: HTMLElement;
}

interface Gesture {
  committedZoom: number;
  appliedZoom: number;
  zoom: number;
  pointer: Point;
  startScroll: {left: number; top: number};
  frame: number | null;
}

/**
 * A committed zoom that did not come from a gesture (buttons, keys, fit
 * width): drop the preview transform, and anchor at the top centre of the
 * viewport. A plain function, not part of the hook's compiled unit — the
 * React Compiler forbids mutating a hook's own parameters in its body.
 */
function clearPreviewTransform(pages: HTMLElement) {
  pages.style.transform = '';
}

/**
 * The scroller's last-seen border-box size. Classic scrollbars shrink the
 * content box (not the border box) when a wide zoom adds one, so an observer
 * watching the content box fires spuriously mid-gesture; comparing border-box
 * dimensions ignores that and only fires on a real viewer resize.
 */
function borderBoxSize(entry: ResizeObserverEntry): {width: number; height: number} {
  const box = entry.borderBoxSize?.[0];
  if (box) return {width: box.inlineSize, height: box.blockSize};
  const rect = entry.target.getBoundingClientRect();
  return {width: rect.width, height: rect.height};
}

function anchorNonGestureZoom({scroller, pages}: {scroller: HTMLElement; pages: HTMLElement}, layout: PageLayout, fromZoom: number) {
  clearPreviewTransform(pages);
  const scroll = anchoredScroll({
    pointer: {x: scroller.clientWidth / 2, y: 0},
    scroll: {left: scroller.scrollLeft, top: scroller.scrollTop},
    viewportWidth: scroller.clientWidth,
    contentWidth: layout.naturalWidth,
    fromZoom,
    toZoom: layout.zoom,
  });
  scroller.scrollLeft = scroll.left;
  scroller.scrollTop = scroll.top;
}

function createGestureController(storeApi: StoreApi<ViewerState>, {scroller, sizer, pages}: Elements) {
  let layout: PageLayout | null = null;
  let gesture: Gesture | null = null;
  let committed = false;

  function paint() {
    if (!gesture || !layout) return;
    gesture.frame = null;
    const scale = gesture.zoom / gesture.committedZoom;
    const scroll = anchoredScroll({
      pointer: gesture.pointer,
      scroll: {left: scroller.scrollLeft, top: scroller.scrollTop},
      viewportWidth: scroller.clientWidth,
      contentWidth: layout.naturalWidth,
      fromZoom: gesture.appliedZoom,
      toZoom: gesture.zoom,
    });
    // Resize the sizer first, so the scroll position is not clamped to the old size.
    sizer.style.width = `${layout.width * scale}px`;
    sizer.style.height = `${layout.totalHeight * scale}px`;
    pages.style.transform = `scale(${scale})`;
    scroller.scrollLeft = scroll.left;
    scroller.scrollTop = scroll.top;
    gesture.appliedZoom = gesture.zoom;
  }

  function restoreCommittedGeometry() {
    if (!layout) return;
    sizer.style.width = `${layout.width}px`;
    sizer.style.height = `${layout.totalHeight}px`;
    pages.style.transform = '';
  }

  return {
    /** The layout at the committed zoom. */
    setLayout(next: PageLayout) {
      layout = next;
    },

    /** The zoom of the gesture under way, else the committed zoom. */
    zoom(): number {
      return gesture?.zoom ?? storeApi.getState().zoom;
    },

    /** Zoom to `zoom` keeping the content under `pointer` (px from the scroller's top-left) in place. */
    zoomTo(zoom: number, pointer: Point) {
      if (!gesture) {
        const committedZoom = storeApi.getState().zoom;
        gesture = {
          committedZoom,
          appliedZoom: committedZoom,
          zoom: committedZoom,
          pointer,
          startScroll: {left: scroller.scrollLeft, top: scroller.scrollTop},
          frame: null,
        };
        storeApi.getState().actions.setGesturing(true);
      }
      gesture.zoom = clampZoom(zoom);
      gesture.pointer = pointer;
      if (gesture.frame === null) gesture.frame = requestAnimationFrame(paint);
    },

    /** Commit the gesture's zoom to the store. */
    end() {
      if (!gesture) return;
      if (gesture.frame !== null) {
        cancelAnimationFrame(gesture.frame);
        paint();
      }
      const {zoom, committedZoom} = gesture;
      gesture = null;
      if (zoom === committedZoom) restoreCommittedGeometry();
      else committed = true;
      const {actions} = storeApi.getState();
      actions.setZoom(zoom);
      actions.setGesturing(false);
    },

    /** Abandon the gesture: back to the committed zoom and the scroll position it started from. */
    cancel() {
      if (!gesture) return;
      if (gesture.frame !== null) cancelAnimationFrame(gesture.frame);
      const {startScroll} = gesture;
      gesture = null;
      restoreCommittedGeometry();
      scroller.scrollLeft = startScroll.left;
      scroller.scrollTop = startScroll.top;
      storeApi.getState().actions.setGesturing(false);
    },

    /** True once after `end()` committed a new zoom — that zoom is already anchored. */
    takeCommitted(): boolean {
      const was = committed;
      committed = false;
      return was;
    },
  };
}

export function useGestureZoom({
  scroller,
  sizer,
  pages,
  layout,
}: {
  scroller: HTMLElement | null;
  sizer: HTMLElement | null;
  pages: HTMLElement | null;
  layout: PageLayout;
}): void {
  const storeApi = useViewerStoreApi();
  const controller = useMemo(
    () => (scroller && sizer && pages ? createGestureController(storeApi, {scroller, sizer, pages}) : null),
    [storeApi, scroller, sizer, pages],
  );

  // A new committed zoom: drop the preview transform, and anchor a zoom that
  // did not come from a gesture at the top centre of the viewport.
  const previousZoom = useRef(layout.zoom);
  useLayoutEffect(() => {
    controller?.setLayout(layout);
    const fromZoom = previousZoom.current;
    previousZoom.current = layout.zoom;
    if (!controller || !scroller || !pages || fromZoom === layout.zoom) return;
    if (controller.takeCommitted()) {
      clearPreviewTransform(pages);
      return;
    }
    anchorNonGestureZoom({scroller, pages}, layout, fromZoom);
  }, [controller, layout, scroller, pages]);

  useEffect(() => {
    if (!controller || !scroller) return;
    let inertia = IDLE_WHEEL_INERTIA;
    let endTimer: ReturnType<typeof setTimeout> | undefined;

    const onWheel = (event: WheelEvent) => {
      const ctrlKey = event.ctrlKey || event.metaKey;
      const next = filterWheel(inertia, {ctrlKey, deltaX: event.deltaX, deltaY: event.deltaY, timeStamp: event.timeStamp});
      inertia = next.state;
      if (next.prevent) event.preventDefault();
      if (!ctrlKey) return;
      const rect = scroller.getBoundingClientRect();
      controller.zoomTo(controller.zoom() * wheelStep(event), {x: event.clientX - rect.left, y: event.clientY - rect.top});
      clearTimeout(endTimer);
      endTimer = setTimeout(() => controller.end(), WHEEL_GESTURE_END_MS);
    };
    // Safari turns a trackpad pinch into gesture events and zooms the whole page on them.
    const preventPageZoom = (event: Event) => event.preventDefault();
    const cancel = () => controller.cancel();
    let lastSize: {width: number; height: number} | null = null;
    const resizes = new ResizeObserver((entries) => {
      const next = borderBoxSize(entries[0]);
      const previous = lastSize;
      lastSize = next;
      if (!previous) return; // the initial callback on observe() only records the size
      if (Math.abs(next.width - previous.width) >= 1 || Math.abs(next.height - previous.height) >= 1) {
        cancel();
      }
    });

    scroller.addEventListener('wheel', onWheel, {passive: false});
    scroller.addEventListener('gesturestart', preventPageZoom);
    scroller.addEventListener('gesturechange', preventPageZoom);
    // Capture: a cancelled touch restores before the pinch handler could commit.
    scroller.addEventListener('pointercancel', cancel, {capture: true});
    resizes.observe(scroller, {box: 'border-box'});
    return () => {
      clearTimeout(endTimer);
      controller.cancel();
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('gesturestart', preventPageZoom);
      scroller.removeEventListener('gesturechange', preventPageZoom);
      scroller.removeEventListener('pointercancel', cancel, {capture: true});
      resizes.disconnect();
    };
  }, [controller, scroller]);

  usePinch(
    ({first, last, movement: [ratio], origin: [x, y], memo}) => {
      if (!controller || !scroller) return memo;
      if (last) {
        controller.end();
        return memo;
      }
      const startZoom: number = first ? controller.zoom() : memo;
      const rect = scroller.getBoundingClientRect();
      controller.zoomTo(startZoom * ratio, {x: x - rect.left, y: y - rect.top});
      return startZoom;
    },
    // ctrl/⌘ + wheel is handled above with its own step and inertia filter.
    {target: scroller ?? undefined, eventOptions: {passive: false}, pinchOnWheel: false, enabled: controller !== null},
  );
}
