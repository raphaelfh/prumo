/**
 * Mock PDF engine for unit tests and Storybook.
 *
 * Configurable in-memory engine that satisfies the `PDFEngine` contract
 * without touching pdfjs-dist or any worker. Use it to drive components
 * (Toolbar, NavigationControls, ZoomControls, etc.) in tests where the
 * real PDF rendering would be heavy or jsdom-incompatible.
 *
 * Usage:
 *
 * ```ts
 * import {createMockEngine} from '@prumo/pdf-viewer/engines/mock';
 * const engine = createMockEngine({
 *   numPages: 3,
 *   pageSize: {width: 612, height: 792},
 *   text: ['First page', 'Second page', 'Third page'],
 * });
 * ```
 *
 * The returned engine returns a `PDFDocumentHandle` whose `getPage()`
 * resolves with a `PDFPageHandle` whose `render()` and `renderTextLayer()`
 * are no-ops returning the configured size. `getTextContent()` returns
 * one TextItem per page covering the whole page bbox.
 */

import type {
  LoadOptions,
  PDFDocumentHandle,
  PDFEngine,
  PDFMetadata,
  PDFPageHandle,
  RenderOptions,
  RenderResult,
  TextContent,
  TextLayerHandle,
  TextLayerRenderOptions,
  OutlineNode,
} from '../../core/engine';
import type {PDFSource} from '../../core/source';

export interface MockEngineConfig {
  numPages?: number;
  fingerprint?: string;
  pageSize?: {width: number; height: number};
  /** One string per page — used by getTextContent and to size text bboxes. */
  text?: readonly string[];
  metadata?: PDFMetadata;
  outline?: OutlineNode[];
  /**
   * Hook called every time `render()` is invoked. Tests can use it to
   * assert how many times each page was rendered, or to simulate a
   * cancellation by throwing.
   */
  onRender?: (pageNumber: number, opts: RenderOptions) => void;
  /**
   * Hook called every time `renderTextLayer()` is invoked.
   */
  onRenderTextLayer?: (
    pageNumber: number,
    opts: TextLayerRenderOptions,
  ) => void;
}

class MockPageHandle implements PDFPageHandle {
  readonly pageNumber: number;
  readonly size: {width: number; height: number};
  private readonly text: string;
  private readonly cfg: MockEngineConfig;
  private cleaned = false;

  constructor(pageNumber: number, text: string, cfg: MockEngineConfig) {
    this.pageNumber = pageNumber;
    this.text = text;
    this.cfg = cfg;
    this.size = cfg.pageSize ?? {width: 612, height: 792};
  }

  async render(opts: RenderOptions): Promise<RenderResult> {
    this.cfg.onRender?.(this.pageNumber, opts);
    if (opts.signal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    const w = Math.floor(this.size.width * opts.scale);
    const h = Math.floor(this.size.height * opts.scale);
    if (opts.canvas instanceof HTMLCanvasElement || 'getContext' in opts.canvas) {
      // Best-effort: set size so consumers can read width/height afterwards.
      // OffscreenCanvas exposes width/height, HTMLCanvasElement does too.
      (opts.canvas as HTMLCanvasElement).width = w;
      (opts.canvas as HTMLCanvasElement).height = h;
    }
    return {width: w, height: h};
  }

  async getTextContent(): Promise<TextContent> {
    return {
      items: [
        {
          text: this.text,
          bbox: {x: 0, y: 0, width: this.size.width, height: this.size.height},
          charStart: 0,
          charEnd: this.text.length,
        },
      ],
    };
  }

  async renderTextLayer(opts: TextLayerRenderOptions): Promise<TextLayerHandle> {
    this.cfg.onRenderTextLayer?.(this.pageNumber, opts);
    if (opts.signal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    // Render a span with the page text into the container so search/match
    // tests can target it.
    opts.container.innerHTML = '';
    const span = opts.container.ownerDocument.createElement('span');
    span.textContent = this.text;
    span.dataset.mockPage = String(this.pageNumber);
    opts.container.appendChild(span);
    return {cancel: () => {}};
  }

  cleanup(): void {
    this.cleaned = true;
  }

  get isCleanedUp(): boolean {
    return this.cleaned;
  }
}

class MockDocumentHandle implements PDFDocumentHandle {
  readonly numPages: number;
  readonly fingerprint: string;
  private readonly cfg: MockEngineConfig;
  private destroyed = false;

  constructor(cfg: MockEngineConfig) {
    this.numPages = cfg.numPages ?? 1;
    this.fingerprint = cfg.fingerprint ?? 'mock-fingerprint';
    this.cfg = cfg;
  }

  async metadata(): Promise<PDFMetadata> {
    return this.cfg.metadata ?? {};
  }

  async outline(): Promise<OutlineNode[]> {
    return this.cfg.outline ?? [];
  }

  async getPage(pageNumber: number): Promise<PDFPageHandle> {
    if (pageNumber < 1 || pageNumber > this.numPages) {
      throw new RangeError(
        `MockDocumentHandle.getPage: pageNumber ${pageNumber} out of range [1, ${this.numPages}]`,
      );
    }
    const text = this.cfg.text?.[pageNumber - 1] ?? `Page ${pageNumber}`;
    return new MockPageHandle(pageNumber, text, this.cfg);
  }

  destroy(): void {
    this.destroyed = true;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}

class MockEngineImpl implements PDFEngine {
  private readonly cfg: MockEngineConfig;

  constructor(cfg: MockEngineConfig) {
    this.cfg = cfg;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async load(_source: PDFSource, _opts?: LoadOptions): Promise<PDFDocumentHandle> {
    return new MockDocumentHandle(this.cfg);
  }

  destroy(): void {
    // No engine-level resources held by the mock.
  }
}

/**
 * Create a configurable mock PDF engine that satisfies `PDFEngine`
 * without invoking pdfjs-dist. See module docstring for usage.
 */
export function createMockEngine(cfg: MockEngineConfig = {}): PDFEngine {
  return new MockEngineImpl(cfg);
}
