/**
 * `<CanvasLayer>` is a painter: it draws exactly what the page render plan
 * says. The zoom, dpr and rotation policy behind the plan is tested in
 * `page-render-plan.test.tsx`.
 */
import {render, waitFor} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import type {PageRotation, PDFPageHandle, RenderOptions} from '../core/engine';
import {createMockEngine} from '../engines/mock';
import {CanvasLayer} from '../primitives/CanvasLayer';
import {PlannedPageProvider, type PageRenderPlan} from '../primitives/pageRenderPlan';

interface Seen {
  cssWidth: string;
  cssHeight: string;
  scale: number;
  rotation: PageRotation;
}

/** A page handle that records the canvas's CSS size and the options at the moment each render starts. */
async function recordingHandle(): Promise<{handle: PDFPageHandle; seen: Seen[]}> {
  const seen: Seen[] = [];
  const engine = createMockEngine({
    numPages: 1,
    pageSize: {width: 600, height: 800},
    onRender: (_page, {canvas, scale, rotation}: RenderOptions) => {
      const {style} = canvas as HTMLCanvasElement;
      seen.push({cssWidth: style.width, cssHeight: style.height, scale, rotation});
    },
  });
  const doc = await engine.load({kind: 'url', url: 'mock.pdf'});
  return {handle: await doc.getPage(1), seen};
}

const planFor = (handle: PDFPageHandle, overrides: Partial<PageRenderPlan> = {}): PageRenderPlan => ({
  handle,
  rotation: 0,
  cssSize: {width: 900, height: 1200},
  cssZoom: 1.5,
  devicePixelScale: 3,
  settled: true,
  ...overrides,
});

function renderLayer(plan: PageRenderPlan) {
  const ui = (p: PageRenderPlan) => (
    <PlannedPageProvider pageNumber={1} plan={p}>
      <CanvasLayer />
    </PlannedPageProvider>
  );
  const result = render(ui(plan));
  return {...result, canvas: result.container.querySelector('canvas')!, replan: (p: PageRenderPlan) => result.rerender(ui(p))};
}

describe('<CanvasLayer>', () => {
  it('sizes the canvas in CSS pixels from the plan before invoking the render, at the plan’s bitmap scale and rotation', async () => {
    const {handle, seen} = await recordingHandle();
    renderLayer(planFor(handle, {rotation: 90, cssSize: {width: 1200, height: 900}}));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({cssWidth: '1200px', cssHeight: '900px', scale: 3, rotation: 90});
  });

  it('lays out at an unsettled plan’s size without painting, then paints once the plan settles', async () => {
    const {handle, seen} = await recordingHandle();
    const {canvas, replan} = renderLayer(planFor(handle, {settled: false}));
    expect(canvas.style.width).toBe('900px');
    expect(canvas.style.height).toBe('1200px');
    expect(seen).toHaveLength(0);

    replan(planFor(handle, {settled: true}));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({cssWidth: '900px', cssHeight: '1200px', scale: 3});
  });

  it('labels the canvas with its page number before the handle resolves', () => {
    const {container} = render(
      <PlannedPageProvider pageNumber={7} plan={null}>
        <CanvasLayer />
      </PlannedPageProvider>,
    );
    expect(container.querySelector('canvas')).toHaveAttribute('aria-label', 'PDF page 7');
  });
});
