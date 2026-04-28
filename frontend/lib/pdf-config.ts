import {pdfjs} from 'react-pdf';
import {PDF_WORKER_SRC} from '@/lib/pdf-worker';

// Configure PDF.js worker — served locally by Vite (was unpkg CDN previously).
pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

export const PDF_OPTIONS = {
  // cMaps and standard fonts: PDF.js v5 falls back to defaults when these are
  // unset. The research-paper PDFs we ingest are Latin-script with standard
  // fonts; defaults are adequate. If non-Latin (CJK, Arabic) PDFs surface
  // missing-glyph artifacts, follow up with local cMap/font serving.

  // Security hardening for untrusted PDFs.
  // Keeps scripting/eval disabled to reduce attack surface.
  isEvalSupported: false,
  enableScripting: false,

  // Performance
  enableXfa: false,
  disableAutoFetch: false,
  disableStream: false,
  disableRange: false,

  // Memory management
  maxImageSize: 16777216,
  cacheSize: 100,
  useOnlyCssZoom: true,
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
