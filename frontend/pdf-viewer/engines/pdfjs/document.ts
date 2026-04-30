// NOTE: react-pdf bundles its own pdfjs-dist (currently v5.4) while the top-level
// pdfjs-dist in this project is v5.7. The two are structurally compatible but
// TypeScript sees them as distinct nominal types. We import types from the
// top-level package for editor tooling, and cast through unknown at the boundary.
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {
  OutlineNode,
  PDFDocumentHandle,
  PDFMetadata,
  PDFPageHandle,
} from '../../core/engine';
import {PdfJsPageHandle} from './page';

interface RawOutlineNode {
  title: string;
  dest?: unknown;
  items?: RawOutlineNode[];
}

export class PdfJsDocumentHandle implements PDFDocumentHandle {
  private destroyed = false;

  constructor(private readonly proxy: PDFDocumentProxy) {}

  get numPages(): number {
    return this.proxy.numPages;
  }

  get fingerprint(): string {
    // pdfjs-dist v5 returns array; v3 returned single string. Tolerate both.
    const fp = (this.proxy as unknown as {fingerprints?: string[]; fingerprint?: string});
    return fp.fingerprints?.[0] ?? fp.fingerprint ?? '';
  }

  async metadata(): Promise<PDFMetadata> {
    const {info} = await this.proxy.getMetadata();
    const i = info as Record<string, unknown>;
    const toDate = (v: unknown): Date | undefined => {
      if (typeof v !== 'string') return undefined;
      const d = new Date(v);
      return Number.isNaN(d.valueOf()) ? undefined : d;
    };
    return {
      title: typeof i.Title === 'string' ? i.Title : undefined,
      author: typeof i.Author === 'string' ? i.Author : undefined,
      subject: typeof i.Subject === 'string' ? i.Subject : undefined,
      keywords: typeof i.Keywords === 'string' ? i.Keywords : undefined,
      creator: typeof i.Creator === 'string' ? i.Creator : undefined,
      producer: typeof i.Producer === 'string' ? i.Producer : undefined,
      creationDate: toDate(i.CreationDate),
      modificationDate: toDate(i.ModDate),
    };
  }

  async outline(): Promise<OutlineNode[]> {
    const raw = (await this.proxy.getOutline()) as RawOutlineNode[] | null;
    if (!raw) return [];
    return Promise.all(raw.map((node) => this.mapOutlineNode(node)));
  }

  private async mapOutlineNode(node: RawOutlineNode): Promise<OutlineNode> {
    let page: number | null = null;
    try {
      if (node.dest != null) {
        const dest = typeof node.dest === 'string' ? await this.proxy.getDestination(node.dest) : node.dest;
        if (Array.isArray(dest) && dest.length > 0) {
          const pageIndex = await this.proxy.getPageIndex(dest[0]);
          page = pageIndex + 1; // 1-indexed
        }
      }
    } catch {
      // Bad outline entries shouldn't crash the whole tree
      page = null;
    }
    const children = node.items
      ? await Promise.all(node.items.map((c) => this.mapOutlineNode(c)))
      : [];
    return {title: node.title, page, children};
  }

  async getPage(pageNumber: number): Promise<PDFPageHandle> {
    const proxy = await this.proxy.getPage(pageNumber);
    return new PdfJsPageHandle(proxy, pageNumber);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    void this.proxy.destroy();
  }
}
