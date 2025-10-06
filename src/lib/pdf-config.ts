import { pdfjs } from 'react-pdf';

// Configure PDF.js worker using the version bundled with react-pdf
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export const PDF_OPTIONS = {
  cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
  // Performance optimizations
  enableXfa: false, // Disable XFA forms for better performance
  disableAutoFetch: false, // Keep auto-fetch for better UX
  disableStream: false, // Keep streaming for large files
  disableRange: false, // Keep range requests for partial loading
  // Memory management
  maxImageSize: 16777216, // 16MB max image size
  cacheSize: 100, // Cache up to 100 pages
  useOnlyCssZoom: true, // Use CSS zoom instead of canvas scaling when possible
};

// Performance settings for large PDFs
export const LARGE_PDF_THRESHOLD = 50; // Pages

// Função para obter device pixel ratio de forma lazy
const getDevicePixelRatio = (): number => {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, 2);
};

export const PERFORMANCE_CONFIG = {
  // Lazy loading settings
  preloadPages: 2, // Number of pages to preload ahead/behind
  unloadDistance: 5, // Unload pages this far from current page
  
  // Rendering settings - mais conservador para evitar OOM
  maxCanvasPixels: 8388608, // 8MP max canvas size (mais conservador)
  devicePixelRatio: getDevicePixelRatio, // Função lazy para evitar execução no módulo
  
  // Memory management - menos agressivo
  enableMemoryOptimization: true,
  gcInterval: 60000, // Garbage collection interval (60s - menos agressivo)
  
  // Novas configurações de performance
  maxConcurrentRenders: 3, // Máximo de renders simultâneos
  renderTimeout: 10000, // Timeout para renderização (10s)
  enableWebGL: true, // Usar WebGL quando disponível
  useOnlyCssZoom: false, // Permitir canvas scaling para melhor qualidade
};
