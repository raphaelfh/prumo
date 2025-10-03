import { useEffect, useRef, useCallback } from 'react';
import { LARGE_PDF_THRESHOLD, PERFORMANCE_CONFIG } from '@/lib/pdf-config';

interface UsePDFPerformanceProps {
  numPages: number;
  currentPage: number;
  scale: number;
}

export function usePDFPerformance({ numPages, currentPage, scale }: UsePDFPerformanceProps) {
  const gcIntervalRef = useRef<NodeJS.Timeout>();
  const isLargePDF = numPages > LARGE_PDF_THRESHOLD;

  // Garbage collection para PDFs grandes
  const performGarbageCollection = useCallback(() => {
    if (!PERFORMANCE_CONFIG.enableMemoryOptimization) return;

    // Forçar garbage collection se disponível (apenas em desenvolvimento)
    if (typeof window !== 'undefined' && 'gc' in window && typeof (window as any).gc === 'function') {
      try {
        (window as any).gc();
      } catch (e) {
        // Silently fail - gc might not be available
      }
    }

    // Limpar canvas não utilizados
    const canvases = document.querySelectorAll('canvas[data-page-number]');
    canvases.forEach((canvas) => {
      const pageNum = parseInt((canvas as HTMLCanvasElement).dataset.pageNumber || '0');
      const distance = Math.abs(pageNum - currentPage);
      
      if (distance > PERFORMANCE_CONFIG.unloadDistance) {
        const ctx = (canvas as HTMLCanvasElement).getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    });
  }, [currentPage]);

  // Configurar intervalo de limpeza para PDFs grandes
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

  // Otimizar renderização baseada no zoom
  const getOptimizedRenderingProps = useCallback(() => {
    const devicePixelRatio = PERFORMANCE_CONFIG.devicePixelRatio;
    
    // Para zoom muito alto, limitar a resolução para evitar problemas de memória
    const effectiveScale = Math.min(scale, 3.0);
    const canvasScale = Math.min(effectiveScale * devicePixelRatio, 4.0);

    return {
      scale: effectiveScale,
      canvasBackground: 'white',
      // Usar CSS transform para zoom adicional se necessário
      transform: scale > effectiveScale ? `scale(${scale / effectiveScale})` : undefined,
      transformOrigin: 'top left',
    };
  }, [scale]);

  // Calcular páginas para pré-carregamento
  const getPagesToPreload = useCallback(() => {
    const { preloadPages } = PERFORMANCE_CONFIG;
    const pages: number[] = [];
    
    // Página atual sempre incluída
    pages.push(currentPage);
    
    // Páginas anteriores e posteriores
    for (let i = 1; i <= preloadPages; i++) {
      if (currentPage - i >= 1) {
        pages.push(currentPage - i);
      }
      if (currentPage + i <= numPages) {
        pages.push(currentPage + i);
      }
    }
    
    return pages.sort((a, b) => a - b);
  }, [currentPage, numPages]);

  // Verificar se uma página deve ser renderizada
  const shouldRenderPage = useCallback((pageNumber: number) => {
    if (!isLargePDF) return true;
    
    const distance = Math.abs(pageNumber - currentPage);
    return distance <= PERFORMANCE_CONFIG.preloadPages;
  }, [currentPage, isLargePDF]);

  // Obter configurações de renderização otimizadas
  const getRenderingConfig = useCallback(() => {
    return {
      // Limitar resolução para PDFs grandes
      devicePixelRatio: isLargePDF ? 
        Math.min(PERFORMANCE_CONFIG.devicePixelRatio, 1.5) : 
        PERFORMANCE_CONFIG.devicePixelRatio,
      
      // Configurações de canvas
      willReadFrequently: false, // Otimização para canvas que não são lidos frequentemente
      alpha: false, // Desabilitar canal alpha se não necessário
      
      // Configurações de renderização
      renderTextLayer: true, // Manter para seleção de texto
      renderAnnotationLayer: false, // Desabilitar - usamos overlay customizado
      
      // Configurações de performance
      enableWebGL: true, // Usar WebGL se disponível
      useOnlyCssZoom: scale > 2.0, // Usar CSS zoom para escalas altas
    };
  }, [isLargePDF, scale]);

  // Monitorar uso de memória (se disponível)
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

  // Cleanup ao desmontar
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
