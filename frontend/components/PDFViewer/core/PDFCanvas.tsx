/**
 * PDFCanvas - PDF canvas rendering component with continuous scroll
 *
 * Implements virtualization to optimize performance with large documents.
 * Renders only visible pages + buffer using Intersection Observer.
 */

import {useCallback, useMemo, useRef, useState} from 'react';
import {usePDFStore} from '@/stores/usePDFStore';
import {usePDFVirtualization} from '@/hooks/usePDFVirtualization';
import {CONTINUOUS_SCROLL_CONFIG} from '@/lib/pdf-config';
import {PDFPage} from './PDFPage';
import {PDFPagePlaceholder} from './PDFPagePlaceholder';

export function PDFCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [actualPageHeights, setActualPageHeights] = useState<Map<number, number>>(new Map());
  
  const {
    currentPage,
    scale,
    rotation,
    ui,
    numPages,
    searchQuery,
    currentSearchIndex,
    searchResults,
  } = usePDFStore();

  const viewMode = ui?.viewMode || 'continuous';

    // Compute estimated page height from scale
  const estimatedPageHeight = useMemo(() => {
      // Base height assumed ~1100px (A4 at 100% zoom)
      // Adjust based on scale
    return CONTINUOUS_SCROLL_CONFIG.placeholderHeight * scale;
  }, [scale]);

    // Use actual height if available, otherwise estimated
  const getPageHeight = useCallback((pageNum: number): number => {
    return actualPageHeights.get(pageNum) || estimatedPageHeight;
  }, [actualPageHeights, estimatedPageHeight]);

    // Callback to update actual page height. Bails out when the measured value
    // matches what is already cached so we avoid creating a new Map identity on
    // every measure pass — that loop is what triggers React's "Maximum update
    // depth exceeded" warning when a page re-measures with the same height
    // after each parent re-render.
  const handlePageHeightMeasured = useCallback((pageNum: number, height: number) => {
    setActualPageHeights((prev) => {
      const previous = prev.get(pageNum);
      if (previous !== undefined && Math.abs(previous - height) < 0.5) {
        return prev;
      }
      const next = new Map(prev);
      next.set(pageNum, height);
      return next;
    });
  }, []);

    // Margin between pages (mb-4 = 1rem = 16px)
  const PAGE_MARGIN_BOTTOM = 16;

    // Virtualization hook for continuous scroll
  const {
    shouldRenderPage,
    registerPageRef,
    markPageRendered,
    markPageLoading,
  } = usePDFVirtualization({
    numPages,
    containerRef,
    buffer: CONTINUOUS_SCROLL_CONFIG.virtualizationBuffer,
    rootMargin: CONTINUOUS_SCROLL_CONFIG.intersectionRootMargin,
  });

  const handlePageLoadSuccess = useCallback((page: any) => {
    if (markPageRendered) {
      markPageRendered(page.pageNumber);
    }
    if (markPageLoading) {
      markPageLoading(page.pageNumber, false);
    }
  }, [markPageRendered, markPageLoading]);

    // CONTINUOUS mode - Continuous scroll with virtualization
    // Compute total height from actual heights when available
  const totalHeight = useMemo(() => {
    if (numPages === 0) return 0;
    
    let total = 0;
    for (let i = 1; i <= numPages; i++) {
      total += getPageHeight(i);
      if (i < numPages) {
        total += PAGE_MARGIN_BOTTOM;
      }
    }
    
    return total;
  }, [numPages, getPageHeight, PAGE_MARGIN_BOTTOM]);

    // TWO-PAGE mode - Max 2 pages for performance
  if (viewMode === 'two-page' && numPages > 1) {
    const nextPage = currentPage < numPages ? currentPage + 1 : null;
    return (
      <div className="flex gap-4 items-start justify-center">
        <PDFPage
          pageNumber={currentPage}
          scale={scale}
          rotation={rotation}
          onLoadSuccess={handlePageLoadSuccess}
        />
        {nextPage && (
          <PDFPage
            pageNumber={nextPage}
            scale={scale}
            rotation={rotation}
            onLoadSuccess={handlePageLoadSuccess}
          />
        )}
      </div>
    );
  }

    // SINGLE mode - Current page only
  if (viewMode === 'single') {
    return (
      <div className="flex justify-center">
        <PDFPage
          pageNumber={currentPage}
          scale={scale}
          rotation={rotation}
          onLoadSuccess={handlePageLoadSuccess}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex justify-start"
      style={{
          // Exact total height for correct scroll (no extra space at end)
        height: `${totalHeight}px`,
          minWidth: '100%', // Ensure min width for horizontal scroll when needed
      }}
    >
      <div className="flex flex-col items-center">
        {Array.from({ length: numPages }, (_, i) => {
          const pageNum = i + 1;
          const isLastPage = pageNum === numPages;
          const shouldRender = shouldRenderPage(pageNum);

            // Check if this page has current search result
          const currentPageResult = currentSearchIndex >= 0 && searchResults?.length > 0 
            ? searchResults[currentSearchIndex]
            : null;
          const isHighlighted = currentPageResult?.pageNumber === pageNum;

            // Use matchIndex from result (already the match index on the page)
          const currentMatchIndex = isHighlighted && currentPageResult 
            ? currentPageResult.matchIndex 
            : -1;

          return shouldRender ? (
            <PDFPage
              key={pageNum}
              pageNumber={pageNum}
              scale={scale}
              rotation={rotation}
              onLoadSuccess={handlePageLoadSuccess}
              onPageRef={registerPageRef}
              isLastPage={isLastPage}
              onHeightMeasured={handlePageHeightMeasured}
              onLoadingChange={markPageLoading}
              searchQuery={searchQuery || ''}
              isHighlighted={isHighlighted}
              currentMatchIndex={currentMatchIndex}
            />
          ) : (
            <PDFPagePlaceholder
              key={pageNum}
              pageNumber={pageNum}
              height={getPageHeight(pageNum)}
              onPageRef={registerPageRef}
              isLastPage={isLastPage}
            />
          );
        })}
      </div>
    </div>
  );
}
