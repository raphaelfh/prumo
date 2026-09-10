/**
 * Page ⇄ scroll sync for the canvas body (`Viewer.Body`) and the markdown
 * reader (`<Reader>`): navigation scrolls to a page, scrolling publishes the
 * page back to `currentPage`, and neither may undo the other.
 *
 * jsdom has no layout and no IntersectionObserver, so these tests play the
 * browser: the geometry measured on the real Articles document view, a fake
 * observer the test fires itself, and a `scrollTo` that records a smooth
 * scroll without moving — the test then walks `scrollTop` frame by frame and
 * ends the scroll with `scrollend`. The real-browser check is
 * `frontend/e2e/flows/pdf-viewer-page-sync.ui.e2e.ts`.
 */
import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// Viewer.tsx loads the pdf.js engine, whose browser build needs DOMMatrix;
// shim it with the Node-compatible legacy build (as primitives.test.tsx does).
import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import {Reader, type ReaderTextBlock} from '../primitives/Reader';

const {Viewer} = await import('../primitives/Viewer');

// Measured in headless Chromium on the Articles document view: A4 pages at
// 100%, 16px apart, in a 725px-tall scroller (scrollHeight 12028 for 14 pages).
const PAGE_HEIGHT = 842;
const PAGE_GAP = 16;
const PAGE_PITCH = PAGE_HEIGHT + PAGE_GAP;
const VIEWPORT = 725;

/** The scrollTop that puts `page`'s top on the scroller's top edge. */
const pageTop = (page: number) => PAGE_GAP + (page - 1) * PAGE_PITCH;
const maxScrollTop = (pages: number) => PAGE_GAP + pages * PAGE_PITCH - VIEWPORT;

let observers: FakeIntersectionObserver[] = [];

class FakeIntersectionObserver {
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    observers = observers.filter((o) => o !== this);
  }
  takeRecords() {
    return [];
  }
}

function box(top: number, height: number): DOMRect {
  return {top, bottom: top + height, height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({})};
}

const elapse = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/**
 * Give `scroller` and its pages the measured geometry, the scroller's top edge
 * `scrollerTop` px below the top of the window; return the browser's moves.
 */
function playBrowser(scroller: HTMLElement, pageSelector: string, scrollerTop = 0) {
  const pages = [...scroller.querySelectorAll<HTMLElement>(pageSelector)];
  Object.defineProperty(scroller, 'clientHeight', {configurable: true, value: VIEWPORT});
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    value: PAGE_GAP + pages.length * PAGE_PITCH,
  });
  scroller.getBoundingClientRect = () => box(scrollerTop, VIEWPORT);
  pages.forEach((page, i) => {
    page.getBoundingClientRect = () => box(scrollerTop + pageTop(i + 1) - scroller.scrollTop, PAGE_HEIGHT);
  });
  // The observer's root is the scroller's top half (rootMargin -50%).
  const rootBounds = box(scrollerTop, VIEWPORT / 2);
  const scrollTo = vi.fn();
  scroller.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];

  return {
    scrollTo,
    /** One animation frame: the scroller moves, then the observer reports. */
    frame(top: number) {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event('scroll'));
      // As in the browser, every entry rect is in window coordinates.
      const entries = pages.map((page) => {
        const rect = page.getBoundingClientRect();
        const isIntersecting = rect.top < rootBounds.bottom && rect.bottom > rootBounds.top;
        return {target: page, isIntersecting, boundingClientRect: rect, rootBounds} as unknown as IntersectionObserverEntry;
      });
      const observer = observers.at(-1);
      if (!observer) throw new Error('no IntersectionObserver is attached to the pages');
      act(() => observer.callback(entries, observer as unknown as IntersectionObserver));
    },
    /** The scroll comes to rest. */
    end() {
      act(() => {
        scroller.dispatchEvent(new Event('scrollend'));
      });
    },
  };
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  // jsdom has no Element.scrollTo. A no-op keeps a scroll requested before
  // playBrowser() installs its spy from crashing the render.
  HTMLElement.prototype.scrollTo = () => undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as {scrollTo?: unknown}).scrollTo;
});

