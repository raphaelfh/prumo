import {useEffect, useRef} from 'react';
import {usePlannedPage} from './pageRenderPlan';

export interface CanvasLayerProps {
  className?: string;
}

/** Paints the page bitmap its `Viewer.Page`'s render plan describes. */
export function CanvasLayer({className}: CanvasLayerProps) {
  const {pageNumber, plan} = usePlannedPage();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !plan) return;

    // CSS size first, settled or not: the engine sizes the backing store up
    // front, and a canvas without a CSS size lays out at that size. Set at
    // once, the old bitmap stretches to the new layout until the paint.
    canvas.style.width = `${plan.cssSize.width}px`;
    canvas.style.height = `${plan.cssSize.height}px`;
    // During a gesture the bitmap stays, stretched by the column's transform.
    if (!plan.settled) return;

    const controller = new AbortController();
    plan.handle
      .render({canvas, scale: plan.devicePixelScale, rotation: plan.rotation, signal: controller.signal})
      .catch((err) => {
        if ((err as DOMException).name !== 'AbortError') {
          console.warn(`CanvasLayer page ${pageNumber} render failed:`, err);
        }
      });
    return () => controller.abort();
  }, [plan, pageNumber]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={`PDF page ${pageNumber}`} />;
}
