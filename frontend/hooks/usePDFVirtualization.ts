/**
 * usePDFVirtualization - Hook for PDF page virtualization
 *
 * Optimizes performance by detecting visible pages and rendering only
 * viewport + buffer pages using Intersection Observer.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

interface UsePDFVirtualizationProps {
  numPages: number;
  containerRef: React.RefObject<HTMLElement>;
    buffer?: number; // Pages before/after to preload
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
    // Track pages that were rendered to avoid unmounting prematurely
  const renderedPagesRef = useRef<Set<number>>(new Set());
    // Track pages that are loading
  const loadingPagesRef = useRef<Set<number>>(new Set());

    // Register page ref
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

    // Calculate visible range with buffer, including loading pages
  const calculateVisibleRange = useCallback((visiblePages: Set<number>): VisibleRange => {
    if (visiblePages.size === 0) {
      return { start: 1, end: Math.min(3, numPages) };
    }

    const pages = Array.from(visiblePages).sort((a, b) => a - b);
    let minPage = Math.max(1, pages[0] - buffer);
    let maxPage = Math.min(numPages, pages[pages.length - 1] + buffer);

      // Include pages that are loading even if outside range
    if (loadingPagesRef.current.size > 0) {
      const loadingPages = Array.from(loadingPagesRef.current);
      const minLoading = Math.min(...loadingPages);
      const maxLoading = Math.max(...loadingPages);
      minPage = Math.min(minPage, minLoading);
      maxPage = Math.max(maxPage, maxLoading);
    }

      // Include already rendered pages to avoid unmounting prematurely
    if (renderedPagesRef.current.size > 0) {
      const renderedPages = Array.from(renderedPagesRef.current);
      const minRendered = Math.min(...renderedPages);
      const maxRendered = Math.max(...renderedPages);
        // Keep at least 1 page buffer of rendered pages
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

      // Update visible range
    const newRange = calculateVisibleRange(visiblePagesRef.current);
    setVisibleRange((prev) => {
        // Only update if actually changed (avoid unnecessary re-renders)
      if (prev.start !== newRange.start || prev.end !== newRange.end) {
        return newRange;
      }
      return prev;
    });
  }, [calculateVisibleRange]);

  // Create the IntersectionObserver once per container/rootMargin/handler
  // identity. Observing newly-registered page refs is handled by a separate
  // effect below so we don't tear down + recreate the observer on every
  // pageRefs mutation — that recreation is what produced the "Maximum update
  // depth exceeded" loop because PDFPage re-mounts caused setPageRefs which
  // re-fired this effect synchronously.
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new IntersectionObserver(handleIntersection, {
      root: containerRef.current,
      rootMargin,
      threshold: 0.01,
    });
    observerRef.current = observer;

    return () => {
      observer.disconnect();
      if (observerRef.current === observer) {
        observerRef.current = null;
      }
    };
  }, [containerRef, handleIntersection, rootMargin]);

  // Observe newly-registered page refs. When pageRefs changes we (re-)observe
  // every entry; the observer itself is reused and IntersectionObserver
  // tolerates being asked to observe the same element twice.
  useEffect(() => {
    const observer = observerRef.current;
    if (!observer) return;
    pageRefs.forEach((element) => {
      if (element) {
        observer.observe(element);
      }
    });
    return () => {
      pageRefs.forEach((element) => {
        if (element) {
          observer.unobserve(element);
        }
      });
    };
  }, [pageRefs]);

    // Mark page as rendered
  const markPageRendered = useCallback((pageNumber: number) => {
    renderedPagesRef.current.add(pageNumber);
  }, []);

    // Mark page as loading
  const markPageLoading = useCallback((pageNumber: number, isLoading: boolean) => {
    if (isLoading) {
      loadingPagesRef.current.add(pageNumber);
    } else {
      loadingPagesRef.current.delete(pageNumber);
    }
  }, []);

    // Check if page should be rendered
  const shouldRenderPage = useCallback((pageNumber: number): boolean => {
    const inRange = pageNumber >= visibleRange.start && pageNumber <= visibleRange.end;
    const isRendered = renderedPagesRef.current.has(pageNumber);
    const isLoading = loadingPagesRef.current.has(pageNumber);

      // Render if in range, or already rendered (avoid unmount), or loading
    return inRange || isRendered || isLoading;
  }, [visibleRange]);

    // Get list of pages to render
  const pagesToRender = useMemo(() => {
    const pages: number[] = [];
    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      if (i >= 1 && i <= numPages) {
        pages.push(i);
      }
    }
    return pages;
  }, [visibleRange, numPages]);

    // Clean up page refs outside range
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

    // Initialize with first page visible
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

