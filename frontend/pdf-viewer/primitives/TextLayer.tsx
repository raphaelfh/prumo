import {useEffect, useRef, useState} from 'react';
import type {TextLayerHandle} from '../core/engine';
import {useViewerStore} from '../core/context';
import {getPageText} from '../services/searchService';
import {usePlannedPage} from './pageRenderPlan';
import {
  buildMatchRanges,
  clearPageSearchHighlights,
  setPageSearchHighlights,
} from './searchHighlight';
import './text-layer.css';

export interface TextLayerProps {
  className?: string;
}

/** Paints the selectable text spans its `Viewer.Page`'s render plan describes, and the search highlights over them. */
export function TextLayer({className}: TextLayerProps) {
  const {pageNumber, plan} = usePlannedPage();
  const containerRef = useRef<HTMLDivElement>(null);
  // The text layer paints asynchronously; the highlights below wait for the
  // spans it paints. A page mounted by search navigation paints after its
  // match is already active.
  const [painted, setPainted] = useState<TextLayerHandle | null>(null);

  // Paint the plan once it settles. Unsettled (a gesture, a fresh zoom), the
  // layer stays empty: its spans would sit at the previous scale.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !plan?.settled) return;

    const ctrl = new AbortController();
    let handle: TextLayerHandle | null = null;
    plan.handle
      .renderTextLayer({container, scale: plan.cssZoom, rotation: plan.rotation, signal: ctrl.signal})
      .then((h) => {
        handle = h;
        if (!ctrl.signal.aborted) setPainted(h);
      })
      .catch((err) => {
        if ((err as DOMException).name !== 'AbortError') {
          console.warn(`TextLayer page ${pageNumber} render failed:`, err);
        }
      });

    return () => {
      ctrl.abort();
      handle?.cancel();
      container.innerHTML = '';
    };
  }, [plan, pageNumber]);

  // Paint the search matches for this page as character-precise DOM Ranges.
  // `searchMatches` is the whole (stable) store array rather than a filtered
  // copy: a new array every render would re-run this effect every render.
  const doc = useViewerStore((s) => s.document);
  const searchMatches = useViewerStore((s) => s.search.matches);
  const activeIndex = useViewerStore((s) => s.search.activeIndex);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!painted || !doc) {
      clearPageSearchHighlights(container);
      return;
    }

    const onPage = searchMatches.filter((m) => m.pageNumber === pageNumber);
    if (onPage.length === 0) {
      clearPageSearchHighlights(container);
      return;
    }

    let cancelled = false;
    void getPageText(doc, pageNumber).then((pageText) => {
      if (cancelled) return;
      const activeMatch = searchMatches[activeIndex];
      const matches: Range[] = [];
      const active: Range[] = [];

      for (const match of onPage) {
        const ranges = buildMatchRanges(pageText, painted.textDivs, match.charStart, match.charEnd);
        const isActive =
          activeMatch?.pageNumber === pageNumber &&
          activeMatch.charStart === match.charStart &&
          activeMatch.charEnd === match.charEnd;
        (isActive ? active : matches).push(...ranges);
      }

      setPageSearchHighlights(container, matches, active);

      // Reveal the active match. A Range has no scrollIntoView, so scroll the
      // span it starts in — the text layer is absolutely positioned over the
      // canvas, so that lands on the right place on the page.
      const first = active[0]?.startContainer.parentElement;
      first?.scrollIntoView({block: 'center', behavior: 'smooth'});
    }).catch((error: unknown) => {
      // Page text can fail to extract (aborted stream, torn-down worker).
      // Leaving this uncaught surfaces as an unhandled rejection and the page
      // keeps whatever highlights it had, which would then be stale. Clear
      // them so the page shows no highlight rather than a wrong one, and say
      // why in the console — `getPageText` no longer caches the failure, so a
      // later search of this page retries.
      if (cancelled) return;
      clearPageSearchHighlights(container);
      console.warn(`pdf-viewer: could not read text of page ${pageNumber} for search`, error);
    });

    return () => {
      cancelled = true;
      clearPageSearchHighlights(container);
    };
  }, [doc, searchMatches, activeIndex, pageNumber, painted]);

  return (
    <div
      ref={containerRef}
      className={`pdf-viewer-text-layer${className ? ` ${className}` : ''}`}
    />
  );
}
