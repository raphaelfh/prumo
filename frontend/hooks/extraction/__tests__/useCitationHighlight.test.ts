/**
 * Tests for useCitationHighlight hook.
 *
 * Uses a real ViewerProvider wrapping the hook, a stubbed document that
 * exposes numPages so goToPage clamping works, and a vi.mock for
 * usePageHandle (so no pdfjs / network required).
 */
import {renderHook, act} from '@testing-library/react';
import {createElement, type ReactNode} from 'react';
import {describe, expect, it, vi, beforeEach} from 'vitest';

import {ViewerProvider} from '@/pdf-viewer/core/context';
import {createViewerStore} from '@/pdf-viewer/core/store';

// --- stub usePageHandle to return a known page size ---
vi.mock('@/pdf-viewer/hooks/usePageHandle', () => ({
  usePageHandle: (_page: number) => ({
    pageNumber: _page,
    size: {width: 612, height: 792},
    render: vi.fn(),
    getTextContent: vi.fn(),
    renderTextLayer: vi.fn(),
    cleanup: vi.fn(),
  }),
}));

import {useCitationHighlight} from '../useCitationHighlight';

// Helper: render the hook inside a ViewerProvider backed by a store that
// has numPages set so goToPage clamping resolves to the right page.
function makeWrapper(storeRef: {current: ReturnType<typeof createViewerStore> | null}) {
  return function Wrapper({children}: {children: ReactNode}) {
    if (!storeRef.current) {
      storeRef.current = createViewerStore();
      // Simulate a loaded doc with 20 pages so goToPage doesn't clamp to 1.
      storeRef.current.getState().actions.setDocument({
        numPages: 20,
        fingerprint: 'test',
        metadata: async () => ({}),
        outline: async () => [],
        getPage: async () => {throw new Error('stub');},
        destroy: () => {},
      });
    }
    return createElement(ViewerProvider, {store: storeRef.current}, children);
  };
}

