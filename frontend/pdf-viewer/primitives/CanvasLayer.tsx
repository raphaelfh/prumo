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

    const controller = new AbortController();
    page
      .render({canvas, scale: renderScale, rotation, signal: controller.signal})
      .then(({width, height}) => {
        // Display size in CSS pixels (independent of DPR)
        canvas.style.width = `${width / dpr}px`;
        canvas.style.height = `${height / dpr}px`;
      })
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
