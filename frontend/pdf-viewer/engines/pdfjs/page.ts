import type {PDFPageProxy} from 'pdfjs-dist';
import type {
  PDFPageHandle,
  RenderOptions,
  RenderResult,
  TextContent,
  TextItem,
  TextLayerRenderOptions,
  TextLayerHandle,
} from '../../core/engine';
import type {PDFRect} from '../../core/coordinates';

export class PdfJsPageHandle implements PDFPageHandle {
  private cleaned = false;

  constructor(private readonly proxy: PDFPageProxy, public readonly pageNumber: number) {}

  get size(): {width: number; height: number} {
    // proxy.view is [x1, y1, x2, y2] in PDF user space
    const [x1, y1, x2, y2] = this.proxy.view;
    return {width: x2 - x1, height: y2 - y1};
  }

  async render(opts: RenderOptions): Promise<RenderResult> {
    const viewport = this.proxy.getViewport({
      scale: opts.scale,
      rotation: opts.rotation ?? 0,
    });
    // Validate 2d context is available before delegating to pdfjs.
    if (!opts.canvas.getContext('2d')) throw new Error('PdfJsPageHandle.render: canvas 2d context unavailable');

    opts.canvas.width = Math.floor(viewport.width);
    opts.canvas.height = Math.floor(viewport.height);

    const task = this.proxy.render({
      // pdfjs-dist v5 prefers `canvas` over legacy `canvasContext`.
      // OffscreenCanvas is not in pdfjs RenderParameters type — cast through unknown.
      canvas: opts.canvas as unknown as HTMLCanvasElement,
      viewport,
    });

    if (opts.signal) {
      if (opts.signal.aborted) {
        task.cancel();
        throw new DOMException('aborted', 'AbortError');
      }
      const onAbort = () => task.cancel();
      opts.signal.addEventListener('abort', onAbort, {once: true});
      try {
        await task.promise;
      } finally {
        opts.signal.removeEventListener('abort', onAbort);
      }
    } else {
      await task.promise;
    }

    return {width: viewport.width, height: viewport.height};
  }

  async getTextContent(): Promise<TextContent> {
    const raw = await this.proxy.getTextContent();
    const items: TextItem[] = [];
    let charOffset = 0;
    for (const item of raw.items) {
      // raw.items can include both TextItem and TextMarkedContent — keep only text items
      if (!('str' in item)) continue;
      const text = item.str ?? '';
      if (!text) continue;

      // PDF.js item has transform [a, b, c, d, e, f] where (e, f) is origin in PDF user space.
      // width/height come from item.width and item.height (in user space units when scale=1).
      const [, , , , x, y] = item.transform;
      const bbox: PDFRect = {
        x,
        y,
        width: item.width,
        height: item.height,
      };
      const charStart = charOffset;
      const charEnd = charOffset + text.length;
      items.push({text, bbox, charStart, charEnd});
      charOffset = charEnd;
    }
    return {items};
  }

  async renderTextLayer({container, scale, rotation, signal}: TextLayerRenderOptions): Promise<TextLayerHandle> {
    const viewport = this.proxy.getViewport({scale, rotation: rotation ?? 0});

    // Clear previous content (idempotent re-render)
    container.innerHTML = '';
    container.style.setProperty('--total-scale-factor', String(scale));

    const {pdfjs} = await import('react-pdf');
    const textLayer = new pdfjs.TextLayer({
      textContentSource: this.proxy.streamTextContent({includeMarkedContent: true, disableNormalization: true}),
      container,
      viewport,
    });

    if (signal?.aborted) {
      textLayer.cancel();
      throw new DOMException('aborted', 'AbortError');
    }

    const renderPromise = textLayer.render();

    if (signal) {
      const onAbort = () => textLayer.cancel();
      signal.addEventListener('abort', onAbort, {once: true});
      try {
        await renderPromise;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    } else {
      await renderPromise;
    }

    return {cancel: () => textLayer.cancel()};
  }

  cleanup(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    this.proxy.cleanup();
  }
}
