import {useEffect, useMemo, useRef} from 'react';
import {usePageHandle} from '../hooks/usePageHandle';
import {useViewerStore} from '../core/context';
import './text-layer.css';

export interface TextLayerProps {
  pageNumber: number;
  className?: string;
}

export function TextLayer({pageNumber, className}: TextLayerProps) {
  const page = usePageHandle(pageNumber);
  const scale = useViewerStore((s) => s.scale);
  const rotation = useViewerStore((s) => s.rotation);
  const containerRef = useRef<HTMLDivElement>(null);

  // Render the text layer when page/scale/rotation changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!page || !container) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const renderScale = scale * dpr;
    const ctrl = new AbortController();
    let handle: {cancel(): void} | null = null;

    page
      .renderTextLayer({container, scale: renderScale, rotation, signal: ctrl.signal})
      .then((h) => {
        handle = h;
      })
      .catch((err) => {
        if ((err as DOMException).name !== 'AbortError') {
          console.warn(`TextLayer page ${pageNumber} render failed:`, err);
        }
      });

    return () => {
      ctrl.abort();
      handle?.cancel();
      if (container) container.innerHTML = '';
    };
  }, [page, scale, rotation, pageNumber]);

  // Apply highlight classes for search matches after the text layer renders.
  // Subscribe to the whole search object to avoid creating new filtered arrays
  // in the selector (which would cause render loops).
  const searchMatches = useViewerStore((s) => s.search.matches);
  const activeIndex = useViewerStore((s) => s.search.activeIndex);
  const matchesOnPage = useMemo(
    () => searchMatches.filter((m) => m.pageNumber === pageNumber),
    [searchMatches, pageNumber],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
  }, [matchesOnPage, activeIndex, searchMatches, pageNumber]);

  return (
    <div
      ref={containerRef}
      className={`pdf-viewer-text-layer${className ? ` ${className}` : ''}`}
    />
  );
}
