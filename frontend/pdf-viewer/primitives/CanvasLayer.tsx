import {useEffect, useRef} from 'react';
import {useViewerStore} from '../core/context';
import {displayedSize, effectiveRotation} from '../core/rotation';
import {usePageHandle} from '../hooks/usePageHandle';

/** Past 2× device pixels, a sharper backing store costs memory and render time nobody sees. */
const MAX_PIXEL_RATIO = 2;
/** Largest canvas backing store (4096²) — iOS Safari's ceiling; a bigger page renders softer, not blank. */
const MAX_CANVAS_PIXELS = 16_777_216;
/** A zoom or rotation change renders this long after the last one, so a burst renders once. */
const RERENDER_DELAY_MS = 100;

export interface CanvasLayerProps {
  pageNumber: number;
  className?: string;
}

export function CanvasLayer({pageNumber, className}: CanvasLayerProps) {
  const page = usePageHandle(pageNumber);
  const zoom = useViewerStore((s) => s.zoom);
  const viewRotation = useViewerStore((s) => s.viewRotation);
  const isGesturing = useViewerStore((s) => s.isGesturing);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The page handle last drawn: a later render of it waits for the zoom to settle.
  const drawnRef = useRef<object | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    // During a gesture the canvas keeps its bitmap, stretched by the column's transform.
    if (!page || !canvas || isGesturing) return;

    // Display size in CSS pixels, set BEFORE rendering: the engine sizes the
    // backing store up front, and a canvas without a CSS size lays out at its
    // backing size. Set at once, so the old bitmap stretches to the new layout.
    const box = displayedSize(page.size, viewRotation, zoom);
    canvas.style.width = `${box.width}px`;
    canvas.style.height = `${box.height}px`;

    const devicePixels = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const pixelRatio = Math.min(devicePixels, Math.sqrt(MAX_CANVAS_PIXELS / (box.width * box.height)));
    const controller = new AbortController();
    const draw = () => {
      drawnRef.current = page;
      page
        .render({canvas, scale: zoom * pixelRatio, rotation: effectiveRotation(page, viewRotation), signal: controller.signal})
        .catch((err) => {
          if ((err as DOMException).name !== 'AbortError') {
            console.warn(`CanvasLayer page ${pageNumber} render failed:`, err);
          }
        });
    };
    const timer = setTimeout(draw, drawnRef.current === page ? RERENDER_DELAY_MS : 0);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [page, zoom, viewRotation, isGesturing, pageNumber]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={`PDF page ${pageNumber}`} />;
}
