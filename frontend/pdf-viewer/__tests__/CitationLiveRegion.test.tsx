/**
 * Tests for CitationLiveRegion — the aria-live jump announcement component.
 *
 * TDD: these tests are written before the implementation.
 * Expected behaviors:
 *   - No active citation → live region is empty.
 *   - Active region/hybrid citation on page N → announces
 *     "Jumped to cited source on page N".
 *   - Active text citation on page N → also announces (mode-independent).
 *   - Changing active citation updates the announcement.
 *   - The region has aria-live="polite" and is visually hidden (sr-only).
 */
import {render, act} from '@testing-library/react';
import {createElement, type ReactNode} from 'react';
import {describe, expect, it, beforeEach} from 'vitest';

import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';
import type {Citation} from '../core/citation';

// Import after store is available
const {CitationLiveRegion} = await import('../primitives/CitationLiveRegion');

function renderWithStore(
  store: ReturnType<typeof createViewerStore>,
) {
  const wrapper = ({children}: {children: ReactNode}) =>
    createElement(ViewerProvider, {store}, children);
  return render(createElement(CitationLiveRegion, {}), {wrapper});
}

describe('<CitationLiveRegion>', () => {
  let store: ReturnType<typeof createViewerStore>;

  beforeEach(() => {
    store = createViewerStore();
  });

  it('renders a polite aria-live region', () => {
    const {container} = renderWithStore(store);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
  });

  it('is empty when there is no active citation', () => {
    const {container} = renderWithStore(store);
    const region = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(region.textContent).toBe('');
  });

  it('announces the page when a REGION citation becomes active', () => {
    const citation: Citation = {
      id: 'live1',
      anchor: {kind: 'region', page: 4, rect: {x: 0, y: 0, width: 100, height: 50}},
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('live1');

    const {container} = renderWithStore(store);
    const region = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(region.textContent).toContain('4');
    // Should contain a "Jumped to" / "page" style announcement
    expect(region.textContent).toMatch(/jump|cited|source|page/i);
  });

  it('announces for a HYBRID citation', () => {
    const citation: Citation = {
      id: 'live2',
      anchor: {
        kind: 'hybrid',
        range: {page: 7, charStart: 0, charEnd: 10},
        rect: {x: 0, y: 0, width: 100, height: 50},
        quote: 'test',
      },
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('live2');

    const {container} = renderWithStore(store);
    const region = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(region.textContent).toContain('7');
  });

  it('announces for a TEXT citation (mode-independent)', () => {
    const citation: Citation = {
      id: 'live3',
      anchor: {kind: 'text', range: {page: 2, charStart: 0, charEnd: 5}},
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('live3');

    const {container} = renderWithStore(store);
    const region = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(region.textContent).toContain('2');
  });

  it('clears the announcement when citation is cleared', async () => {
    const citation: Citation = {
      id: 'live4',
      anchor: {kind: 'region', page: 5, rect: {x: 0, y: 0, width: 100, height: 50}},
    };
    store.getState().actions.addCitation(citation);
    store.getState().actions.setActiveCitation('live4');

    const {container} = renderWithStore(store);

    // Wrap the store mutation in act so React flushes the re-render.
    await act(async () => {
      store.getState().actions.clearCitations();
    });

    const region = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(region.textContent).toBe('');
  });

  it('is visually hidden (has sr-only class or equivalent style)', () => {
    const {container} = renderWithStore(store);
    const region = container.querySelector('[aria-live="polite"]') as HTMLElement;
    // Should have sr-only class or position:absolute style for screen-reader-only
    const hasSrOnly = region.className.includes('sr-only');
    const hasAbsolutePosition =
      region.style.position === 'absolute' ||
      getComputedStyle(region).position === 'absolute';
    expect(hasSrOnly || hasAbsolutePosition).toBe(true);
  });
});
