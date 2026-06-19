/**
 * Tests for CitationOverlay component.
 *
 * Strategy: wrap in ViewerProvider backed by a real createViewerStore, mock
 * usePageHandle to return a known page size (height=792), and assert rendered
 * box geometry or null render based on mode / anchor kind / page.
 *
 * Note: the overlay box is now focusable (tabIndex=-1, aria-label) and no
 * longer has aria-hidden — queries use tabIndex=-1 or firstElementChild.
 */
import {render} from '@testing-library/react';
import {createElement, type ReactNode} from 'react';
import {describe, expect, it, vi, beforeEach} from 'vitest';

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import type {Citation} from '../core/citation';

// Stub usePageHandle — returns a fixed 612×792 page handle.
vi.mock('../hooks/usePageHandle', () => ({
  usePageHandle: (_page: number) => ({
    pageNumber: _page,
    size: {width: 612, height: 792},
    render: vi.fn(),
    getTextContent: vi.fn(),
    renderTextLayer: vi.fn(),
    cleanup: vi.fn(),
  }),
}));

// Import component AFTER mock is registered.
const {CitationOverlay} = await import('../primitives/CitationOverlay');

// Helper to render CitationOverlay inside a ViewerProvider.
function renderWithStore(
  store: ReturnType<typeof createViewerStore>,
  pageNumber: number,
) {
  const wrapper = ({children}: {children: ReactNode}) =>
    createElement(ViewerProvider, {store}, children);
  return render(createElement(CitationOverlay, {pageNumber}), {wrapper});
}

// The active overlay box is now a focusable div (tabIndex=-1, aria-label).
// Helper to grab it from the container.
function getBox(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[tabindex="-1"]') as HTMLElement | null;
}

describe('<CitationOverlay>', () => {
  let store: ReturnType<typeof createViewerStore>;

  beforeEach(() => {
    store = createViewerStore();
  });

  it('renders a box with correct projected geometry for a REGION citation on the matching page', () => {
    // rect={x:100, y:200, width:150, height:50}, pageHeight=792, scale=1
    // expected: left=100, top=(792-200-50)*1=542, width=150, height=50
    const citation: Citation = {
      id: 'c1',
      anchor: {kind: 'region', page: 3, rect: {x: 100, y: 200, width: 150, height: 50}},
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('c1');

    const {container} = renderWithStore(store, 3);

    const box = getBox(container);
    expect(box).not.toBeNull();
    expect(box!.style.left).toBe('100px');
    expect(box!.style.top).toBe('542px');
    expect(box!.style.width).toBe('150px');
    expect(box!.style.height).toBe('50px');
    expect(box!.style.position).toBe('absolute');
    expect(box!.style.pointerEvents).toBe('none');
  });

  it('renders a box for a HYBRID citation on the matching page', () => {
    // rect={x:50, y:100, width:200, height:30}, pageHeight=792, scale=1
    // expected: left=50, top=(792-100-30)=662, width=200, height=30
    const citation: Citation = {
      id: 'c2',
      anchor: {
        kind: 'hybrid',
        range: {page: 2, charStart: 5, charEnd: 20},
        rect: {x: 50, y: 100, width: 200, height: 30},
        quote: 'some text',
      },
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('c2');

    const {container} = renderWithStore(store, 2);

    const box = getBox(container);
    expect(box).not.toBeNull();
    expect(box!.style.top).toBe('662px');
  });

  it('renders nothing for a TEXT-only citation (handled by TextLayer)', () => {
    const citation: Citation = {
      id: 'c3',
      anchor: {kind: 'text', range: {page: 1, charStart: 0, charEnd: 10}},
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('c3');

    const {container} = renderWithStore(store, 1);

    expect(getBox(container)).toBeNull();
  });

  it('renders nothing when active citation is on a DIFFERENT page', () => {
    const citation: Citation = {
      id: 'c4',
      anchor: {kind: 'region', page: 5, rect: {x: 0, y: 0, width: 100, height: 50}},
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('c4');

    // Render for page 3, citation is on page 5.
    const {container} = renderWithStore(store, 3);

    expect(getBox(container)).toBeNull();
  });

  it('renders nothing in READER mode', () => {
    const readerStore = createViewerStore({mode: 'reader'});
    const citation: Citation = {
      id: 'c5',
      anchor: {kind: 'region', page: 1, rect: {x: 0, y: 0, width: 100, height: 50}},
    };
    readerStore.getState().actions.addCitation(citation);
    readerStore.getState().actions.setActiveCitation('c5');

    const {container} = renderWithStore(readerStore, 1);

    expect(getBox(container)).toBeNull();
  });

  it('renders nothing when there is no active citation', () => {
    const {container} = renderWithStore(store, 1);
    expect(getBox(container)).toBeNull();
  });

  it('scales the projected rect with store.scale', () => {
    const scaledStore = createViewerStore({scale: 1.5});
    // rect={x:100, y:200, width:150, height:50}, pageHeight=792, scale=1.5
    // expected: left=150, top=(792-200-50)*1.5=813, width=225, height=75
    const citation: Citation = {
      id: 'c6',
      anchor: {kind: 'region', page: 2, rect: {x: 100, y: 200, width: 150, height: 50}},
    };
    scaledStore.getState().actions.addCitation(citation);
    scaledStore.getState().actions.setActiveCitation('c6');

    const {container} = renderWithStore(scaledStore, 2);

    const box = getBox(container);
    expect(box).not.toBeNull();
    expect(box!.style.left).toBe('150px');
    expect(box!.style.top).toBe('813px');
    expect(box!.style.width).toBe('225px');
    expect(box!.style.height).toBe('75px');
  });
});
