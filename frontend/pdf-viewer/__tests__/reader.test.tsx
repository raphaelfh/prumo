import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Reader, type ReaderTextBlock} from '../primitives/Reader';
import {createViewerStore} from '../core/store';

describe('<Reader>', () => {
  const blocks: ReaderTextBlock[] = [
    {id: 'b1', pageNumber: 1, blockIndex: 0, text: 'Title', blockType: 'heading'},
    {id: 'b2', pageNumber: 1, blockIndex: 1, text: 'First paragraph.', blockType: 'paragraph'},
    {id: 'b3', pageNumber: 2, blockIndex: 0, text: 'Second-page heading', blockType: 'heading'},
    {id: 'b4', pageNumber: 2, blockIndex: 1, text: 'Body of page two.', blockType: 'paragraph'},
  ];

  it('renders an EmptyState when blocks is empty and not loading', () => {
    render(<Reader blocks={[]} />);
    expect(screen.getByTestId('reader-empty')).toBeInTheDocument();
  });

  it('renders a polite live-region when loading', () => {
    render(<Reader blocks={[]} loading />);
    const status = screen.getByTestId('reader-loading');
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('groups blocks by page with a per-page header', () => {
    render(<Reader blocks={blocks} />);
    const sections = screen.getAllByLabelText(/^Page \d+$/);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toHaveAttribute('data-reader-page', '1');
    expect(sections[1]).toHaveAttribute('data-reader-page', '2');
  });

  it('annotates each block with id + type for downstream selection', () => {
    const {container} = render(<Reader blocks={blocks} />);
    const items = container.querySelectorAll<HTMLElement>('[data-block-id]');
    expect(items).toHaveLength(4);
    expect(items[0].dataset.blockId).toBe('b1');
    expect(items[0].dataset.blockType).toBe('heading');
    expect(items[2].dataset.blockType).toBe('heading');
    expect(items[3].dataset.blockType).toBe('paragraph');
  });

  it('groups even when input is unsorted (defensive)', () => {
    const shuffled = [blocks[3], blocks[0], blocks[2], blocks[1]];
    render(<Reader blocks={shuffled} />);
    const sections = screen.getAllByLabelText(/^Page \d+$/);
    // Pages still appear in sorted order even when input is shuffled.
    expect(sections[0]).toHaveAttribute('data-reader-page', '1');
    expect(sections[1]).toHaveAttribute('data-reader-page', '2');
  });
});

describe('store: ViewerMode', () => {
  it('defaults to canvas mode', () => {
    const store = createViewerStore();
    expect(store.getState().mode).toBe('canvas');
  });

  it('setMode flips to reader and back', () => {
    const store = createViewerStore();
    store.getState().actions.setMode('reader');
    expect(store.getState().mode).toBe('reader');
    store.getState().actions.setMode('canvas');
    expect(store.getState().mode).toBe('canvas');
  });

  it('initial override seeds mode', () => {
    const store = createViewerStore({mode: 'reader'});
    expect(store.getState().mode).toBe('reader');
  });

  it('reset() restores the initial-supplied mode (not the module default)', () => {
    const store = createViewerStore({mode: 'reader'});
    store.getState().actions.setMode('canvas');
    store.getState().actions.reset();
    expect(store.getState().mode).toBe('reader');
  });
});
