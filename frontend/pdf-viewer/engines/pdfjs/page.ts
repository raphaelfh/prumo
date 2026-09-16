import type {PDFPageProxy} from 'pdfjs-dist';
import type {
  PageRotation,
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

  get rotation(): PageRotation {
    return this.proxy.rotate as PageRotation;
  }

  get size(): {width: number; height: number} {
    // A viewport without an explicit rotation uses the page's own /Rotate.
    const {width, height} = this.proxy.getViewport({scale: 1});
    return {width, height};
  }

  async render(opts: RenderOptions): Promise<RenderResult> {
    const viewport = this.proxy.getViewport({scale: opts.scale, rotation: opts.rotation});
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
    // `disableNormalization` must match the TextLayer's option below: the two
    // item streams are index-aligned (item `i` ↔ `textDivs[i]`), and pdf.js's
    // normalization rewrites `str`. Folding is `core/pageText`'s job instead,
    // where it stays reversible through the offset map.
    const raw = await this.proxy.getTextContent({disableNormalization: true});
    const items: TextItem[] = [];
    for (const item of raw.items) {
      // raw.items can include both TextItem and TextMarkedContent — keep only
      // text items, exactly as pdf.js's TextLayer does when it builds textDivs.
      if (!('str' in item)) continue;

      // PDF.js item has transform [a, b, c, d, e, f] where (e, f) is origin in PDF user space.
      // width/height come from item.width and item.height (in user space units when scale=1).
      const [, , , , x, y] = item.transform;
      const bbox: PDFRect = {
        x,
        y,
        width: item.width,
        height: item.height,
      };
      // An empty item still gets a div from the TextLayer, so it is kept here:
      // dropping it would shift every later index against the painted spans.
      items.push({text: item.str ?? '', bbox, hasEOL: item.hasEOL ?? false});
    }
    return {items};
  }

  async renderTextLayer({container, scale, rotation, signal}: TextLayerRenderOptions): Promise<TextLayerHandle> {
    const viewport = this.proxy.getViewport({scale, rotation});

    // Clear previous content (idempotent re-render)
    container.innerHTML = '';
    // CSS zoom only. pdf.js TextLayer multiplies OutputScale.pixelRatio for
    // measureText; this property drives font-size via --text-scale-factor.
    container.style.setProperty('--total-scale-factor', String(scale));

    const pdfjs = await import('pdfjs-dist');
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

    return {
      cancel: () => textLayer.cancel(),
      textDivs: textLayer.textDivs as readonly HTMLElement[],
    };
  }

  cleanup(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    this.proxy.cleanup();
  }
}
