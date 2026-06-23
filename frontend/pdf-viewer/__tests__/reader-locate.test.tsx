import {act, render, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// jsdom does not implement scrollIntoView; install a spy-able stub.
const scrollSpy = vi.fn();

import {Reader, type ReaderTextBlock} from '../primitives/Reader';
import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';

const blocks: ReaderTextBlock[] = [
  {id: 'b1', pageNumber: 1, blockIndex: 0, text: 'Methods', blockType: 'heading'},
  {
    id: 'b2',
    pageNumber: 1,
    blockIndex: 1,
    text: 'SMART-CARE is a prospective, multicenter cohort study.',
    blockType: 'paragraph',
  },
  {id: 'b3', pageNumber: 2, blockIndex: 0, text: 'Body of page two.', blockType: 'paragraph'},
];

describe('<Reader> markdown-first citation locate', () => {
  beforeEach(() => {
    scrollSpy.mockReset();
    (Element.prototype as unknown as {scrollIntoView: () => void}).scrollIntoView =
      scrollSpy;
  });
  afterEach(() => {
    delete (Element.prototype as unknown as {scrollIntoView?: () => void})
      .scrollIntoView;
  });

  it('scrolls to and flashes the block matching a locate request', async () => {
    const store = createViewerStore({mode: 'reader'});
    const {container} = render(
      <ViewerProvider store={store}>
        <Reader blocks={blocks} />
      </ViewerProvider>,
    );

    act(() => {
      store.getState().actions.locateInReader('prospective, multicenter cohort', 1);
    });

    const target = container.querySelector<HTMLElement>('[data-block-id="b2"]');
    expect(target).not.toBeNull();
    await waitFor(() => {
      expect(target!.className).toContain('bg-primary/15');
    });
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('does not flash any block when the quote matches nothing', async () => {
    const store = createViewerStore({mode: 'reader'});
    const {container} = render(
      <ViewerProvider store={store}>
        <Reader blocks={blocks} />
      </ViewerProvider>,
    );

    act(() => {
      store.getState().actions.locateInReader('no such passage here', null);
    });

    await Promise.resolve();
    const flashed = container.querySelector('.bg-primary\\/15');
    expect(flashed).toBeNull();
  });
});
