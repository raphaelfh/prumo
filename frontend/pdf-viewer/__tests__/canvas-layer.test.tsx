import {render, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import type {PageRotation} from '../core/engine';
import {createMockEngine} from '../engines/mock';
import {CanvasLayer} from '../primitives/CanvasLayer';

// The canvas backing store is `scale * devicePixelRatio`; without an explicit
// CSS size the canvas lays out at that backing size. On a HiDPI screen every
// page would render at DPR× its size until its (slow) render resolved, then
// snap back. The CSS size must therefore be in place before rendering starts.
async function styleAtRenderStart(opts: {scale: number; rotation: PageRotation}) {
  const seen: {cssWidth: string; cssHeight: string; renderScale: number}[] = [];
  const engine = createMockEngine({
    numPages: 1,
    pageSize: {width: 600, height: 800},
    onRender: (_page, {canvas, scale}) => {
      const {style} = canvas as HTMLCanvasElement;
      seen.push({cssWidth: style.width, cssHeight: style.height, renderScale: scale});
    },
  });
  const store = createViewerStore(opts);
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

    const atStart = await styleAtRenderStart({scale: 1.5, rotation: 0});

    // Precondition: the backing store really is DPR-scaled, so an unset CSS
    // size would lay the page out at twice its size.
    expect(atStart.renderScale).toBe(3);
    expect(atStart).toMatchObject({cssWidth: '900px', cssHeight: '1200px'});
  });

  it('swaps the CSS width and height for a quarter-turn rotation', async () => {
    vi.stubGlobal('devicePixelRatio', 2);

    const atStart = await styleAtRenderStart({scale: 1.5, rotation: 90});

    expect(atStart).toMatchObject({cssWidth: '1200px', cssHeight: '900px'});
  });
});
