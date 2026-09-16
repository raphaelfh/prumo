/**
 * A match on a page far from the viewport: the active match navigates to its
 * page, the page scroll sync scrolls there, the page mounts, and its text
 * layer highlights the match once it has painted.
 */
import {act, render, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../core/context';
import {PDF_SEARCH_ACTIVE_HIGHLIGHT} from '../primitives/searchHighlight';
import {createViewerStore} from '../core/store';
import {createMockEngine} from '../engines/mock';
import {createPageLayout} from '../viewport/usePageLayout';

const {Viewer} = await import('../primitives/Viewer');
const {TextLayer} = await import('../primitives/TextLayer');

/** jsdom has no CSS Custom Highlight API; this is the registry the layer writes to. */
class FakeHighlight {
  ranges: Range[];
  priority = 0;
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}
const highlights = new Map<string, FakeHighlight>();

const VIEWPORT = 725;
const LETTER = {width: 612, height: 792};
const PAGES = 18;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(VIEWPORT);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
  Element.prototype.scrollIntoView = vi.fn();
  highlights.clear();
  vi.stubGlobal('Highlight', FakeHighlight);
  vi.stubGlobal('CSS', {...(globalThis.CSS ?? {}), highlights});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Element.prototype as {scrollIntoView?: unknown}).scrollIntoView;
});

describe('search on a page that is not mounted', () => {
  it('scrolls to the page, mounts it, and highlights the match', async () => {
    const text = Array.from({length: PAGES}, (_, i) => (i === 11 ? 'needle in page twelve' : `page ${i + 1}`));
    const engine = createMockEngine({numPages: PAGES, pageSize: LETTER, text});
    const store = createViewerStore();
    store.getState().actions.setDocument(await engine.load({kind: 'url', url: 'mock.pdf'}));
    store.getState().actions.setPageSize(1, LETTER);
    const {container} = render(
      <ViewerProvider store={store}>
        <Viewer.Body>
          <Viewer.Pages>
            {({number}) => (
              <Viewer.Page pageNumber={number}>
                <TextLayer pageNumber={number} />
              </Viewer.Page>
            )}
          </Viewer.Pages>
        </Viewer.Body>
      </ViewerProvider>,
    );
    const scroller = container.querySelector<HTMLElement>('[data-pdf-viewer-body]')!;
    const layout = createPageLayout({numPages: PAGES, pageSizes: {1: LETTER}, viewRotation: 0, zoom: 1});
    Object.defineProperty(scroller, 'clientHeight', {configurable: true, value: VIEWPORT});
    Object.defineProperty(scroller, 'scrollHeight', {configurable: true, value: layout.totalHeight});
    // The browser: the scroll lands at once and comes to rest.
    scroller.scrollTo = (({top}: ScrollToOptions) => {
      scroller.scrollTop = top ?? 0;
      scroller.dispatchEvent(new Event('scroll'));
      scroller.dispatchEvent(new Event('scrollend'));
    }) as HTMLElement['scrollTo'];
    // Precondition: page 12 is not mounted.
    expect(container.querySelector('[data-page-number="12"]')).toBeNull();

    act(() => {
      store.getState().actions.setSearchMatches([{pageNumber: 12, charStart: 0, charEnd: 6, context: 'needle'}]);
      store.getState().actions.setActiveMatchIndex(0);
    });

    expect(scroller.scrollTop).toBe(layout.offsetOf(12));
    // The active match is highlighted over exactly the matched characters —
    // not over the whole span the text layer painted for the line.
    await waitFor(() => expect(highlights.has(PDF_SEARCH_ACTIVE_HIGHLIGHT)).toBe(true));
    const active = highlights.get(PDF_SEARCH_ACTIVE_HIGHLIGHT)!;
    expect(active.ranges.map((r) => r.toString())).toEqual(['needle']);
  });
});
