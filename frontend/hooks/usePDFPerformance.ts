import {useCallback, useEffect, useRef} from 'react';
import {LARGE_PDF_THRESHOLD, PERFORMANCE_CONFIG} from '@/lib/pdf-config';

interface UsePDFPerformanceProps {
  numPages: number;
  currentPage: number;
  scale: number;
}

export function usePDFPerformance({ numPages, currentPage, scale }: UsePDFPerformanceProps) {
  const gcIntervalRef = useRef<NodeJS.Timeout>();
  const isLargePDF = numPages > LARGE_PDF_THRESHOLD;

    // Garbage collection for large PDFs
  const performGarbageCollection = useCallback(() => {
    if (!PERFORMANCE_CONFIG.enableMemoryOptimization) return;

      // Force garbage collection if available (development only)
    if (typeof window !== 'undefined' && 'gc' in window && typeof (window as any).gc === 'function') {
      try {
        (window as any).gc();
      } catch (e) {
        // Silently fail - gc might not be available
      }
    }

      // Clear unused canvases (optimized for continuous scroll)
    const canvases = document.querySelectorAll('canvas[data-page-number]');
    canvases.forEach((canvas) => {
      const pageNum = parseInt((canvas as HTMLCanvasElement).dataset.pageNumber || '0');
      const distance = Math.abs(pageNum - currentPage);

        // Increased unloadDistance for continuous scroll
      const unloadThreshold = PERFORMANCE_CONFIG.unloadDistance + 2;
      if (distance > unloadThreshold) {
        const ctx = (canvas as HTMLCanvasElement).getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    });
  }, [currentPage]);

    // Set up cleanup interval for large PDFs
  useEffect(() => {
    if (!isLargePDF || !PERFORMANCE_CONFIG.enableMemoryOptimization) return;

    gcIntervalRef.current = setInterval(
      performGarbageCollection,
      PERFORMANCE_CONFIG.gcInterval
    );

    return () => {
      if (gcIntervalRef.current) {
        clearInterval(gcIntervalRef.current);
      }
    };
  }, [isLargePDF, performGarbageCollection]);

    // Optimize rendering based on zoom
  const getOptimizedRenderingProps = useCallback(() => {
    const devicePixelRatio = PERFORMANCE_CONFIG.devicePixelRatio;

      // For very high zoom, limit resolution to avoid memory issues
    const effectiveScale = Math.min(scale, 3.0);
    const canvasScale = Math.min(effectiveScale * devicePixelRatio, 4.0);

    return {
      scale: effectiveScale,
      canvasBackground: 'white',
        // Use CSS transform for additional zoom if needed
      transform: scale > effectiveScale ? `scale(${scale / effectiveScale})` : undefined,
      transformOrigin: 'top left',
    };
  }, [scale]);

    // Compute pages to preload (optimized for continuous scroll)
  const getPagesToPreload = useCallback(() => {
    const { preloadPages } = PERFORMANCE_CONFIG;
    const pages: number[] = [];

      // Current page always included
    pages.push(currentPage);

      // Previous and next pages (increased for continuous scroll)
    const buffer = isLargePDF ? preloadPages + 1 : preloadPages;
    for (let i = 1; i <= buffer; i++) {
      if (currentPage - i >= 1) {
        pages.push(currentPage - i);
      }
      if (currentPage + i <= numPages) {
        pages.push(currentPage + i);
      }
    }
    
    return pages.sort((a, b) => a - b);
  }, [currentPage, numPages, isLargePDF]);

    // Check if a page should be rendered
    // Note: For continuous scroll, use usePDFVirtualization instead of this
  const shouldRenderPage = useCallback((pageNumber: number) => {
    if (!isLargePDF) return true;
    
    const distance = Math.abs(pageNumber - currentPage);
      // Increased for continuous scroll (use virtualization for better performance)
    return distance <= PERFORMANCE_CONFIG.preloadPages + 1;
  }, [currentPage, isLargePDF]);

    // Get optimized rendering config
  const getRenderingConfig = useCallback(() => {
    return {
        // Limit resolution for large PDFs
      devicePixelRatio: isLargePDF ? 
        Math.min(PERFORMANCE_CONFIG.devicePixelRatio, 1.5) : 
        PERFORMANCE_CONFIG.devicePixelRatio,

        // Canvas settings
        willReadFrequently: false, // Optimization for canvases not read frequently
        alpha: false, // Disable alpha channel if not needed

        // Rendering settings
        renderTextLayer: true, // Keep for text selection
        renderAnnotationLayer: false, // Disabled - we use custom overlay

        // Performance settings
        enableWebGL: true, // Use WebGL if available
        useOnlyCssZoom: scale > 2.0, // Use CSS zoom for high scales
    };
  }, [isLargePDF, scale]);

    // Monitor memory usage (if available)
  const getMemoryUsage = useCallback(() => {
    if ('memory' in performance && (performance as any).memory) {
      const memory = (performance as any).memory;
      return {
        used: Math.round(memory.usedJSHeapSize / 1024 / 1024), // MB
        total: Math.round(memory.totalJSHeapSize / 1024 / 1024), // MB
        limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024), // MB
      };
    }
    return null;
  }, []);

    // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gcIntervalRef.current) {
        clearInterval(gcIntervalRef.current);
      }
    };
  }, []);

  return {
    isLargePDF,
    getOptimizedRenderingProps,
    getPagesToPreload,
    shouldRenderPage,
    getRenderingConfig,
    getMemoryUsage,
    performGarbageCollection,
  };
}
