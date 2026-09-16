import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../../core/context';
import type {PDFDocumentHandle} from '../../core/engine';
import {createViewerStore} from '../../core/store';
import {PAGE_GAP} from '../usePageLayout';

const {Viewer} = await import('../../primitives/Viewer');

const LETTER = {width: 612, height: 792};
const NATURAL_WIDTH = LETTER.width + 2 * PAGE_GAP; // 644

let observers: Array<{callback: (entries: ResizeObserverEntry[]) => void; target: Element}> = [];
const resize = () => {
  for (const {callback, target} of observers) {
    const rect = target.getBoundingClientRect();
    callback([
      {
        target,
        borderBoxSize: [{inlineSize: rect.width, blockSize: rect.height} as ResizeObserverSize],
        contentBoxSize: [{inlineSize: rect.width, blockSize: rect.height} as ResizeObserverSize],
        contentRect: rect,
      } as unknown as ResizeObserverEntry,
    ]);
  }
};

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: (entries: ResizeObserverEntry[]) => void) {}
      observe(target: Element) {
        observers.push({callback: this.callback, target});
      }
      // A disconnected observer never reports again, as in the browser.
      disconnect() {
        observers = observers.filter((o) => o.callback !== this.callback);
      }
      unobserve() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stubDocument = (numPages: number): PDFDocumentHandle => ({
  numPages,
  getPage: async () => {
    throw new Error('stub');
  },
  destroy: () => {},
});

function renderViewer(width: number) {
  // jsdom defines clientWidth on Element.prototype.
  const clientWidth = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width);
  const store = createViewerStore({numPages: 3, pageSizes: {1: LETTER}});
  render(
    <ViewerProvider store={store}>
      <Viewer.Body>
        <Viewer.Pages>{({number}) => <Viewer.Page pageNumber={number} />}</Viewer.Pages>
      </Viewer.Body>
    </ViewerProvider>,
  );
  const resizeTo = (next: number) => {
    clientWidth.mockReturnValue(next);
    act(() => resize());
  };
  return {store, resizeTo};
}

describe('fit width', () => {
  it('opens with the widest page filling the viewer', () => {
    const {store} = renderViewer(966);
    expect(store.getState().fitWidth).toBe(true);
    expect(store.getState().zoom).toBeCloseTo(966 / NATURAL_WIDTH, 10);
  });

  it('follows the viewer’s width while on', () => {
    const {store, resizeTo} = renderViewer(966);
    resizeTo(NATURAL_WIDTH);
    expect(store.getState().zoom).toBe(1);
  });

  it('stops following after a manual zoom', () => {
    const {store, resizeTo} = renderViewer(966);
    act(() => store.getState().actions.setZoom(2));
    resizeTo(NATURAL_WIDTH);
    expect(store.getState().zoom).toBe(2);
  });

  it('fits a newly opened document again', () => {
    const {store} = renderViewer(966);
    act(() => store.getState().actions.setZoom(2));
    act(() => {
      store.getState().actions.setDocument(stubDocument(3));
      store.getState().actions.setPageSize(1, LETTER);
    });
    expect(store.getState().fitWidth).toBe(true);
    expect(store.getState().zoom).toBeCloseTo(966 / NATURAL_WIDTH, 10);
  });
});
