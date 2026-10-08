/**
 * One render plan per page, for every layer that paints it. `Viewer.Page`
 * computes the plan from the store and provides it; `CanvasLayer` and
 * `TextLayer` are painters that draw exactly what it says, so a further layer
 * (highlights, annotations) costs no new zoom logic. The invariants live here
 * once:
 *
 *   - canvas bitmap = CSS zoom × device pixels, inside a pixel budget;
 *   - text layer = CSS zoom only — pdf.js multiplies the device pixel ratio
 *     inside `measureText`, so a zoom × dpr text layer paints spans too large
 *     and native selection truncates words;
 *   - rotation = the page's own `/Rotate` plus the view rotation;
 *   - a paint waits for the zoom to settle: never during a gesture (the column
 *     previews it as a transform), and `RERENDER_DELAY_MS` after the last zoom
 *     or rotation change of a page already painted, so a burst paints once.
 *     A page's first paint does not wait.
 */
import {createContext, useContext, useEffect, useState, type ReactNode} from 'react';
import {useViewerStore} from '../core/context';
import type {PageRotation, PDFPageHandle} from '../core/engine';
import {displayedSize, effectiveRotation} from '../core/rotation';
import {usePageHandle} from '../hooks/usePageHandle';

/** Past 2× device pixels, a sharper backing store costs memory and render time nobody sees. */
const MAX_PIXEL_RATIO = 2;
/** Largest canvas backing store (4096²) — iOS Safari's ceiling; a bigger page renders softer, not blank. */
const MAX_CANVAS_PIXELS = 16_777_216;
/** A zoom or rotation change paints this long after the last one, so a burst paints once. */
const RERENDER_DELAY_MS = 100;

export interface PageRenderPlan {
  handle: PDFPageHandle;
  /** Absolute rotation to draw at: the page's own `/Rotate` plus the view rotation. */
  rotation: PageRotation;
  /** The page's box on screen, in CSS pixels, at `rotation`. */
  cssSize: {width: number; height: number};
  /** The zoom the text layer paints at. */
  cssZoom: number;
  /** The canvas bitmap scale: `cssZoom` × device pixels, within the pixel budget. */
  devicePixelScale: number;
  /**
   * False while a gesture previews a zoom or a zoom/rotation change is still
   * fresh. Painters lay out at the plan's geometry at once and paint when true.
   */
  settled: boolean;
}

/** The geometry of a plan, without the gate. */
export function planPageRender({
  handle,
  zoom,
  viewRotation,
  devicePixelRatio,
  settled,
}: {
  handle: PDFPageHandle;
  zoom: number;
  viewRotation: PageRotation;
  devicePixelRatio: number;
  settled: boolean;
}): PageRenderPlan {
  const cssSize = displayedSize(handle.size, viewRotation, zoom);
  const devicePixels = Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO);
  const pixelRatio = Math.min(devicePixels, Math.sqrt(MAX_CANVAS_PIXELS / (cssSize.width * cssSize.height)));
  return {
    handle,
    rotation: effectiveRotation(handle, viewRotation),
    cssSize,
    cssZoom: zoom,
    devicePixelScale: zoom * pixelRatio,
    settled,
  };
}

/** The handle and view the layers last settled on (or may paint at now). */
interface SettledView {
  handle: PDFPageHandle;
  zoom: number;
  viewRotation: PageRotation;
}

/**
 * The plan for `pageNumber` from the nearest viewer store, or null until its
 * handle resolves. The painters' effects key on the plan's identity; the React
 * Compiler keeps it stable while its inputs are, so a re-render of the page
 * (a virtualized scroll) does not repaint it.
 */
export function usePageRenderPlan(pageNumber: number): PageRenderPlan | null {
  const handle = usePageHandle(pageNumber);
  const zoom = useViewerStore((s) => s.zoom);
  const viewRotation = useViewerStore((s) => s.viewRotation);
  const isGesturing = useViewerStore((s) => s.isGesturing);
  const [settledView, setSettledView] = useState<SettledView | null>(null);

  // A page's first paint does not wait: a new handle settles during render.
  if (handle && settledView?.handle !== handle) setSettledView({handle, zoom, viewRotation});

  // A later change of the same handle settles RERENDER_DELAY_MS after the
  // last one. Not during a gesture: the column previews its zoom as a
  // transform, and the committed zoom settles once it ends.
  const viewChanged = settledView !== null && (settledView.zoom !== zoom || settledView.viewRotation !== viewRotation);
  useEffect(() => {
    if (!handle || isGesturing || !viewChanged) return;
    const timer = setTimeout(() => setSettledView({handle, zoom, viewRotation}), RERENDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [handle, zoom, viewRotation, isGesturing, viewChanged]);

  if (!handle) return null;
  const settled = !isGesturing && settledView?.handle === handle && !viewChanged;
  return planPageRender({handle, zoom, viewRotation, devicePixelRatio: window.devicePixelRatio, settled});
}

interface PlannedPage {
  pageNumber: number;
  /** Null until the page handle resolves: nothing to paint yet. */
  plan: PageRenderPlan | null;
}

const PlannedPageContext = createContext<PlannedPage | null>(null);

/** Hands `plan` to the layers inside. `Viewer.Page` is the provider in the viewer; tests provide a plan of their own. */
export function PlannedPageProvider({pageNumber, plan, children}: PlannedPage & {children: ReactNode}) {
  return <PlannedPageContext.Provider value={{pageNumber, plan}}>{children}</PlannedPageContext.Provider>;
}

/** The page a layer paints. Throws outside a `Viewer.Page`. */
export function usePlannedPage(): PlannedPage {
  const planned = useContext(PlannedPageContext);
  if (!planned) throw new Error('usePlannedPage must be used inside a Viewer.Page');
  return planned;
}
