import {useEffect, useRef, useState} from 'react';
import {usePageHandle} from '../hooks/usePageHandle';
import {useViewerStore} from '../core/context';
import {effectiveRotation} from '../core/rotation';
import './text-layer.css';

/** A zoom or rotation change re-renders the text layer this long after the last one. */
const RERENDER_DELAY_MS = 100;

export interface TextLayerProps {
  pageNumber: number;
  className?: string;
}

export function TextLayer({pageNumber, className}: TextLayerProps) {
  const page = usePageHandle(pageNumber);
  const zoom = useViewerStore((s) => s.zoom);
  const viewRotation = useViewerStore((s) => s.viewRotation);
  const isGesturing = useViewerStore((s) => s.isGesturing);
  const containerRef = useRef<HTMLDivElement>(null);
  // The text layer paints asynchronously; the highlights below wait for the
  // spans it paints. A page mounted by search navigation paints after its
  // match is already active.
  const [painted, setPainted] = useState<object | null>(null);
  const renderedRef = useRef<object | null>(null);

  // Render the text layer when page/zoom/rotation changes. During a gesture the
  // layer stays empty — its spans would sit at the pre-gesture scale.
  useEffect(() => {
    const container = containerRef.current;
    if (!page || !container || isGesturing) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const renderScale = zoom * dpr;
    const ctrl = new AbortController();
    let handle: {cancel(): void} | null = null;

    const paint = () => {
      renderedRef.current = page;
      page
        .renderTextLayer({container, scale: renderScale, rotation: effectiveRotation(page, viewRotation), signal: ctrl.signal})
        .then((h) => {
          handle = h;
          if (!ctrl.signal.aborted) setPainted(h);
        })
        .catch((err) => {
          if ((err as DOMException).name !== 'AbortError') {
            console.warn(`TextLayer page ${pageNumber} render failed:`, err);
          }
        });
    };
    const timer = setTimeout(paint, renderedRef.current === page ? RERENDER_DELAY_MS : 0);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
      handle?.cancel();
      container.innerHTML = '';
    };
  }, [page, zoom, viewRotation, isGesturing, pageNumber]);

  // Apply highlight classes for search matches after the text layer renders.
  // Subscribe to the whole search object to avoid creating new filtered arrays
  // in the selector (which would cause render loops).
  const searchMatches = useViewerStore((s) => s.search.matches);
  const activeIndex = useViewerStore((s) => s.search.activeIndex);
  const matchesOnPage = searchMatches.filter((m) => m.pageNumber === pageNumber);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !painted) return;

    const spans = Array.from(container.querySelectorAll<HTMLElement>('span'));
    if (spans.length === 0) return;

    // Build a flat character offset map: for each span, its start offset
    // within the page's concatenated text.
    const charOffsets: number[] = [];
    let acc = 0;
    for (const span of spans) {
      charOffsets.push(acc);
      acc += span.textContent?.length ?? 0;
    }

    // Clear previous highlight classes.
    for (const span of spans) {
      span.classList.remove('highlight', 'selected');
    }

    const activeMatch = searchMatches[activeIndex];

    for (const match of matchesOnPage) {
      const isActive =
        activeMatch?.pageNumber === pageNumber &&
        activeMatch?.charStart === match.charStart &&
        activeMatch?.charEnd === match.charEnd;

      for (let i = 0; i < spans.length; i++) {
        const spanStart = charOffsets[i];
        const spanEnd = spanStart + (spans[i].textContent?.length ?? 0);
        if (spanStart < match.charEnd && spanEnd > match.charStart) {
          spans[i].classList.add('highlight');
          if (isActive) spans[i].classList.add('selected');
        }
      }
    }

    // Scroll active match into view.
    if (activeMatch?.pageNumber === pageNumber) {
      const firstActive = container.querySelector<HTMLElement>('.highlight.selected');
      if (firstActive) {
        firstActive.scrollIntoView({block: 'center', behavior: 'smooth'});
      }
    }
  }, [matchesOnPage, activeIndex, searchMatches, pageNumber, painted]);

  return (
    <div
      ref={containerRef}
      className={`pdf-viewer-text-layer${className ? ` ${className}` : ''}`}
    />
  );
}
