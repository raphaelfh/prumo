/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * PDFPagePlaceholder - Placeholder para páginas não renderizadas
 * 
 * Mantém altura estimada para scroll correto sem renderizar a página.
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
        Página {pageNumber}
      </span>
    </div>
  );
});

PDFPagePlaceholder.displayName = 'PDFPagePlaceholder';