describe('useCitationHighlight', () => {
  const storeRef: {current: ReturnType<typeof createViewerStore> | null} = {current: null};

  beforeEach(() => {
    storeRef.current = null;
  });

  it('TextCitationAnchor: goToPage(range.page) and setSearchMatches with correct charStart/charEnd', () => {
    const wrapper = makeWrapper(storeRef);
    const {result} = renderHook(() => useCitationHighlight(), {wrapper});

    act(() => {
      result.current.highlight({
        kind: 'text',
        range: {page: 3, charStart: 10, charEnd: 42},
        quote: 'hello world',
      });
    });

    const state = storeRef.current!.getState();
    // Page navigation
    expect(state.currentPage).toBe(3);
    // Search match wired up
    expect(state.search.matches).toHaveLength(1);
    expect(state.search.matches[0]).toMatchObject({
      pageNumber: 3,
      charStart: 10,
      charEnd: 42,
      context: 'hello world',
    });
    // No projected rect for text-only
    expect(result.current.activeHighlight).toBeNull();
  });

  it('RegionCitationAnchor: goToPage(anchor.page), no search match, projected rect with Y-flip', () => {
    const wrapper = makeWrapper(storeRef);
    const {result} = renderHook(() => useCitationHighlight(), {wrapper});

    // scale=1 (default), pageHeight=792
    // rect = {x:100, y:200, width:150, height:50}
    // expected: left=100*1=100, top=(792-200-50)*1=542, width=150, height=50
    act(() => {
      result.current.highlight({
        kind: 'region',
        page: 5,
        rect: {x: 100, y: 200, width: 150, height: 50},
      });
    });

    const state = storeRef.current!.getState();
    expect(state.currentPage).toBe(5);
    // No text search
    expect(state.search.matches).toHaveLength(0);
    // Projected overlay rect
    expect(result.current.activeHighlight).not.toBeNull();
    expect(result.current.activeHighlight).toMatchObject({
      page: 5,
      left: 100,
      top: 542,
      width: 150,
      height: 50,
    });
  });

  it('RegionCitationAnchor: projected rect scales with store.scale', () => {
    const storeRef2: {current: ReturnType<typeof createViewerStore> | null} = {current: null};
    const wrapper = makeWrapper(storeRef2);
    // Set scale to 1.5 before render
    storeRef2.current = createViewerStore({scale: 1.5});
    storeRef2.current.getState().actions.setDocument({
      numPages: 20,
      fingerprint: 'test2',
      metadata: async () => ({}),
      outline: async () => [],
      getPage: async () => {throw new Error('stub');},
      destroy: () => {},
    });

    const {result} = renderHook(() => useCitationHighlight(), {
      wrapper: function W({children}: {children: ReactNode}) {
        return createElement(ViewerProvider, {store: storeRef2.current!}, children);
      },
    });

    act(() => {
      result.current.highlight({
        kind: 'region',
        page: 2,
        rect: {x: 100, y: 200, width: 150, height: 50},
      });
    });

    // scale=1.5: left=150, top=(792-200-50)*1.5=813, width=225, height=75
    expect(result.current.activeHighlight).toMatchObject({
      page: 2,
      left: 150,
      top: 813,
      width: 225,
      height: 75,
    });
  });

  it('HybridCitationAnchor: both text match AND projected rect', () => {
    const wrapper = makeWrapper(storeRef);
    const {result} = renderHook(() => useCitationHighlight(), {wrapper});

    act(() => {
      result.current.highlight({
        kind: 'hybrid',
        range: {page: 7, charStart: 5, charEnd: 20},
        rect: {x: 50, y: 100, width: 200, height: 30},
        quote: 'some text',
      });
    });

    const state = storeRef.current!.getState();
    expect(state.currentPage).toBe(7);
    // Text match
    expect(state.search.matches).toHaveLength(1);
    expect(state.search.matches[0]).toMatchObject({
      pageNumber: 7,
      charStart: 5,
      charEnd: 20,
      context: 'some text',
    });
    // Overlay rect: left=50, top=(792-100-30)*1=662, width=200, height=30
    expect(result.current.activeHighlight).toMatchObject({
      page: 7,
      left: 50,
      top: 662,
      width: 200,
      height: 30,
    });
  });

  it('clear() resets search, activeCitationId, and activeHighlight', () => {
    const wrapper = makeWrapper(storeRef);
    const {result} = renderHook(() => useCitationHighlight(), {wrapper});

    act(() => {
      result.current.highlight({
        kind: 'hybrid',
        range: {page: 2, charStart: 0, charEnd: 5},
        rect: {x: 10, y: 10, width: 50, height: 20},
        quote: 'test',
      });
    });

    act(() => {
      result.current.clear();
    });

    const state = storeRef.current!.getState();
    expect(state.search.matches).toHaveLength(0);
    expect(state.activeCitationId).toBeNull();
    expect(result.current.activeHighlight).toBeNull();
  });

  it('a second highlight() call replaces the previous (clears first)', () => {
    const wrapper = makeWrapper(storeRef);
    const {result} = renderHook(() => useCitationHighlight(), {wrapper});

    act(() => {
      result.current.highlight({
        kind: 'text',
        range: {page: 1, charStart: 0, charEnd: 5},
      });
    });

    act(() => {
      result.current.highlight({
        kind: 'text',
        range: {page: 2, charStart: 10, charEnd: 15},
      });
    });

    const state = storeRef.current!.getState();
    // Only the second highlight is active
    expect(state.search.matches).toHaveLength(1);
    expect(state.search.matches[0].pageNumber).toBe(2);
    expect(state.currentPage).toBe(2);
  });

  it('reader mode: still calls goToPage and setSearchMatches (no crash)', () => {
    const storeRef3: {current: ReturnType<typeof createViewerStore> | null} = {current: null};
    storeRef3.current = createViewerStore({mode: 'reader'});
    storeRef3.current.getState().actions.setDocument({
      numPages: 20,
      fingerprint: 'reader-test',
      metadata: async () => ({}),
      outline: async () => [],
      getPage: async () => {throw new Error('stub');},
      destroy: () => {},
    });

    const {result} = renderHook(() => useCitationHighlight(), {
      wrapper: function W({children}: {children: ReactNode}) {
        return createElement(ViewerProvider, {store: storeRef3.current!}, children);
      },
    });

    act(() => {
      result.current.highlight({
        kind: 'region',
        page: 3,
        rect: {x: 0, y: 0, width: 100, height: 50},
      });
    });

    const state = storeRef3.current.getState();
    expect(state.currentPage).toBe(3);
    // In reader mode the overlay rect is null (no canvas surface)
    expect(result.current.activeHighlight).toBeNull();
  });
});
