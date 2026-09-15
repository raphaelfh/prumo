import {render, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import type {PageRotation} from '../core/engine';
import {createMockEngine} from '../engines/mock';
import {CanvasLayer} from '../primitives/CanvasLayer';

/**
 * The CSS size and the render options when the first render starts. The canvas
 * backing store is DPR-scaled; without an explicit CSS size the canvas lays
 * out at that backing size — DPR× too large until the render resolves — so the CSS
 * size must be in place before rendering starts.
 */
async function atRenderStart(opts: {
  scale: number;
  viewRotation: PageRotation;
  pageRotation?: PageRotation;
  pageSize?: {width: number; height: number};
}) {
  const seen: {cssWidth: string; cssHeight: string; renderScale: number; rotation: PageRotation}[] = [];
  const engine = createMockEngine({
    numPages: 1,
    pageSize: opts.pageSize ?? {width: 600, height: 800},
    rotation: opts.pageRotation ?? 0,
    onRender: (_page, {canvas, scale, rotation}) => {
      const {style} = canvas as HTMLCanvasElement;
      seen.push({cssWidth: style.width, cssHeight: style.height, renderScale: scale, rotation});
    },
  });
  const store = createViewerStore({scale: opts.scale, viewRotation: opts.viewRotation});
  store.getState().actions.setDocument(await engine.load({kind: 'url', url: 'mock.pdf'}));

  render(
    <ViewerProvider store={store}>
      <CanvasLayer pageNumber={1} />
    </ViewerProvider>,
  );
  await waitFor(() => expect(seen).toHaveLength(1));
  return seen[0];
}

describe('<CanvasLayer>', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sizes the canvas in CSS pixels before the render is invoked on a HiDPI screen', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const start = await atRenderStart({scale: 1.5, viewRotation: 0});
    // Precondition: the backing store really is DPR-scaled.
    expect(start.renderScale).toBe(3);
    expect(start).toMatchObject({cssWidth: '900px', cssHeight: '1200px', rotation: 0});
  });

  it('swaps the CSS width and height for a quarter view rotation', async () => {
    const start = await atRenderStart({scale: 1.5, viewRotation: 90});
    expect(start).toMatchObject({cssWidth: '1200px', cssHeight: '900px', rotation: 90});
  });

  it('draws a /Rotate 90 page at 90° and landscape with no view rotation', async () => {
    const start = await atRenderStart({scale: 1.5, viewRotation: 0, pageRotation: 90, pageSize: {width: 800, height: 600}});
    expect(start).toMatchObject({cssWidth: '1200px', cssHeight: '900px', rotation: 90});
  });

  it('adds the view rotation to the page’s own rotation', async () => {
    const start = await atRenderStart({scale: 1.5, viewRotation: 90, pageRotation: 90, pageSize: {width: 800, height: 600}});
    expect(start).toMatchObject({cssWidth: '900px', cssHeight: '1200px', rotation: 180});
  });
});
