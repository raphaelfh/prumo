/**
 * Only the pages in and next to the viewport mount. jsdom has no layout: the
 * virtualizer reads the scroller's size from offsetHeight/offsetWidth, which
 * the tests stub, and scroll positions are set by hand.
 */
import {act, render, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import {createMockEngine} from '../engines/mock';
import {createPageLayout} from '../viewport/usePageLayout';

const {Viewer} = await import('../primitives/Viewer');
const {CanvasLayer} = await import('../primitives/CanvasLayer');

const VIEWPORT = 725;
const LETTER = {width: 612, height: 792};
const LANDSCAPE = {width: 792, height: 612};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(VIEWPORT);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
  // The virtualizer's scroll correction calls scrollTo; jsdom has none.
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === 'object' && options.top !== undefined) this.scrollTop = options.top;
  } as HTMLElement['scrollTo'];
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as {scrollTo?: unknown}).scrollTo;
});

async function renderDocument(numPages: number) {
  const engine = createMockEngine({numPages, pageSize: LETTER});
  const store = createViewerStore();
  store.getState().actions.setDocument(await engine.load({kind: 'data', data: new Uint8Array()}));
  store.getState().actions.setPageSize(1, LETTER);
  const {container} = render(
    <ViewerProvider store={store}>
      <Viewer.Body>
        <Viewer.Pages>
          {({number}) => (
            <Viewer.Page pageNumber={number}>
              <CanvasLayer pageNumber={number} />
            </Viewer.Page>
          )}
        </Viewer.Pages>
      </Viewer.Body>
    </ViewerProvider>,
  );
  const scroller = container.querySelector<HTMLElement>('[data-pdf-viewer-body]')!;
  const mounted = () =>
    [...container.querySelectorAll('[data-page-number]')].map((el) => Number(el.getAttribute('data-page-number')));
  const scrollTo = (top: number) =>
    act(() => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event('scroll'));
    });
  return {store, scroller, mounted, scrollTo};
}

describe('Viewer.Pages virtualization', () => {
  const layout = createPageLayout({numPages: 18, pageSizes: {1: LETTER}, viewRotation: 0, zoom: 1});

  it('mounts only the pages in and next to the viewport', async () => {
    const {mounted} = await renderDocument(18);
    await waitFor(() => expect(mounted()).toEqual([1, 2]));
  });

  it('mounts the pages around a scroll position far down the document', async () => {
    const {mounted, scrollTo} = await renderDocument(18);
    scrollTo(layout.offsetOf(10));
    await waitFor(() => expect(mounted()).toEqual([9, 10, 11]));
  });

  it('keeps the reading position when a page above it turns out landscape', async () => {
    const {store, scroller, mounted, scrollTo} = await renderDocument(18);
    scrollTo(layout.offsetOf(10));
    await waitFor(() => expect(mounted()).toContain(9));
    // Precondition: page 9 was laid out on page 1's portrait estimate. The
    // page's handle resolves asynchronously (usePageHandle awaits
    // `document.getPage`), so wait for the store to reflect it rather than
    // asserting the instant the DOM node mounts.
    await waitFor(() => expect(store.getState().pageSizes[9]).toEqual(LETTER));

    act(() => store.getState().actions.setPageSize(9, LANDSCAPE));

    expect(scroller.scrollTop).toBe(layout.offsetOf(10) - (LETTER.height - LANDSCAPE.height));
  });
});
