import {pdfjs} from 'react-pdf';

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

// Lazy getter for device pixel ratio
const getDevicePixelRatio = (): number => {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, 2);
};

export const PERFORMANCE_CONFIG = {
  // Lazy loading settings
    preloadPages: 3, // Number of pages to preload ahead/behind
    unloadDistance: 7, // Unload pages this far from current page (for continuous scroll)

    // Rendering settings - conservative to avoid OOM
    maxCanvasPixels: 8388608, // 8MP max canvas size
    devicePixelRatio: getDevicePixelRatio, // Lazy function to avoid execution at module load

    // Memory management - less aggressive
  enableMemoryOptimization: true,
    gcInterval: 60000, // Garbage collection interval (60s)

    // Performance settings
    maxConcurrentRenders: 3, // Max concurrent renders
    renderTimeout: 10000, // Render timeout (10s)
    enableWebGL: true, // Use WebGL when available
    useOnlyCssZoom: false, // Allow canvas scaling for better quality
};

// Settings for continuous scroll
export const CONTINUOUS_SCROLL_CONFIG = {
    virtualizationBuffer: 2, // Pages before/after visible to preload
    scrollThrottle: 100, // ms - throttle for scroll events
    intersectionRootMargin: '200px', // Intersection Observer margin
    placeholderHeight: 1100, // px - estimated page height (adjust based on scale)
};
