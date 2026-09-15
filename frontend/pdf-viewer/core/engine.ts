import type {PDFRect} from './coordinates';
import type {PDFSource} from './source';

/**
 * Page rotation in degrees, clockwise.
 */
export type PageRotation = 0 | 90 | 180 | 270;

/**
 * The PDF engine — abstracts the rendering library. The app ships one
 * implementation, pdfjs-dist (`engines/pdfjs`); `engines/mock` drives tests.
 */
export interface PDFEngine {
  /** Load a PDF document. The caller owns the handle and calls `destroy()` on it. */
  load(source: PDFSource): Promise<PDFDocumentHandle>;
}

export interface PDFDocumentHandle {
  readonly numPages: number;
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
  /**
   * Render a TextLayer for this page into the given container.
   * Returns a cancellable handle.
   */
  renderTextLayer(opts: TextLayerRenderOptions): Promise<TextLayerHandle>;
  /** Release page-level resources (canvas, text layer caches). Idempotent. */
  cleanup(): void;
}

export interface TextLayerRenderOptions {
  container: HTMLElement;
  scale: number;
  rotation?: PageRotation;
  signal?: AbortSignal;
}

export interface TextLayerHandle {
  /** Cancel rendering and detach resources. Idempotent. */
  cancel(): void;
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
