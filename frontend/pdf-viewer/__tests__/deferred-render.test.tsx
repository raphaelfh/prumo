/**
 * Store → `Viewer.Page`'s render plan → the painters, end to end: a zoom
 * change reaches both layers once, at the right scale for each.
 */
import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// Viewer.tsx loads the pdf.js engine, whose browser build needs DOMMatrix.
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../core/context';
import type {RenderOptions} from '../core/engine';
import {createViewerStore} from '../core/store';
import {createMockEngine} from '../engines/mock';
import {CanvasLayer} from '../primitives/CanvasLayer';
import {TextLayer} from '../primitives/TextLayer';

const {Viewer} = await import('../primitives/Viewer');

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
  const textScales: number[] = [];
  const engine = createMockEngine({
    numPages: 1,
    pageSize: LETTER,
    text: ['page one'],
    onRender: (_page, opts) => renders.push(opts),
    onRenderTextLayer: (_page, opts) => textScales.push(opts.scale),
  });
  const store = createViewerStore({zoom, fitWidth: false});
  store.getState().actions.setDocument(await engine.load({kind: 'url', url: 'mock.pdf'}));
  const {container} = render(
    <ViewerProvider store={store}>
      <Viewer.Page pageNumber={1}>
        <CanvasLayer />
        <TextLayer />
      </Viewer.Page>
    </ViewerProvider>,
  );
  // The page handle resolves, then the first paint starts at once.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return {store, container, renders, textScales};
}

describe('a page’s layers paint the plan Viewer.Page provides', () => {
  it('renders a burst of zoom changes once, 100ms after the last — canvas at zoom × dpr, text at CSS zoom', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const {store, renders, textScales} = await renderPage();
    // Precondition: the first paint did not wait.
    expect(renders.map((r) => r.scale)).toEqual([2]);
    expect(textScales).toEqual([1]);

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
    expect(renders.map((r) => r.scale)).toEqual([2, 3]);
    expect(textScales).toEqual([1, 1.5]);
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
    expect(renders[1].scale).toBe(2);
    expect(container.querySelector('.pdf-viewer-text-layer span')?.textContent).toBe('page one');
  });
});
