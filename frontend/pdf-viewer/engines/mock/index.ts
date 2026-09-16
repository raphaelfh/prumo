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
  PageRotation,
  PDFDocumentHandle,
  PDFEngine,
  PDFPageHandle,
  RenderOptions,
  RenderResult,
  TextContent,
  TextLayerHandle,
  TextLayerRenderOptions,
} from '../../core/engine';
import type {PDFSource} from '../../core/source';

export interface MockEngineConfig {
  numPages?: number;
  pageSize?: {width: number; height: number};
  /** Every page's own `/Rotate`; `pageSize` is then the displayed size at it. */
  rotation?: PageRotation;
  /** One string per page — used by getTextContent and to size text bboxes. */
  text?: readonly string[];
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
  readonly rotation: PageRotation;
  private readonly text: string;
  private readonly cfg: MockEngineConfig;
  private cleaned = false;

  constructor(pageNumber: number, text: string, cfg: MockEngineConfig) {
    this.pageNumber = pageNumber;
    this.text = text;
    this.cfg = cfg;
    this.size = cfg.pageSize ?? {width: 612, height: 792};
    this.rotation = cfg.rotation ?? 0;
  }

  async render(opts: RenderOptions): Promise<RenderResult> {
    this.cfg.onRender?.(this.pageNumber, opts);
    if (opts.signal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    // The drawn size turns only for the part of the rotation that is not the page's own.
    const quarterTurn = (opts.rotation - this.rotation) % 180 !== 0;
    const w = Math.floor((quarterTurn ? this.size.height : this.size.width) * opts.scale);
    const h = Math.floor((quarterTurn ? this.size.width : this.size.height) * opts.scale);
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
          hasEOL: false,
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
    // One div per text item, mirroring pdf.js's `textDivs` contract.
    return {cancel: () => {}, textDivs: [span]};
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
  private readonly cfg: MockEngineConfig;
  private destroyed = false;
  /**
   * One handle per page, as pdf.js caches its PDFPageProxy per index: every
   * caller for a page shares it, so whoever calls `cleanup()` on it does so
   * for all of them. Handing out a fresh handle each call would hide that.
   */
  private readonly pages = new Map<number, MockPageHandle>();

  constructor(cfg: MockEngineConfig) {
    this.numPages = cfg.numPages ?? 1;
    this.cfg = cfg;
  }

  async getPage(pageNumber: number): Promise<PDFPageHandle> {
    if (pageNumber < 1 || pageNumber > this.numPages) {
      throw new RangeError(
        `MockDocumentHandle.getPage: pageNumber ${pageNumber} out of range [1, ${this.numPages}]`,
      );
    }
    const cached = this.pages.get(pageNumber);
    if (cached) return cached;
    const text = this.cfg.text?.[pageNumber - 1] ?? `Page ${pageNumber}`;
    const page = new MockPageHandle(pageNumber, text, this.cfg);
    this.pages.set(pageNumber, page);
    return page;
  }

  destroy(): void {
    this.destroyed = true;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}

/**
 * Create a configurable mock PDF engine that satisfies `PDFEngine`
 * without invoking pdfjs-dist. See module docstring for usage.
 */
export function createMockEngine(cfg: MockEngineConfig = {}): PDFEngine {
  return {
    async load(_source: PDFSource): Promise<PDFDocumentHandle> {
      return new MockDocumentHandle(cfg);
    },
  };
}
