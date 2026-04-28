import {pdfjs} from 'react-pdf';
import type {LoadOptions, PDFDocumentHandle, PDFEngine} from '../../core/engine';
import type {PDFSource} from '../../core/source';
import {PdfJsDocumentHandle} from './document';
import {sourceToGetDocumentParams} from './source';
import {PDF_WORKER_SRC} from '@/lib/pdf-worker';

// Configure the PDF.js worker URL once on module load. This makes the engine
// self-sufficient — consumers do not need to import a separate config module
// to wire up the worker. Idempotent: re-assignment is harmless.
if (typeof pdfjs !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
}

class PdfJsEngineImpl implements PDFEngine {
  async load(source: PDFSource, opts?: LoadOptions): Promise<PDFDocumentHandle> {
    const params = await sourceToGetDocumentParams(source, opts);
    const task = pdfjs.getDocument(params);
    if (opts?.onProgress) {
      task.onProgress = (p: {loaded: number; total: number}) =>
        opts.onProgress?.(p.loaded, p.total);
    }
    // react-pdf bundles pdfjs-dist v5.4; top-level is v5.7. Cast through unknown
    // to bridge the nominal type gap — structurally identical at runtime.
    const proxy = await task.promise;
    return new PdfJsDocumentHandle(proxy as unknown as import('pdfjs-dist').PDFDocumentProxy);
  }

  destroy(): void {
    // No engine-level resources held outside document handles in this implementation.
    // Reserved for future per-engine worker pool cleanup.
  }
}

/** The default PDF.js engine instance. Stateless. */
export const pdfJsEngine: PDFEngine = new PdfJsEngineImpl();

// Re-export the handle classes so consumers can identify them in tests.
export {PdfJsDocumentHandle} from './document';
export {PdfJsPageHandle} from './page';
