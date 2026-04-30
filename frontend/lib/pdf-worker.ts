/// <reference types="vite/client" />
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * Local URL of the PDF.js worker script, served by Vite.
 * Replaces the prior unpkg CDN URL — eliminates a third-party runtime dependency.
 */
export const PDF_WORKER_SRC = workerUrl;
