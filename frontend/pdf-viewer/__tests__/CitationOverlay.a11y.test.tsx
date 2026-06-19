/**
 * Accessibility tests for CitationOverlay.
 *
 * NOTE: The repo has no axe-core / jest-axe / vitest-axe harness installed.
 * These tests use focused role/aria assertions instead of a full automated
 * axe pass.  A future task should add `@axe-core/react` or `jest-axe` to the
 * devDependencies and convert these to `toHaveNoViolations()` sweeps.
 *
 * TDD: written before implementation changes to CitationOverlay.
 *
 * Covered behaviors:
 *   - Active overlay box is NOT aria-hidden (an aria-hidden focusable element
 *     is an a11y violation per WCAG 4.1.2).
 *   - Active overlay box has tabIndex=-1 (programmatically focusable).
 *   - Active overlay box has an aria-label (non-empty).
 *   - Active overlay box has pointer-events:none (visual-only, accessible).
 *   - Inactive / non-matching-page overlay renders nothing.
 */
import {render, act} from '@testing-library/react';
import {createElement, type ReactNode} from 'react';
import {describe, expect, it, vi, beforeEach} from 'vitest';

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import type {Citation} from '../core/citation';

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

const {CitationOverlay} = await import('../primitives/CitationOverlay');

function renderWithStore(
  store: ReturnType<typeof createViewerStore>,
  pageNumber: number,
) {
  const wrapper = ({children}: {children: ReactNode}) =>
    createElement(ViewerProvider, {store, children});
  return render(createElement(CitationOverlay, {pageNumber}), {wrapper});
}

function getBox(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[tabindex="-1"]') as HTMLElement | null;
}

describe('<CitationOverlay> — a11y (role/aria assertions)', () => {
  let store: ReturnType<typeof createViewerStore>;

  beforeEach(() => {
    store = createViewerStore();
    vi.clearAllMocks();
  });

  it('active box is NOT aria-hidden (focusable elements must not be aria-hidden)', () => {
    const citation: Citation = {
      id: 'a1',
      anchor: {kind: 'region', page: 1, rect: {x: 0, y: 0, width: 100, height: 50}},
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('a1');

    const {container} = renderWithStore(store, 1);

    const box = getBox(container);
    expect(box).not.toBeNull();
    // Must NOT be aria-hidden when it is the focusable active box.
    expect(box!.getAttribute('aria-hidden')).toBeNull();
  });

  it('active box has tabIndex=-1', () => {
    const citation: Citation = {
      id: 'a2',
      anchor: {kind: 'region', page: 1, rect: {x: 0, y: 0, width: 100, height: 50}},
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('a2');

    const {container} = renderWithStore(store, 1);
    const box = getBox(container);
    expect(box).not.toBeNull();
    expect(box!.tabIndex).toBe(-1);
  });

  it('active box has a non-empty aria-label', () => {
    const citation: Citation = {
      id: 'a3',
      anchor: {kind: 'region', page: 1, rect: {x: 0, y: 0, width: 100, height: 50}},
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('a3');

    const {container} = renderWithStore(store, 1);
    const box = getBox(container);
    expect(box).not.toBeNull();
    expect(box!.getAttribute('aria-label')).toBeTruthy();
    expect(box!.getAttribute('aria-label')!.length).toBeGreaterThan(0);
  });

  it('active box keeps pointer-events:none (visual only)', () => {
    const citation: Citation = {
      id: 'a4',
      anchor: {kind: 'region', page: 1, rect: {x: 0, y: 0, width: 100, height: 50}},
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('a4');

    const {container} = renderWithStore(store, 1);
    const box = getBox(container);
    expect(box).not.toBeNull();
    expect(box!.style.pointerEvents).toBe('none');
  });

  it('active box for HYBRID citation has aria-label and tabIndex=-1', () => {
    const citation: Citation = {
      id: 'a5',
      anchor: {
        kind: 'hybrid',
        range: {page: 2, charStart: 0, charEnd: 5},
        rect: {x: 10, y: 20, width: 100, height: 50},
        quote: 'test',
      },
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('a5');

    const {container} = renderWithStore(store, 2);
    const box = getBox(container);
    expect(box).not.toBeNull();
    expect(box!.tabIndex).toBe(-1);
    expect(box!.getAttribute('aria-label')).toBeTruthy();
    expect(box!.getAttribute('aria-hidden')).toBeNull();
  });

  it('receives focus on activation (useEffect calls .focus())', async () => {
    const citation: Citation = {
      id: 'a6',
      anchor: {kind: 'region', page: 1, rect: {x: 0, y: 0, width: 100, height: 50}},
    };

    await act(async () => {
      store.getState().actions.addCitation(citation);
      store.getState().actions.setActiveCitation('a6');
    });

    const {container} = renderWithStore(store, 1);

    const box = getBox(container);
    expect(box).not.toBeNull();
    // jsdom supports programmatic focus; after mount with an active citation
    // the useEffect fires and the box should be document.activeElement.
    expect(document.activeElement).toBe(box);
  });

  it('renders nothing when citation is on a different page', () => {
    const citation: Citation = {
      id: 'a7',
      anchor: {kind: 'region', page: 3, rect: {x: 0, y: 0, width: 100, height: 50}},
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('a7');

    const {container} = renderWithStore(store, 1);
    expect(getBox(container)).toBeNull();
  });
});
