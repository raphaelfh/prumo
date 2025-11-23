/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * PDFPage - Componente otimizado para renderizar uma página individual
 * 
 * Usa React.memo para evitar re-renders desnecessários.
 */

import React, { useCallback, useRef, useMemo, useEffect, useState } from 'react';
import { Page } from 'react-pdf';
import type { PDFPageProxy } from 'pdfjs-dist';
import { usePDFSearchHighlight } from '@/hooks/usePDFSearchHighlight';
import { PDFSearchHighlight } from './PDFSearchHighlight';

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
  currentMatchIndex?: number; // Índice do match atual nesta página
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
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);

  // Debug: verificar se props estão chegando
  useEffect(() => {
    if (searchQuery) {
      console.debug(`[PDFPage ${pageNumber}] Props recebidas: searchQuery="${searchQuery}", isHighlighted=${isHighlighted}, currentMatchIndex=${currentMatchIndex}`);
    }
  }, [pageNumber, searchQuery, isHighlighted, currentMatchIndex]);

  // Resetar contador quando query ou página mudar
  useEffect(() => {
    matchCounterRef.current = 0;
  }, [searchQuery, pageNumber]);

  // Função para destacar texto encontrado
  const customTextRenderer = useMemo(() => {
    if (!searchQuery || !searchQuery.trim()) {
      console.debug(`[PDFPage ${pageNumber}] customTextRenderer: query vazia, retornando undefined`);
      return undefined;
    }

    console.debug(`[PDFPage ${pageNumber}] customTextRenderer criado para query: "${searchQuery}"`);

    // Criar regex para busca (case insensitive por padrão)
    const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(${escapedQuery})`, 'gi');

    return (textItem: { str: string }) => {
      const text = textItem.str;
      const parts = text.split(pattern);
      
      // Debug: verificar se está processando
      if (parts.length > 1) {
        console.debug(`[PDFPage ${pageNumber}] customTextRenderer processando texto com ${parts.length - 1} match(es)`);
      }
      
      return parts.map((part, index) => {
        // Verificar se a parte corresponde ao padrão
        // Usar matchAll para evitar problemas com lastIndex
        const matches = Array.from(part.matchAll(pattern));
        pattern.lastIndex = 0; // Resetar após cada exec
        
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

  // Hook para scroll automático quando highlight mudar
  // Este hook detecta quando os marks são renderizados e faz scroll fino
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
    // Tentar múltiplas formas de acessar o pageProxy
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
      console.debug(`[PDFPage ${pageNumber}] pageProxy definido:`, pdfPage);
      setPageProxy(pdfPage);
    } else {
      console.warn(`[PDFPage ${pageNumber}] Não foi possível obter pageProxy do objeto page:`, page);
    }
    
    if (onLoadSuccess) {
      onLoadSuccess(page);
    }
    
    if (onLoadingChange) {
      onLoadingChange(pageNumber, false);
    }
    
    // Medir altura real da página após carregar
    if (pageRef.current && onHeightMeasured) {
      // Usar requestAnimationFrame para garantir que o DOM foi atualizado
      requestAnimationFrame(() => {
        if (pageRef.current) {
          const height = pageRef.current.offsetHeight;
          onHeightMeasured(pageNumber, height);
        }
      });
    }
  }, [onLoadSuccess, onHeightMeasured, onLoadingChange, pageNumber]);

  // Forçar re-render quando searchQuery ou highlight mudar para garantir que customTextRenderer seja aplicado
  useEffect(() => {
    // Isso força o react-pdf a re-renderizar com o novo customTextRenderer
    if (searchQuery && searchQuery.trim()) {
      // Pequeno delay para garantir que o texto layer foi renderizado
      const timer = setTimeout(() => {
        // Trigger re-render se necessário
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
          key={`page-${pageNumber}-${searchQuery || 'no-search'}`} // Forçar re-render quando searchQuery mudar
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
  // Comparação customizada para evitar re-renders desnecessários
  // IMPORTANTE: Se searchQuery mudar, DEVE re-renderizar para aplicar customTextRenderer
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

