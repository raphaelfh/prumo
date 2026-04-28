import {pdfjs} from 'react-pdf';
import type {LoadOptions, PDFDocumentHandle, PDFEngine} from '../../core/engine';
import type {PDFSource} from '../../core/source';
import {PdfJsDocumentHandle} from './document';
import {sourceToGetDocumentParams} from './source';

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
