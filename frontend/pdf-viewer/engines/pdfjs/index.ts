import * as pdfjs from 'pdfjs-dist';
import type {PDFDocumentHandle, PDFEngine} from '../../core/engine';
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

/** The PDF.js engine. Stateless: every resource belongs to a document handle. */
export const pdfJsEngine: PDFEngine = {
  async load(source: PDFSource): Promise<PDFDocumentHandle> {
    const proxy = await pdfjs.getDocument(await sourceToGetDocumentParams(source)).promise;
    return new PdfJsDocumentHandle(proxy);
  },
};
