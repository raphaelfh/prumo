/**
 * Guard: a table-cell citation locate highlights the cited cell block, not the
 * whole table. Each `table_cell` block renders as its own `<div data-block-id>`
 * so the locate path can flash exactly the cited cell.
 *
 * If this test breaks after a Reader refactor, it means per-cell rendering has
 * regressed — table_cell blocks must remain individually addressable by block-id.
 */
import {act, render, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {Reader, type ReaderTextBlock} from '../Reader';
import {ViewerProvider} from '../../core/context';
import {createViewerStore} from '../../core/store';

// jsdom does not implement scrollIntoView; install a no-op stub.
const scrollSpy = vi.fn();

const CELLS: ReaderTextBlock[] = [
  {id: 'c0', pageNumber: 1, blockIndex: 0, text: 'EPV', blockType: 'table_cell'},
  {id: 'c1', pageNumber: 1, blockIndex: 1, text: 'Value', blockType: 'table_cell'},
  {id: 'c2', pageNumber: 1, blockIndex: 2, text: 'ratio', blockType: 'table_cell'},
  {id: 'c3', pageNumber: 1, blockIndex: 3, text: '11.8', blockType: 'table_cell'},
];

describe('table cell citation locate', () => {
  beforeEach(() => {
    scrollSpy.mockReset();
    (Element.prototype as unknown as {scrollIntoView: () => void}).scrollIntoView = scrollSpy;
  });
  afterEach(() => {
    delete (Element.prototype as unknown as {scrollIntoView?: () => void}).scrollIntoView;
  });

  it('renders each table_cell as its own addressable block div', () => {
    const store = createViewerStore({mode: 'reader'});
    const {container} = render(
      <ViewerProvider store={store}>
        <Reader blocks={CELLS} />
      </ViewerProvider>,
    );

    // Every cell must have its own div with data-block-id and data-block-type
    for (const cell of CELLS) {
      const el = container.querySelector(`[data-block-id="${cell.id}"]`);
      expect(el, `block div for cell ${cell.id} should exist`).not.toBeNull();
      expect(el?.getAttribute('data-block-type')).toBe('table_cell');
    }
  });

  it('targets the cited cell block, not the whole table', async () => {
    const store = createViewerStore({mode: 'reader'});
    const {container} = render(
      <ViewerProvider store={store}>
        <Reader blocks={CELLS} />
      </ViewerProvider>,
    );

    // Locate c3 by (page=1, blockIndex=3) — the deterministic index path
    act(() => {
      store.getState().actions.locateInReader('11.8', 1, [3]);
    });

    // The cited cell receives the flash ring
    const citedCell = container.querySelector('[data-block-id="c3"]');
    expect(citedCell).not.toBeNull();
    await waitFor(() => {
      expect(citedCell!.className).toContain('ring-');
    });

    // The other cells must NOT be flashed
    for (const id of ['c0', 'c1', 'c2']) {
      const el = container.querySelector(`[data-block-id="${id}"]`);
      expect(el?.className, `cell ${id} should not be flashed`).not.toContain('bg-primary/15');
    }
  });
});
