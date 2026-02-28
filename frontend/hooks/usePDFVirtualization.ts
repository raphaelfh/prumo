/**
 * usePDFVirtualization - Hook para virtualização de páginas PDF
 * 
 * Otimiza performance detectando páginas visíveis e renderizando apenas
 * páginas no viewport + buffer usando Intersection Observer.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

interface UsePDFVirtualizationProps {
  numPages: number;
  containerRef: React.RefObject<HTMLElement>;
  buffer?: number; // Páginas antes/depois para pré-carregar
  rootMargin?: string; // Margem do Intersection Observer
}

interface VisibleRange {
  start: number;
  end: number;
}

export function usePDFVirtualization({
  numPages,
  containerRef,
  buffer = 2,
  rootMargin = '200px',
}: UsePDFVirtualizationProps) {
  const [visibleRange, setVisibleRange] = useState<VisibleRange>({ start: 1, end: 1 });
  const [pageRefs, setPageRefs] = useState<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visiblePagesRef = useRef<Set<number>>(new Set());
  // Rastrear páginas que foram renderizadas para evitar desmontar prematuramente
  const renderedPagesRef = useRef<Set<number>>(new Set());
  // Rastrear páginas que estão carregando
  const loadingPagesRef = useRef<Set<number>>(new Set());

  // Registrar referência de página
  const registerPageRef = useCallback((pageNumber: number, element: HTMLDivElement | null) => {
    if (element) {
      setPageRefs((prev) => {
        const next = new Map(prev);
        next.set(pageNumber, element);
        return next;
      });
    } else {
      setPageRefs((prev) => {
        const next = new Map(prev);
        next.delete(pageNumber);
        return next;
      });
    }
  }, []);

  // Calcular range visível com buffer, incluindo páginas em carregamento
  const calculateVisibleRange = useCallback((visiblePages: Set<number>): VisibleRange => {
    if (visiblePages.size === 0) {
      return { start: 1, end: Math.min(3, numPages) };
    }

    const pages = Array.from(visiblePages).sort((a, b) => a - b);
    let minPage = Math.max(1, pages[0] - buffer);
    let maxPage = Math.min(numPages, pages[pages.length - 1] + buffer);

    // Incluir páginas que estão carregando mesmo que fora do range
    if (loadingPagesRef.current.size > 0) {
      const loadingPages = Array.from(loadingPagesRef.current);
      const minLoading = Math.min(...loadingPages);
      const maxLoading = Math.max(...loadingPages);
      minPage = Math.min(minPage, minLoading);
      maxPage = Math.max(maxPage, maxLoading);
    }

    // Incluir páginas já renderizadas para evitar desmontar prematuramente
    if (renderedPagesRef.current.size > 0) {
      const renderedPages = Array.from(renderedPagesRef.current);
      const minRendered = Math.min(...renderedPages);
      const maxRendered = Math.max(...renderedPages);
      // Manter pelo menos 1 página de buffer das renderizadas
      minPage = Math.min(minPage, Math.max(1, minRendered - 1));
      maxPage = Math.max(maxPage, Math.min(numPages, maxRendered + 1));
    }

    return { start: minPage, end: maxPage };
  }, [numPages, buffer]);

  // Callback do Intersection Observer
  const handleIntersection = useCallback((entries: IntersectionObserverEntry[]) => {
    entries.forEach((entry) => {
      const pageNumber = parseInt(entry.target.getAttribute('data-page-number') || '0', 10);
      
      if (pageNumber <= 0) return;

      if (entry.isIntersecting) {
        visiblePagesRef.current.add(pageNumber);
      } else {
        visiblePagesRef.current.delete(pageNumber);
      }
    });

    // Atualizar range visível
    const newRange = calculateVisibleRange(visiblePagesRef.current);
    setVisibleRange((prev) => {
      // Só atualizar se realmente mudou (evitar re-renders desnecessários)
      if (prev.start !== newRange.start || prev.end !== newRange.end) {
        return newRange;
      }
      return prev;
    });
  }, [calculateVisibleRange]);

  // Configurar Intersection Observer
  useEffect(() => {
    if (!containerRef.current) return;

    // Criar observer
    observerRef.current = new IntersectionObserver(handleIntersection, {
      root: containerRef.current,
      rootMargin,
      threshold: 0.01, // Trigger quando qualquer parte da página estiver visível
    });

    // Observar todas as referências de páginas registradas
    pageRefs.forEach((element) => {
      if (element && observerRef.current) {
        observerRef.current.observe(element);
      }
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [containerRef, handleIntersection, pageRefs, rootMargin]);

  // Marcar página como renderizada
  const markPageRendered = useCallback((pageNumber: number) => {
    renderedPagesRef.current.add(pageNumber);
  }, []);

  // Marcar página como carregando
  const markPageLoading = useCallback((pageNumber: number, isLoading: boolean) => {
    if (isLoading) {
      loadingPagesRef.current.add(pageNumber);
    } else {
      loadingPagesRef.current.delete(pageNumber);
    }
  }, []);

  // Verificar se página deve ser renderizada
  const shouldRenderPage = useCallback((pageNumber: number): boolean => {
    const inRange = pageNumber >= visibleRange.start && pageNumber <= visibleRange.end;
    const isRendered = renderedPagesRef.current.has(pageNumber);
    const isLoading = loadingPagesRef.current.has(pageNumber);
    
    // Renderizar se está no range, ou se já foi renderizada (evitar desmontar), ou se está carregando
    return inRange || isRendered || isLoading;
  }, [visibleRange]);

  // Obter lista de páginas para renderizar
  const pagesToRender = useMemo(() => {
    const pages: number[] = [];
    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      if (i >= 1 && i <= numPages) {
        pages.push(i);
      }
    }
    return pages;
  }, [visibleRange, numPages]);

  // Limpar referências de páginas fora do range
  const cleanupOutOfRangePages = useCallback(() => {
    setPageRefs((prev) => {
      const next = new Map();
      for (let i = visibleRange.start; i <= visibleRange.end; i++) {
        if (prev.has(i)) {
          next.set(i, prev.get(i)!);
        }
      }
      return next;
    });
  }, [visibleRange]);

  // Inicializar com primeira página visível
  useEffect(() => {
    if (numPages > 0 && visibleRange.start === 1 && visibleRange.end === 1) {
      setVisibleRange({ start: 1, end: Math.min(1 + buffer * 2, numPages) });
    }
  }, [numPages, buffer, visibleRange]);

  return {
    visibleRange,
    shouldRenderPage,
    pagesToRender,
    registerPageRef,
    cleanupOutOfRangePages,
    markPageRendered,
    markPageLoading,
  };
}

