import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {render, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {ViewerProvider} from '../core/context';
import type {PDFPageHandle, TextLayerRenderOptions} from '../core/engine';
import {createMockEngine} from '../engines/mock';
import {TextLayer} from '../primitives/TextLayer';
import {PlannedPageProvider, type PageRenderPlan} from '../primitives/pageRenderPlan';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(__dirname, '../primitives/text-layer.css');

describe('text-layer.css rotation rules', () => {
  it('defines a rotate transform for data-main-rotation 90, 180 and 270', () => {
    const css = readFileSync(cssPath, 'utf-8');
    for (const deg of [90, 180, 270]) {
      const rule = new RegExp(
        `\\.pdf-viewer-text-layer\\[data-main-rotation=["']${deg}["']\\][\\s\\S]{0,120}?transform:\\s*rotate\\(${deg}deg\\)`,
      );
      expect(css).toMatch(rule);
    }
  });
});

/**
 * `<TextLayer>` is a painter: it paints exactly what the page render plan
 * says. The policy behind the plan is tested in `page-render-plan.test.tsx`.
 */
describe('<TextLayer> paints the plan', () => {
  async function recordingHandle() {
    const onRenderTextLayer = vi.fn<(page: number, opts: TextLayerRenderOptions) => void>();
    const engine = createMockEngine({numPages: 1, rotation: 90, text: ['hello'], onRenderTextLayer});
    const doc = await engine.load({kind: 'url', url: 'mock.pdf'});
    return {handle: await doc.getPage(1), onRenderTextLayer};
  }

  const planFor = (handle: PDFPageHandle, overrides: Partial<PageRenderPlan> = {}): PageRenderPlan => ({
    handle,
    rotation: 180,
    cssSize: {width: 918, height: 1188},
    cssZoom: 1.5,
    devicePixelScale: 3,
    settled: true,
    ...overrides,
  });

  function renderLayer(plan: PageRenderPlan) {
    // The search highlights read the store; the paint reads only the plan.
    const ui = (p: PageRenderPlan) => (
      <ViewerProvider>
        <PlannedPageProvider pageNumber={1} plan={p}>
          <TextLayer />
        </PlannedPageProvider>
      </ViewerProvider>
    );
    const result = render(ui(plan));
    const span = () => result.container.querySelector('.pdf-viewer-text-layer span');
    return {span, replan: (p: PageRenderPlan) => result.rerender(ui(p))};
  }

  it('paints at the plan’s CSS zoom, not its bitmap scale, and at the plan’s rotation', async () => {
    const {handle, onRenderTextLayer} = await recordingHandle();
    const {span} = renderLayer(planFor(handle));
    await waitFor(() => expect(onRenderTextLayer).toHaveBeenCalledOnce());
    const [, opts] = onRenderTextLayer.mock.calls[0];
    expect(opts).toMatchObject({scale: 1.5, rotation: 180});
    expect(span()?.textContent).toBe('hello');
  });

  it('stays empty while the plan is unsettled and paints once it settles', async () => {
    const {handle, onRenderTextLayer} = await recordingHandle();
    const {span, replan} = renderLayer(planFor(handle, {settled: false}));
    expect(onRenderTextLayer).not.toHaveBeenCalled();
    expect(span()).toBeNull();

    replan(planFor(handle, {settled: true}));
    await waitFor(() => expect(span()?.textContent).toBe('hello'));

    // A new gesture or zoom change unsettles the plan: the spans at the old scale go.
    replan(planFor(handle, {settled: false}));
    expect(span()).toBeNull();
    expect(onRenderTextLayer).toHaveBeenCalledOnce();
  });
});
