/**
 * PDFCanvas - Componente de renderização do canvas PDF (RESTAURADO)
 * 
 * Versão simplificada que usa os overlays originais funcionais:
 * - AnnotationOverlay.tsx
 * - TextSelectionOverlay.tsx
 * 
 * Suporta modos de visualização simples sem complexidade excessiva.
 */

import { useCallback, useState } from 'react';
import { Page } from 'react-pdf';
import { usePDFStore } from '@/stores/usePDFStore';
import { AnnotationOverlay } from '../AnnotationOverlay';
import { TextSelectionOverlay } from '../TextSelectionOverlay';

export function PDFCanvas() {
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  
  const {
    currentPage,
    scale,
    rotation,
    showAnnotations,
    ui,
    numPages,
  } = usePDFStore();
  
  const viewMode = ui?.viewMode || 'continuous';

  const handlePageLoadSuccess = useCallback((page: any) => {
    const { width, height } = page;
    setPageSize({ width, height });
  }, []);

  // Calcular dimensões com base na rotação
  const rotatedWidth = (rotation % 180 !== 0) ? pageSize.height : pageSize.width;
  const rotatedHeight = (rotation % 180 !== 0) ? pageSize.width : pageSize.height;
  const scaledWidth = rotatedWidth * scale;
  const scaledHeight = rotatedHeight * scale;

  // Renderizar página individual com overlays ORIGINAIS funcionais
  const renderPage = (pageNum: number) => (
    <div 
      key={pageNum} 
      className="relative inline-block shadow-2xl"
      style={{
        // IMPORTANTE: Sempre permitir seleção de texto
        userSelect: 'text',
        WebkitUserSelect: 'text',
        MozUserSelect: 'text',
        msUserSelect: 'text',
      }}
    >
      <Page
        pageNumber={pageNum}
        scale={scale}
        rotate={rotation}
        renderTextLayer={true}
        renderAnnotationLayer={true}
        className="bg-white"
        loading={
          <div className="w-full h-[800px] bg-muted animate-pulse rounded" />
        }
        onLoadSuccess={handlePageLoadSuccess}
      />

      {/* ORDEM IMPORTANTE: Anotações primeiro (z-10), depois texto (z-20) */}
      
      {/* Overlay de Anotações - z-10 ou z-5 (dinâmico) */}
      {showAnnotations && pageSize.width > 0 && (
        <AnnotationOverlay
          pageNumber={pageNum}
          pageWidth={scaledWidth}
          pageHeight={scaledHeight}
        />
      )}
      
      {/* Overlay de Seleção de Texto - z-20 apenas para botões */}
      {pageSize.width > 0 && (
        <TextSelectionOverlay
          pageNumber={pageNum}
          pageWidth={scaledWidth}
          pageHeight={scaledHeight}
        />
      )}
    </div>
  );

  // Modo TWO-PAGE - Máximo 2 páginas para manter performance
  if (viewMode === 'two-page' && numPages > 1) {
    const nextPage = currentPage < numPages ? currentPage + 1 : null;
    return (
      <div className="flex gap-4 items-start">
        {renderPage(currentPage)}
        {nextPage && renderPage(nextPage)}
      </div>
    );
  }

  // Todos outros modos (continuous, single): Renderizar apenas página atual
  // Isso mantém performance rápida
  return renderPage(currentPage);
}
