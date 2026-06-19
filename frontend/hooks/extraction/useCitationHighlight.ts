/**
 * useCitationHighlight — orchestrates the PDF viewer state to highlight a
 * single CitationAnchor (text, region, or hybrid).
 *
 * Text / hybrid anchors reuse the viewer's existing search-highlight system
 * (`setSearchMatches`): the TextLayer already renders `.highlight.selected`
 * spans for matching char ranges and scrolls them into view — no new DOM
 * selection logic needed.
 *
 * Region / hybrid anchors expose a `activeHighlight` projected rect
 * (`{page, top, left, width, height}` in CSS pixels) so a consumer can
 * render a `position:absolute` overlay inside the page canvas area.
 *
 * Projection formula (PDF user space → CSS pixels, Y-flip origin):
 *   left   = rect.x * scale
 *   top    = (pageHeightPts - rect.y - rect.height) * scale
 *   width  = rect.width  * scale
 *   height = rect.height * scale
 *
 * In `reader` mode there is no canvas surface; the overlay rect is set to
 * null while navigation and text-highlight still work normally.
 *
 * React Compiler constraint: no try/finally, no throw inside try.
 */
import {useState, useCallback} from 'react';
import type {StoreApi} from 'zustand';

import type {CitationAnchor} from '@/pdf-viewer/core/citation';
import {projectPdfRectToCss} from '@/pdf-viewer/core/coordinates';
import {useViewerStoreApiOptional} from '@/pdf-viewer/core/context';
import type {ViewerState} from '@/pdf-viewer/core/state';
import {usePageHandle} from '@/pdf-viewer/hooks/usePageHandle';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A projected rect in CSS pixels, relative to the page canvas element.
 * `top`/`left` are the CSS-space coordinates of the PDF bbox top-left corner.
 */
export interface CitationOverlayRect {
  page: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface UseCitationHighlightReturn {
  /**
   * Activate a citation anchor in the viewer.
   * Navigates to the correct page, drives text highlighting (text/hybrid),
   * and computes an overlay rect (region/hybrid, canvas mode only).
   * Replaces any previously active highlight.
   * Safe no-op when `isAvailable` is false (no ViewerProvider present).
   */
  highlight(anchor: CitationAnchor): void;
  /** Clear the active highlight: search, activeCitation, and overlay rect.
   * Safe no-op when `isAvailable` is false. */
  clear(): void;
  /** The projected overlay rect for the current anchor, or null. */
  activeHighlight: CitationOverlayRect | null;
  /**
   * `true` when the hook is mounted inside a ViewerProvider and can drive
   * the PDF viewer. `false` when outside a provider — highlight/clear are
   * safe no-ops and activeHighlight stays null.
   */
  isAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Internal helper: compute the target page number from any anchor kind.
// ---------------------------------------------------------------------------
function anchorPage(anchor: CitationAnchor): number {
  if (anchor.kind === 'region') return anchor.page;
  return anchor.range.page;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Inner hook that runs AFTER we know which page to load.
 * Separated so that `usePageHandle` receives a stable page number —
 * the outer hook shell drives which page that is.
 *
 * Returns null immediately when `storeApi` is null (no provider present).
 */
function useCitationHighlightInner(
  anchor: CitationAnchor | null,
  storeApi: StoreApi<ViewerState> | null,
): CitationOverlayRect | null {
  const page = anchor != null ? anchorPage(anchor) : 1;
  const pageHandle = usePageHandle(page);

  if (storeApi == null || anchor == null || pageHandle == null) return null;

  const {mode, scale} = storeApi.getState();

  // Overlay rect only applies in canvas mode (canvas surface exists).
  if (mode !== 'canvas') return null;

  if (anchor.kind === 'text') return null;

  const pageHeightPts = pageHandle.size.height;
  const cssRect = projectPdfRectToCss(anchor.rect, pageHeightPts, scale);

  return {
    page,
    ...cssRect,
  };
}

export function useCitationHighlight(): UseCitationHighlightReturn {
  const storeApi = useViewerStoreApiOptional();

  // The anchor we are currently highlighting — drives usePageHandle.
  const [activeAnchor, setActiveAnchor] = useState<CitationAnchor | null>(null);

  // Overlay rect computed reactively from the active anchor + page handle.
  const overlayRect = useCitationHighlightInner(activeAnchor, storeApi);

  const clear = useCallback((): void => {
    if (storeApi == null) return;
    const {actions} = storeApi.getState();
    actions.clearSearch();
    actions.clearCitations();
    setActiveAnchor(null);
  }, [storeApi]);

  const highlight = useCallback(
    (anchor: CitationAnchor): void => {
      if (storeApi == null) return;
      const {actions} = storeApi.getState();

      // Replace previous highlight — single active citation at a time.
      actions.clearSearch();
      actions.clearCitations();

      const page = anchorPage(anchor);
      actions.goToPage(page);

      // Text range → drive the TextLayer search-highlight system.
      if (anchor.kind === 'text' || anchor.kind === 'hybrid') {
        const quote = anchor.kind === 'text' ? (anchor.quote ?? '') : anchor.quote;
        actions.setSearchMatches([
          {
            pageNumber: anchor.range.page,
            charStart: anchor.range.charStart,
            charEnd: anchor.range.charEnd,
            context: quote,
          },
        ]);
      }

      // Put the anchor in the shared store so CitationOverlay can render it.
      // Use a stable synthetic id derived from anchor coords.
      const id = `citation-highlight-${page}`;
      actions.addCitation({id, anchor});
      actions.setActiveCitation(id);

      setActiveAnchor(anchor);
    },
    [storeApi],
  );

  return {highlight, clear, activeHighlight: overlayRect, isAvailable: storeApi != null};
}
