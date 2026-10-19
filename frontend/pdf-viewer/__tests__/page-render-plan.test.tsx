/**
 * The page render plan: the zoom, scale, rotation and settling policy every
 * layer of a page paints by, derived once. `planPageRender` is the pure
 * geometry; `usePageRenderPlan` adds the gesture gate and the settle delay.
 */
import {act, renderHook} from '@testing-library/react';
import type {ReactNode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {ViewerProvider} from '../core/context';
import type {PDFPageHandle, PageRotation} from '../core/engine';
import {createViewerStore} from '../core/store';
import {createMockEngine} from '../engines/mock';
import {planPageRender, usePageRenderPlan} from '../primitives/pageRenderPlan';

const LETTER = {width: 612, height: 792};

async function mockHandle(opts: {size?: {width: number; height: number}; rotation?: PageRotation} = {}): Promise<PDFPageHandle> {
  const engine = createMockEngine({numPages: 1, pageSize: opts.size ?? LETTER, rotation: opts.rotation ?? 0});
  const doc = await engine.load({kind: 'url', url: 'mock.pdf'});
  return doc.getPage(1);
}

describe('planPageRender', () => {
  it('draws the canvas at zoom × devicePixelRatio and the text layer at CSS zoom', async () => {
    const plan = planPageRender({handle: await mockHandle(), zoom: 1.5, viewRotation: 0, devicePixelRatio: 2, settled: true});
    expect(plan.devicePixelScale).toBe(3);
    expect(plan.cssZoom).toBe(1.5);
    expect(plan.cssSize).toEqual({width: 918, height: 1188});
  });

  it('caps the device pixel ratio at 2', async () => {
    const plan = planPageRender({handle: await mockHandle(), zoom: 1, viewRotation: 0, devicePixelRatio: 3, settled: true});
    expect(plan.devicePixelScale).toBe(2);
  });

  it('keeps the canvas backing store inside 16 777 216 pixels', async () => {
    const plan = planPageRender({handle: await mockHandle(), zoom: 4, viewRotation: 0, devicePixelRatio: 3, settled: true});
    // Precondition: the budget, not the ratio cap, is what binds here.
    expect(plan.devicePixelScale).toBeGreaterThan(4);
    expect(plan.devicePixelScale).toBeLessThan(8);
    const {devicePixelScale: scale} = plan;
    // At the cap the product equals the budget up to float rounding.
    expect(LETTER.width * scale * LETTER.height * scale).toBeLessThanOrEqual(16_777_216 + 1);
  });

  it('treats a missing devicePixelRatio as 1', async () => {
    const plan = planPageRender({handle: await mockHandle(), zoom: 2, viewRotation: 0, devicePixelRatio: 0, settled: true});
    expect(plan.devicePixelScale).toBe(2);
  });

  it('swaps the CSS box for a quarter view rotation', async () => {
    const plan = planPageRender({handle: await mockHandle(), zoom: 1.5, viewRotation: 90, devicePixelRatio: 1, settled: true});
    expect(plan.rotation).toBe(90);
    expect(plan.cssSize).toEqual({width: 1188, height: 918});
  });

  it('adds the view rotation to the page’s own /Rotate and keeps a /Rotate 90 page landscape', async () => {
    const landscape = await mockHandle({size: {width: 800, height: 600}, rotation: 90});
    const own = planPageRender({handle: landscape, zoom: 1.5, viewRotation: 0, devicePixelRatio: 1, settled: true});
    expect(own.rotation).toBe(90);
    expect(own.cssSize).toEqual({width: 1200, height: 900});

    const turned = planPageRender({handle: landscape, zoom: 1.5, viewRotation: 90, devicePixelRatio: 1, settled: true});
    expect(turned.rotation).toBe(180);
    expect(turned.cssSize).toEqual({width: 900, height: 1200});
  });
});

describe('usePageRenderPlan', () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function mountPlan(zoom = 1) {
    const engine = createMockEngine({numPages: 1, pageSize: LETTER});
    const store = createViewerStore({zoom, fitWidth: false});
    store.getState().actions.setDocument(await engine.load({kind: 'url', url: 'mock.pdf'}));
    const wrapper = ({children}: {children: ReactNode}) => <ViewerProvider store={store}>{children}</ViewerProvider>;
    const hook = renderHook(() => usePageRenderPlan(1), {wrapper});
    return {store, hook};
  }

  /** The page handle resolves. */
  const resolveHandle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

  async function renderPlan(zoom = 1) {
    const mounted = await mountPlan(zoom);
    await resolveHandle();
    return mounted;
  }

  it('has no plan until the page handle resolves, then settles the first paint at once', async () => {
    const {hook} = await mountPlan();
    expect(hook.result.current).toBeNull();

    await resolveHandle();
    expect(hook.result.current?.settled).toBe(true);
    expect(hook.result.current?.handle.pageNumber).toBe(1);
  });

  it('holds a burst of zoom changes unsettled and settles 100ms after the last', async () => {
    const {store, hook} = await renderPlan();
    for (const zoom of [1.1, 1.2, 1.3, 1.4, 1.5]) {
      act(() => store.getState().actions.setZoom(zoom));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      // The plan already carries the new geometry: the canvas lays out at it while the old bitmap stretches.
      expect(hook.result.current).toMatchObject({settled: false, cssZoom: zoom});
    }

    // 20ms of the delay have passed since the last change.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(79);
    });
    expect(hook.result.current?.settled).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(hook.result.current).toMatchObject({settled: true, cssZoom: 1.5});
  });

  it('is unsettled during a gesture and settles with the committed zoom once it ends', async () => {
    const {store, hook} = await renderPlan();
    act(() => store.getState().actions.setGesturing(true));
    expect(hook.result.current?.settled).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(hook.result.current?.settled).toBe(false);

    act(() => {
      store.getState().actions.setZoom(2);
      store.getState().actions.setGesturing(false);
    });
    expect(hook.result.current).toMatchObject({settled: false, cssZoom: 2});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(hook.result.current).toMatchObject({settled: true, cssZoom: 2, devicePixelScale: 2});
  });

  it('settles a rotation change after the same delay', async () => {
    const {store, hook} = await renderPlan();
    act(() => store.getState().actions.rotateView());
    expect(hook.result.current).toMatchObject({settled: false, rotation: 90, cssSize: {width: 792, height: 612}});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(hook.result.current).toMatchObject({settled: true, rotation: 90});
  });

  it('reads the screen’s devicePixelRatio', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const {hook} = await renderPlan(1.5);
    expect(hook.result.current).toMatchObject({cssZoom: 1.5, devicePixelScale: 3});
  });
});
