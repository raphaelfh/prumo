import * as pdfjs from 'pdfjs-dist';
import type {LoadOptions, PDFDocumentHandle, PDFEngine} from '../../core/engine';
import type {PDFSource} from '../../core/source';
import {PdfJsDocumentHandle} from './document';
import {sourceToGetDocumentParams} from './source';
import {PDF_WORKER_SRC} from '@/lib/pdf-worker';

// Configure the PDF.js worker URL once on module load. The engine pulls
// pdfjs directly from `pdfjs-dist` (not from `react-pdf`, which would bundle
// a nested duplicate copy at a different version and force the worker URL
// onto the wrong module instance).
if (typeof pdfjs !== 'undefined') {
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
    const proxy = await task.promise;
    return new PdfJsDocumentHandle(proxy);
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
