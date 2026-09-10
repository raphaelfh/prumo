import {useEffect, useRef} from 'react';
import {usePageHandle} from '../hooks/usePageHandle';
import {useViewerStore} from '../core/context';

export interface CanvasLayerProps {
  pageNumber: number;
  className?: string;
}

export function CanvasLayer({pageNumber, className}: CanvasLayerProps) {
  const page = usePageHandle(pageNumber);
  const scale = useViewerStore((s) => s.scale);
  const rotation = useViewerStore((s) => s.rotation);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const renderScale = scale * dpr;

    // Display size in CSS pixels, set BEFORE rendering: the engine sizes the
    // DPR-scaled backing store up front, and a canvas without a CSS size lays
    // out at its backing size — DPR× too large until the render resolves.
    const quarterTurn = rotation === 90 || rotation === 270;
    const {width, height} = page.size;
    canvas.style.width = `${(quarterTurn ? height : width) * scale}px`;
    canvas.style.height = `${(quarterTurn ? width : height) * scale}px`;

    const controller = new AbortController();
    page
      .render({canvas, scale: renderScale, rotation, signal: controller.signal})
      .catch((err) => {
        if ((err as DOMException).name !== 'AbortError') {
          console.warn(`CanvasLayer page ${pageNumber} render failed:`, err);
        }
      });

    return () => controller.abort();
  }, [page, scale, rotation, pageNumber]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={`PDF page ${pageNumber}`}
    />
  );
}
