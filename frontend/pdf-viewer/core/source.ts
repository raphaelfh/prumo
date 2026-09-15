/**
 * Source descriptor for a PDF document.
 *
 * Resolving an article or a Supabase signed URL to one of these is the
 * consumer's job. Domain knowledge (article_files, MAIN role, Supabase
 * Storage) does NOT leak into the viewer — invariant from the architecture spec.
 */
export type PDFSource = PDFUrlSource | PDFDataSource | PDFLazySource;

export interface PDFUrlSource {
  kind: 'url';
  url: string;
}

/**
 * Raw PDF bytes. No production caller: it lets tests drive the real pdf.js
 * engine with fixture bytes (under jsdom, pdf.js cannot read file:// URLs —
 * Node Buffers fail its cross-realm `instanceof Uint8Array`).
 */
interface PDFDataSource {
  kind: 'data';
  data: Uint8Array | ArrayBuffer;
}

/**
 * A source that resolves to a URL source on first access.
 * Used when generating a signed URL is expensive or has a TTL —
 * the consumer keeps that work outside the viewer's render path.
 */
export interface PDFLazySource {
  kind: 'lazy';
  load: () => Promise<PDFUrlSource | PDFDataSource>;
}
