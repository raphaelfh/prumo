/**
 * PDFPage - Optimized component to render a single page
 *
 * Uses React.memo to avoid unnecessary re-renders.
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Page} from 'react-pdf';
import type {PDFPageProxy} from 'pdfjs-dist';
import {usePDFSearchHighlight} from '@/hooks/usePDFSearchHighlight';
import {PDFSearchHighlight} from './PDFSearchHighlight';

interface PDFPageProps {
  pageNumber: number;
  scale: number;
  rotation: number;
  onLoadSuccess?: (page: any) => void;
  onPageRef?: (pageNumber: number, element: HTMLDivElement | null) => void;
  isLastPage?: boolean;
  onHeightMeasured?: (pageNumber: number, height: number) => void;
  onLoadingChange?: (pageNumber: number, isLoading: boolean) => void;
  searchQuery?: string;
  isHighlighted?: boolean;
    currentMatchIndex?: number; // Index of current match on this page
}

export const PDFPage = React.memo<PDFPageProps>(({
  pageNumber,
  scale,
  rotation,
  onLoadSuccess,
  onPageRef,
  isLastPage = false,
  onHeightMeasured,
  onLoadingChange,
  searchQuery = '',
  isHighlighted = false,
  currentMatchIndex = -1,
}) => {
  const pageRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(true);
  const matchCounterRef = useRef(0);
  const lastEmittedHeightRef = useRef<number | null>(null);
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);

    // Reset counter when query or page changes
  useEffect(() => {
    matchCounterRef.current = 0;
  }, [searchQuery, pageNumber]);

    // Function to highlight found text
  const customTextRenderer = useMemo(() => {
    if (!searchQuery || !searchQuery.trim()) {
      return undefined;
    }

      // Create regex for search (case insensitive by default)
    const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(${escapedQuery})`, 'gi');

    return (textItem: { str: string }) => {
      const text = textItem.str;
      const parts = text.split(pattern);

      return parts.map((part, index) => {
          // Check if part matches pattern
        // Usar matchAll para evitar problemas com lastIndex
        const matches = Array.from(part.matchAll(pattern));
          pattern.lastIndex = 0; // Reset after each exec
        
        if (matches.length > 0 && matches[0][0] === part) {
          const matchIndex = matchCounterRef.current++;
          const isCurrentMatch = isHighlighted && matchIndex === currentMatchIndex;
          
          return (
            <mark
              key={index}
              className={`${isCurrentMatch ? 'bg-yellow-300/35' : 'bg-yellow-300/25'} text-black px-0.5 rounded transition-colors`}
              data-search-match="true"
              data-page-number={pageNumber}
              data-match-index={matchIndex}
            >
              {part}
            </mark>
          );
        }
        return <span key={index}>{part}</span>;
      });
    };
  }, [searchQuery, pageNumber, isHighlighted, currentMatchIndex]);

    // Hook for auto scroll when highlight changes
    // Detects when marks are rendered and does fine scroll
  usePDFSearchHighlight({
    pageNumber,
    searchQuery,
    currentMatchIndex,
    isHighlighted,
  });

  // Marcar como carregando quando componente monta
  React.useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(pageNumber, true);
      isLoadingRef.current = true;
    }
    return () => {
      if (onLoadingChange && isLoadingRef.current) {
        onLoadingChange(pageNumber, false);
      }
    };
  }, [pageNumber, onLoadingChange]);

  const handlePageRef = useCallback((node: HTMLDivElement | null) => {
    pageRef.current = node;
    if (onPageRef) {
      onPageRef(pageNumber, node);
    }
  }, [pageNumber, onPageRef]);

  const handleLoadSuccess = useCallback((page: any) => {
    isLoadingRef.current = false;
    
    // Guardar pageProxy para usar no overlay de highlights
      // Try multiple ways to access pageProxy
    let pdfPage = null;
    if (page?._pdfPage) {
      pdfPage = page._pdfPage;
    } else if (page?.__pdfPage) {
      pdfPage = page.__pdfPage;
    } else if (page?.page) {
      pdfPage = page.page;
    } else if (page) {
      // Último recurso: tentar usar o objeto diretamente se for um PDFPageProxy
      pdfPage = page;
    }
    
    if (pdfPage) {
      setPageProxy(pdfPage);
    }
    
    if (onLoadSuccess) {
      onLoadSuccess(page);
    }
    
    if (onLoadingChange) {
      onLoadingChange(pageNumber, false);
    }

      // Measure actual page height after load. We record the last height we
      // emitted so successive loads (e.g. after a search re-render) don't
      // re-emit the same value and trigger React's "Maximum update depth"
      // warning when the parent's measurement Map keeps invalidating.
    if (pageRef.current && onHeightMeasured) {
      requestAnimationFrame(() => {
        if (!pageRef.current) return;
        const height = Math.round(pageRef.current.offsetHeight);
        if (lastEmittedHeightRef.current === height) return;
        lastEmittedHeightRef.current = height;
        onHeightMeasured(pageNumber, height);
      });
    }
  }, [onLoadSuccess, onHeightMeasured, onLoadingChange, pageNumber]);

    // Force re-render when searchQuery or highlight changes so customTextRenderer is applied
  useEffect(() => {
      // This forces react-pdf to re-render with the new customTextRenderer
    if (searchQuery && searchQuery.trim()) {
      // Pequeno delay para garantir que o texto layer foi renderizado
      const timer = setTimeout(() => {
          // Trigger re-render if needed
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [searchQuery, isHighlighted, currentMatchIndex]);

  return (
    <div
      ref={handlePageRef}
      data-page-number={pageNumber}
      className={`relative inline-block shadow-2xl ${isLastPage ? '' : 'mb-4'}`}
      style={{
        userSelect: 'text',
        WebkitUserSelect: 'text',
        MozUserSelect: 'text',
        msUserSelect: 'text',
      }}
    >
      <div className="relative">
        <Page
            key={`page-${pageNumber}-${searchQuery || 'no-search'}`} // Force re-render when searchQuery changes
          pageNumber={pageNumber}
          scale={scale}
          rotate={rotation}
          renderTextLayer={true}
          renderAnnotationLayer={true}
          customTextRenderer={customTextRenderer}
          className="bg-white"
          loading={
            <div className="w-full h-[800px] bg-muted animate-pulse rounded" />
          }
          onLoadSuccess={handleLoadSuccess}
        />
        {/* Overlay de highlights usando coordenadas do PDF - deve ficar sobre o texto */}
        {searchQuery && searchQuery.trim() && pageProxy && (
          <PDFSearchHighlight
            pageNumber={pageNumber}
            pageProxy={pageProxy}
            searchQuery={searchQuery}
            scale={scale}
            rotation={rotation}
            currentMatchIndex={currentMatchIndex}
            isHighlighted={isHighlighted}
          />
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
    // Custom comparison to avoid unnecessary re-renders
    // IMPORTANT: If searchQuery changes, MUST re-render to apply customTextRenderer
  const shouldUpdate = 
    prevProps.pageNumber !== nextProps.pageNumber ||
    prevProps.scale !== nextProps.scale ||
    prevProps.rotation !== nextProps.rotation ||
    prevProps.isLastPage !== nextProps.isLastPage ||
    prevProps.searchQuery !== nextProps.searchQuery ||
    prevProps.isHighlighted !== nextProps.isHighlighted ||
    prevProps.currentMatchIndex !== nextProps.currentMatchIndex;
  
  return !shouldUpdate; // Retorna true se NÃO deve atualizar (memo)
});

PDFPage.displayName = 'PDFPage';