describe('Viewer.Body page sync', () => {
  function renderBody(initial: {numPages: number; currentPage: number}, scrollerTop = 0) {
    const store = createViewerStore(initial);
    const {container} = render(
      <ViewerProvider store={store}>
        <Viewer.Body>
          <Viewer.Pages>{({number}) => <Viewer.Page pageNumber={number} />}</Viewer.Pages>
        </Viewer.Body>
      </ViewerProvider>,
    );
    const scroller = container.querySelector<HTMLElement>('[data-pdf-viewer-body]')!;
    const browser = playBrowser(scroller, '[data-page-number]', scrollerTop);
    elapse(1000); // nothing the mount started is still pending
    return {store, scroller, ...browser};
  }

  it('holds the requested page while a long smooth scroll is still travelling', () => {
    const {store, scroller, scrollTo, frame, end} = renderBody({numPages: 14, currentPage: 14});
    scroller.scrollTop = maxScrollTop(14);

    act(() => store.getState().actions.goToPage(7));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({top: pageTop(7), behavior: 'smooth'});

    // Past half a second the animation is still two pages short: page 9 is
    // the page nearest the top edge.
    elapse(600);
    frame(pageTop(9) - 154);
    expect(store.getState().currentPage).toBe(7);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    frame(pageTop(7));
    end();
    expect(store.getState().currentPage).toBe(7);

    // Settled, the observer is followed again — it was live all along.
    frame(pageTop(9));
    expect(store.getState().currentPage).toBe(9);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('follows a user scroll without scrolling back to the page top', () => {
    const {store, scrollTo, frame, end} = renderBody({numPages: 14, currentPage: 1});

    frame(pageTop(2) + PAGE_HEIGHT / 2);
    end();

    expect(store.getState().currentPage).toBe(2);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('measures the page nearest the top edge from the scroller, not the window', () => {
    // Where the Articles document panel puts the scroller: ~175px down the window.
    const {store, frame} = renderBody({numPages: 14, currentPage: 1}, 175);

    // Page 3's top is 300px below the scroller's top edge and page 2's is 558px
    // above it, so page 3 is nearer. Measured from the window's top instead
    // (475px against 383px), page 2 would win.
    frame(pageTop(3) - 300);

    expect(store.getState().currentPage).toBe(3);
  });

  it('publishes the page the user stopped on when they take over a navigation', () => {
    const {store, scrollTo, frame, end} = renderBody({numPages: 14, currentPage: 1});

    act(() => store.getState().actions.goToPage(7));
    frame(1200); // our smooth scroll has started…
    frame(pageTop(11) + 100); // …and the user flings past its target
    end();

    expect(store.getState().currentPage).toBe(11);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('does not hold the page sync for a navigation that needs no scroll', () => {
    // Already at page 14's top with a stale counter: a scroll to where the
    // scroller already is fires no scrollend, so a hold would never lift.
    const {store, scroller, scrollTo, frame} = renderBody({numPages: 14, currentPage: 13});
    scroller.scrollTop = pageTop(14);

    act(() => store.getState().actions.goToPage(14));
    frame(pageTop(12));

    expect(store.getState().currentPage).toBe(12);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  describe('where scrollend is unsupported', () => {
    let onscrollend: PropertyDescriptor | undefined;

    beforeEach(() => {
      onscrollend = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'onscrollend');
      delete (HTMLElement.prototype as {onscrollend?: unknown}).onscrollend;
    });

    afterEach(() => {
      if (onscrollend) Object.defineProperty(HTMLElement.prototype, 'onscrollend', onscrollend);
    });

    it('holds the requested page until scroll events stop arriving', () => {
      const {store, scroller, scrollTo, frame} = renderBody({numPages: 14, currentPage: 14});
      expect('onscrollend' in scroller).toBe(false);
      scroller.scrollTop = maxScrollTop(14);

      act(() => store.getState().actions.goToPage(7));
      // A janky animation: a frame every 100ms for 800ms.
      for (const top of [10900, 10000, 8800, 7600, 6726, 5900, 5400, pageTop(7)]) {
        elapse(100);
        frame(top);
        expect(store.getState().currentPage).toBe(7);
      }

      elapse(1000); // the scroller has gone quiet
      frame(pageTop(9));
      expect(store.getState().currentPage).toBe(9);
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });
  });
});

describe('<Reader> page sync', () => {
  const blocks: ReaderTextBlock[] = Array.from({length: 6}, (_, i) => ({
    id: `b${i + 1}`,
    pageNumber: i + 1,
    blockIndex: 0,
    text: `Body of page ${i + 1}.`,
    blockType: 'paragraph',
  }));

  function renderReader(currentPage: number) {
    const intoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const store = createViewerStore({mode: 'reader', numPages: blocks.length, currentPage});
    const {container} = render(
      <ViewerProvider store={store}>
        <div data-reader-scroll="">
          <Reader blocks={blocks} />
        </div>
      </ViewerProvider>,
    );
    const scroller = container.querySelector<HTMLElement>('[data-reader-scroll]')!;
    const browser = playBrowser(scroller, '[data-reader-page]');
    elapse(1000); // nothing the mount started is still pending
    intoView.mockClear();
    // Either API moves the scroller, so a stray scroll cannot hide behind the other.
    const scrollRequests = () => browser.scrollTo.mock.calls.length + intoView.mock.calls.length;
    return {store, scroller, scrollRequests, ...browser};
  }

  it('holds the requested page while a long smooth scroll is still travelling', () => {
    const {store, scroller, scrollRequests, frame, end} = renderReader(6);
    scroller.scrollTop = maxScrollTop(6);

    act(() => store.getState().actions.goToPage(2));
    expect(scrollRequests()).toBe(1);

    elapse(600);
    frame(pageTop(4) + 110); // page 4 is the page nearest the top edge
    expect(store.getState().currentPage).toBe(2);
    expect(scrollRequests()).toBe(1);

    frame(pageTop(2));
    end();
    expect(store.getState().currentPage).toBe(2);
    expect(scrollRequests()).toBe(1);
  });

  it('follows a user scroll without jumping to the page header', () => {
    const {store, scrollRequests, frame, end} = renderReader(1);

    frame(pageTop(2) + PAGE_HEIGHT / 2);
    end();

    expect(store.getState().currentPage).toBe(2);
    expect(scrollRequests()).toBe(0);
  });
});
