import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {ViewerProvider} from '../core/context';
import type {RenderOptions} from '../core/engine';
import {createViewerStore} from '../core/store';
import {createMockEngine} from '../engines/mock';
import {CanvasLayer} from '../primitives/CanvasLayer';
import {TextLayer} from '../primitives/TextLayer';

const LETTER = {width: 612, height: 792};

beforeEach(() => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderPage(zoom = 1) {
  const renders: RenderOptions[] = [];
  const textLayers: number[] = [];
  const engine = createMockEngine({
    numPages: 1,
    pageSize: LETTER,
    text: ['page one'],
    onRender: (_page, opts) => renders.push(opts),
    onRenderTextLayer: (page) => textLayers.push(page),
  });
  const store = createViewerStore({zoom, fitWidth: false});
  store.getState().actions.setDocument(await engine.load({kind: 'url', url: 'mock.pdf'}));
  const {container} = render(
    <ViewerProvider store={store}>
      <CanvasLayer pageNumber={1} />
      <TextLayer pageNumber={1} />
    </ViewerProvider>,
  );
  // The page handle resolves, then the first render starts at once.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return {store, container, renders, textLayers};
}

describe('deferred page rendering', () => {
  it('renders a burst of zoom changes once, 100ms after the last', async () => {
    const {store, renders, textLayers} = await renderPage();
    // Precondition: the first render did not wait.
    expect(renders).toHaveLength(1);
    expect(textLayers).toHaveLength(1);

    for (const zoom of [1.1, 1.2, 1.3, 1.4, 1.5]) {
      act(() => store.getState().actions.setZoom(zoom));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
    }
    expect(renders).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(renders).toHaveLength(2);
    expect(textLayers).toHaveLength(2);
    expect(renders[1].scale).toBe(1.5);
  });

  it('keeps the canvas bitmap and hides the text layer during a gesture', async () => {
    const {store, container, renders} = await renderPage();
    act(() => store.getState().actions.setGesturing(true));
    expect(container.querySelector('.pdf-viewer-text-layer span')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(renders).toHaveLength(1);

    act(() => {
      store.getState().actions.setZoom(2);
      store.getState().actions.setGesturing(false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(renders).toHaveLength(2);
    expect(container.querySelector('.pdf-viewer-text-layer span')?.textContent).toBe('page one');
  });

  it('caps the device pixel ratio at 2 and the backing store at 16 777 216 pixels', async () => {
    vi.stubGlobal('devicePixelRatio', 3);
    const low = await renderPage(1);
    expect(low.renders[0].scale).toBe(2); // zoom 1 × min(3, 2)

    const high = await renderPage(4);
    const {scale} = high.renders[0];
    expect(scale).toBeGreaterThan(4);
    // At the cap the product equals the budget up to float rounding.
    expect(LETTER.width * scale * LETTER.height * scale).toBeLessThanOrEqual(16_777_216 + 1);
  });
});
