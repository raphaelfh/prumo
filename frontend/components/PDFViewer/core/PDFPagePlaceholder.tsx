/**
 * PDFPagePlaceholder - Placeholder for unrendered pages
 *
 * Keeps estimated height for correct scroll without rendering the page.
 */

import React from 'react';

interface PDFPagePlaceholderProps {
  pageNumber: number;
  height: number;
  onPageRef?: (pageNumber: number, element: HTMLDivElement | null) => void;
  isLastPage?: boolean;
}

export const PDFPagePlaceholder = React.memo<PDFPagePlaceholderProps>(({
  pageNumber,
  height,
  onPageRef,
  isLastPage = false,
}) => {
  const handleRef = React.useCallback((node: HTMLDivElement | null) => {
    if (onPageRef) {
      onPageRef(pageNumber, node);
    }
  }, [pageNumber, onPageRef]);

  return (
    <div
      ref={handleRef}
      data-page-number={pageNumber}
      className={`relative ${isLastPage ? '' : 'mb-4'} flex items-center justify-center bg-muted/30 border border-dashed border-border rounded`}
      style={{ height: `${height}px` }}
    >
      <span className="text-sm text-muted-foreground">
        Page {pageNumber}
      </span>
    </div>
  );
});

PDFPagePlaceholder.displayName = 'PDFPagePlaceholder';

