/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * PDFCanvas - Componente de renderização do canvas PDF com scroll contínuo
 * 
 * Implementa virtualização para otimizar performance com documentos grandes.
 * Renderiza apenas páginas visíveis + buffer usando Intersection Observer.
 */

import { useCallback, useRef, useMemo, useState, useEffect } from 'react';
import { usePDFStore } from '@/stores/usePDFStore';
import { usePDFVirtualization } from '@/hooks/usePDFVirtualization';
import { CONTINUOUS_SCROLL_CONFIG } from '@/lib/pdf-config';
import { PDFPage } from './PDFPage';
import { PDFPagePlaceholder } from './PDFPagePlaceholder';

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

  // Debug: verificar se searchQuery está no store
  useEffect(() => {
    if (searchQuery) {
      console.debug(`[PDFCanvas] searchQuery no store: "${searchQuery}", ${searchResults?.length || 0} resultados`);
    }
  }, [searchQuery, searchResults]);
  
  const viewMode = ui?.viewMode || 'continuous';

  // Calcular altura estimada da página baseada no scale
  const estimatedPageHeight = useMemo(() => {
    // Altura base assumida de ~1100px (A4 em 100% zoom)
    // Ajustar baseado no scale
    return CONTINUOUS_SCROLL_CONFIG.placeholderHeight * scale;
  }, [scale]);

  // Usar altura real se disponível, senão usar estimada
  const getPageHeight = useCallback((pageNum: number): number => {
    return actualPageHeights.get(pageNum) || estimatedPageHeight;
  }, [actualPageHeights, estimatedPageHeight]);

  // Callback para atualizar altura real da página
  const handlePageHeightMeasured = useCallback((pageNum: number, height: number) => {
    setActualPageHeights((prev) => {
      const next = new Map(prev);
      next.set(pageNum, height);
      return next;
    });
  }, []);

  // Margem entre páginas (mb-4 = 1rem = 16px)
  const PAGE_MARGIN_BOTTOM = 16;

  // Hook de virtualização para scroll contínuo
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
    // Page loaded successfully - pode ser usado para métricas futuras
    console.debug('Page loaded:', page.pageNumber);
    // Marcar página como renderizada e não mais carregando
    if (markPageRendered) {
      markPageRendered(page.pageNumber);
    }
    if (markPageLoading) {
      markPageLoading(page.pageNumber, false);
    }
  }, [markPageRendered, markPageLoading]);

  // Modo CONTINUOUS - Scroll contínuo com virtualização
  // Calcular altura total baseada em alturas reais quando disponíveis
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

  // Modo TWO-PAGE - Máximo 2 páginas para manter performance
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

  // Modo SINGLE - Apenas página atual
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
        // Altura total exata para scroll correto (sem espaço extra no final)
        height: `${totalHeight}px`,
        minWidth: '100%', // Garantir largura mínima para permitir scroll horizontal quando necessário
      }}
    >
      <div className="flex flex-col items-center">
        {Array.from({ length: numPages }, (_, i) => {
          const pageNum = i + 1;
          const isLastPage = pageNum === numPages;
          const shouldRender = shouldRenderPage(pageNum);

          // Verificar se esta página tem resultado de busca atual
          const currentPageResult = currentSearchIndex >= 0 && searchResults?.length > 0 
            ? searchResults[currentSearchIndex]
            : null;
          const isHighlighted = currentPageResult?.pageNumber === pageNum;
          
          // Usar matchIndex diretamente do resultado (já é o índice do match na página)
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
