import type {PDFRect} from './coordinates';
import type {PDFSource} from './source';

/**
 * Page rotation in degrees, clockwise.
 */
export type PageRotation = 0 | 90 | 180 | 270;

/**
 * The PDF engine — abstracts the underlying rendering library.
 *
 * Phase 1b implements this against pdfjs-dist v5. A future plan may
 * implement it against PDFium-WASM (EmbedPDF or similar). Consumers
 * never see the underlying library directly.
 */
export interface PDFEngine {
  /**
   * Load a PDF document. Returns a handle whose lifecycle is owned by
   * the caller — call `destroy()` on the handle when no longer needed.
   */
  load(source: PDFSource, opts?: LoadOptions): Promise<PDFDocumentHandle>;

  /**
   * Release engine-level resources (e.g., PDF.js worker threads).
   * Outstanding document handles are NOT destroyed implicitly — the
   * caller is responsible for destroying handles before destroying
   * the engine. Idempotent.
   */
  destroy(): void;
}

export interface LoadOptions {
  withCredentials?: boolean;
  httpHeaders?: Record<string, string>;
  onProgress?: (loaded: number, total: number) => void;
}

export interface PDFDocumentHandle {
  readonly numPages: number;
  /** Stable identifier from the PDF — useful for cache keys. */
  readonly fingerprint: string;
  metadata(): Promise<PDFMetadata>;
  outline(): Promise<OutlineNode[]>;
  getPage(pageNumber: number): Promise<PDFPageHandle>;
  /** Release engine resources. Idempotent. */
  destroy(): void;
}

export interface PDFPageHandle {
  readonly pageNumber: number;
  /** Page size in PDF user space points (origin bottom-left). */
  readonly size: {width: number; height: number};
  render(opts: RenderOptions): Promise<RenderResult>;
  getTextContent(): Promise<TextContent>;
  /** Release page-level resources (canvas, text layer caches). Idempotent. */
  cleanup(): void;
}

export interface RenderOptions {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  scale: number;
  rotation?: PageRotation;
  signal?: AbortSignal;
}

export interface RenderResult {
  /** Rendered pixel width. */
  width: number;
  /** Rendered pixel height. */
  height: number;
}

export interface PDFMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
}

export interface OutlineNode {
  title: string;
  /** Target page (1-indexed) or null if the entry has no destination. */
  page: number | null;
  children: OutlineNode[];
}

export interface TextContent {
  items: TextItem[];
}

export interface TextItem {
  text: string;
  /** Bounding box in PDF user space. */
  bbox: PDFRect;
  /** Offset of the first character within the page's concatenated text. */
  charStart: number;
  /** Offset of the character after the last character (exclusive). */
  charEnd: number;
}
