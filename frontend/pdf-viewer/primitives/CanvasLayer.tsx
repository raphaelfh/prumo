import {useEffect, useRef} from 'react';
import {usePageHandle} from '../hooks/usePageHandle';
import {useViewerStore} from '../core/context';
import {displayedSize, effectiveRotation} from '../core/rotation';

export interface CanvasLayerProps {
  pageNumber: number;
  className?: string;
}

export function CanvasLayer({pageNumber, className}: CanvasLayerProps) {
  const page = usePageHandle(pageNumber);
  const zoom = useViewerStore((s) => s.zoom);
  const viewRotation = useViewerStore((s) => s.viewRotation);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const renderScale = zoom * dpr;

    // Display size in CSS pixels, set BEFORE rendering: the engine sizes the
    // DPR-scaled backing store up front, and a canvas without a CSS size lays
    // out at its backing size — DPR× too large until the render resolves.
    const {width, height} = displayedSize(page.size, viewRotation, zoom);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const controller = new AbortController();
    page
      .render({canvas, scale: renderScale, rotation: effectiveRotation(page, viewRotation), signal: controller.signal})
      .catch((err) => {
        if ((err as DOMException).name !== 'AbortError') {
          console.warn(`CanvasLayer page ${pageNumber} render failed:`, err);
        }
      });

    return () => controller.abort();
  }, [page, zoom, viewRotation, pageNumber]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={`PDF page ${pageNumber}`}
    />
  );
}
