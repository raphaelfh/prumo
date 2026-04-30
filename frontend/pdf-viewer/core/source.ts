/**
 * Source descriptor for a PDF document.
 *
 * The viewer accepts any of these forms; resolving an article ID, a Supabase
 * signed URL, or an upload preview to one of these is the consumer's job.
 * Domain knowledge (article_files, MAIN role, Supabase Storage) does NOT
 * leak into the viewer — invariant from the architecture spec.
 */
export type PDFSource =
  | PDFUrlSource
  | PDFDataSource
  | PDFLazySource;

export interface PDFUrlSource {
  kind: 'url';
  url: string;
  withCredentials?: boolean;
  httpHeaders?: Record<string, string>;
}

export interface PDFDataSource {
  kind: 'data';
  data: Uint8Array | ArrayBuffer;
}

/**
 * A source that resolves to another source on first access.
 * Used when generating a signed URL is expensive or has a TTL —
 * the consumer keeps that work outside the viewer's render path.
 */
export interface PDFLazySource {
  kind: 'lazy';
  load: () => Promise<PDFUrlSource | PDFDataSource>;
}
