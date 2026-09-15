import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PDFDocumentHandle, PDFPageHandle} from '../../core/engine';
import {PdfJsPageHandle} from './page';

export class PdfJsDocumentHandle implements PDFDocumentHandle {
  private destroyed = false;

  constructor(private readonly proxy: PDFDocumentProxy) {}

  get numPages(): number {
    return this.proxy.numPages;
  }

  async getPage(pageNumber: number): Promise<PDFPageHandle> {
    const proxy = await this.proxy.getPage(pageNumber);
    return new PdfJsPageHandle(proxy, pageNumber);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // pdfjs-dist v6 removed PDFDocumentProxy.destroy() (it was an alias);
    // loadingTask.destroy() has the same semantics and also stops the worker.
    void this.proxy.loadingTask.destroy();
  }
}
