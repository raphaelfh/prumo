/**
 * ctrl/⌘ + wheel zooms around the pointer: the content under it stays put, the
 * zoom previews as a transform, and commits to the store when the wheel pauses.
 * jsdom has no layout, so the scroller's geometry is stubbed and animation
 * frames run at once. Trackpad and touch pinch are verified by hand (Task 16).
 */
import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';

const {Viewer} = await import('../primitives/Viewer');

const LETTER = {width: 612, height: 792};

beforeEach(() => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(725);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderViewer() {
  // fitWidth off: this test drives the zoom itself.
  const store = createViewerStore({numPages: 20, pageSizes: {1: LETTER}, fitWidth: false});
  const {container} = render(
    <ViewerProvider store={store}>
      <Viewer.Body>
        <Viewer.Pages>{({number}) => <Viewer.Page pageNumber={number} />}</Viewer.Pages>
      </Viewer.Body>
    </ViewerProvider>,
  );
  const scroller = container.querySelector<HTMLElement>('[data-pdf-viewer-body]')!;
  const pages = container.querySelector<HTMLElement>('[data-pdf-viewer-pages]')!;
  Object.defineProperty(scroller, 'clientWidth', {configurable: true, value: 800});
  Object.defineProperty(scroller, 'clientHeight', {configurable: true, value: 725});
  Object.defineProperty(scroller, 'scrollHeight', {configurable: true, value: 100000});
  scroller.getBoundingClientRect = () => ({left: 0, top: 100, right: 800, bottom: 825, width: 800, height: 725, x: 0, y: 100, toJSON: () => ({})});
  scroller.scrollTop = 1000;
  return {store, scroller, pages};
}

const ctrlWheel = (deltaY: number, clientX = 400, clientY = 400) =>
  new WheelEvent('wheel', {ctrlKey: true, deltaY, deltaMode: 0, clientX, clientY, bubbles: true, cancelable: true});

describe('ctrl/⌘ + wheel zoom', () => {
  it('previews the zoom around the pointer and commits it when the wheel pauses', () => {
    const {store, scroller, pages} = renderViewer();

    const event = ctrlWheel(-100); // one step in: 1 → 1.25
    act(() => {
      scroller.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(store.getState().isGesturing).toBe(true);
    expect(store.getState().zoom).toBe(1); // not committed yet
    expect(pages.style.transform).toBe('scale(1.25)');
    // The pointer is 400px right of and 300px below the scroller's corner. At
    // zoom 1 the 644px column is centred (78px inset), so it is over column
    // x=322, y=1300; at 1.25 the 805px column overflows the 800px viewport.
    expect(scroller.scrollTop).toBe(1300 * 1.25 - 300);
    expect(scroller.scrollLeft).toBe(322 * 1.25 - 400);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(store.getState().zoom).toBe(1.25);
    expect(store.getState().isGesturing).toBe(false);
    expect(store.getState().fitWidth).toBe(false);
    expect(pages.style.transform).toBe('');
    expect(scroller.scrollTop).toBe(1300 * 1.25 - 300);
  });

  it('lets a plain wheel scroll the document', () => {
    const {store, scroller} = renderViewer();
    const event = new WheelEvent('wheel', {deltaY: 40, bubbles: true, cancelable: true});
    act(() => {
      scroller.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(store.getState().isGesturing).toBe(false);
  });

  it('does not touch a ctrl + wheel outside the viewer', () => {
    const {store} = renderViewer();
    const event = ctrlWheel(-100);
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(store.getState().isGesturing).toBe(false);
  });
});

describe('a zoom that is not a gesture', () => {
  it('keeps the top of the viewport on the same content', () => {
    const {store, scroller} = renderViewer();
    act(() => store.getState().actions.setZoom(2));
    // Anchored at the top centre: column y=1000 stays at the top edge.
    expect(scroller.scrollTop).toBe(2000);
    expect(scroller.scrollLeft).toBe(322 * 2 - 400);
  });
});

/** A controllable ResizeObserver stub: captures the callback and `observe`
 * options, and lets a test fire a resize entry with a given border-box size. */
class ControllableResizeObserver {
  static instances: ControllableResizeObserver[] = [];
  callback: ResizeObserverCallback;
  options: ResizeObserverOptions | undefined;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ControllableResizeObserver.instances.push(this);
  }

  observe(_target: Element, options?: ResizeObserverOptions) {
    this.options = options;
  }

  unobserve() {}
  disconnect() {}

  fire(size: {width: number; height: number}) {
    const entry = {
      target: document.createElement('div'),
      borderBoxSize: [{inlineSize: size.width, blockSize: size.height}],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

describe('a scrollbar appearing during a gesture', () => {
  let originalResizeObserver: typeof ResizeObserver;

  beforeEach(() => {
    originalResizeObserver = global.ResizeObserver;
    ControllableResizeObserver.instances = [];
    global.ResizeObserver = ControllableResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
  });

  it('observes the scroller with the border-box box option', () => {
    renderViewer();
    const observer = ControllableResizeObserver.instances.at(-1)!;
    expect(observer.options).toEqual({box: 'border-box'});
  });

  it('keeps a gesture alive when only the content box shrinks (scrollbar appears)', () => {
    const {store, scroller, pages} = renderViewer();
    const observer = ControllableResizeObserver.instances.at(-1)!;
    act(() => observer.fire({width: 785, height: 725}));

    act(() => {
      scroller.dispatchEvent(ctrlWheel(-100)); // 1 -> 1.25
    });
    expect(store.getState().isGesturing).toBe(true);
    expect(pages.style.transform).toBe('scale(1.25)');

    // Border-box size unchanged (a scrollbar only shrinks the content box).
    act(() => observer.fire({width: 785, height: 725}));
    expect(store.getState().isGesturing).toBe(true);
    expect(pages.style.transform).toBe('scale(1.25)');

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(store.getState().zoom).toBe(1.25);
  });

  it('cancels a gesture when the viewer itself resizes (border box changes)', () => {
    const {store, scroller, pages} = renderViewer();
    const observer = ControllableResizeObserver.instances.at(-1)!;
    act(() => observer.fire({width: 785, height: 725}));
    const startScrollTop = scroller.scrollTop;

    act(() => {
      scroller.dispatchEvent(ctrlWheel(-100));
    });
    expect(store.getState().isGesturing).toBe(true);

    act(() => observer.fire({width: 785, height: 710}));

    expect(store.getState().isGesturing).toBe(false);
    expect(pages.style.transform).toBe('');
    expect(scroller.scrollTop).toBe(startScrollTop);
    expect(store.getState().zoom).toBe(1);
  });
});
