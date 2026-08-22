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

beforeEach(() => {
  scrollSpy.mockReset();
  (Element.prototype as unknown as {scrollIntoView: () => void}).scrollIntoView =
    scrollSpy;
});
afterEach(() => {
  delete (Element.prototype as unknown as {scrollIntoView?: () => void})
    .scrollIntoView;
});

interface ReaderTestProps {
  blocks: readonly ReaderTextBlock[];
  loading?: boolean;
}

/** Render <Reader> in a ViewerProvider; `update` rerenders with new props. */
function renderReader(store: ReturnType<typeof createViewerStore>, props: ReaderTestProps) {
  const ui = (p: ReaderTestProps) => (
    <ViewerProvider store={store}>
      <Reader blocks={p.blocks} loading={p.loading} />
    </ViewerProvider>
  );
  const {container, rerender} = render(ui(props));
  return {container, update: (p: ReaderTestProps) => rerender(ui(p))};
}

/** Fire a locate request for the b2 passage. */
function locateCohort(store: ReturnType<typeof createViewerStore>) {
  act(() => {
    store.getState().actions.locateInReader('prospective, multicenter cohort', 1);
  });
}

/** Capture the data-block-id of every scrollIntoView target. */
function trackScrolledIds(): (string | null)[] {
  const ids: (string | null)[] = [];
  scrollSpy.mockImplementation(function (this: HTMLElement) {
    ids.push(this.getAttribute?.('data-block-id') ?? null);
  });
  return ids;
}

async function expectFlash(container: HTMLElement, blockId: string) {
  const target = container.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
  expect(target).not.toBeNull();
  await waitFor(() => {
    expect(target!.className).toContain('bg-primary/15');
  });
}

describe('<Reader> markdown-first citation locate', () => {
  it('scrolls to and flashes the block matching a locate request', async () => {
    const store = createViewerStore({mode: 'reader'});
    const {container} = renderReader(store, {blocks});

    locateCohort(store);

    await expectFlash(container, 'b2');
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('does not flash any block when the quote matches nothing', async () => {
    const store = createViewerStore({mode: 'reader'});
    const {container} = renderReader(store, {blocks});

    act(() => {
      store.getState().actions.locateInReader('no such passage here', null);
    });

    await Promise.resolve();
    expect(container.querySelector('.bg-primary\\/15')).toBeNull();
  });
});

describe('<Reader> locate arriving before the blocks render', () => {
  it('replays a request that arrived while the reader had no blocks yet', async () => {
    const store = createViewerStore({mode: 'reader'});
    // Panel just opened: the text-blocks query has not resolved, so the reader
    // renders its empty state and has no block DOM.
    const {container, update} = renderReader(store, {blocks: []});

    locateCohort(store);

    // Blocks arrive.
    update({blocks});

    await expectFlash(container, 'b2');
  });

  it('replays a request stashed while the reader was still loading (composed first-click path)', async () => {
    // readerLoading spans the files-fetch window, so the common first-click
    // sequence is: loading (no <article>) → locate pending → one rerender flips
    // to rendered blocks → replay.
    const store = createViewerStore({mode: 'reader'});
    const {container, update} = renderReader(store, {blocks: [], loading: true});

    locateCohort(store);

    update({blocks, loading: false});

    await expectFlash(container, 'b2');
  });

  it('replays when only `loading` flips and the block identity never changes', async () => {
    // Strand-path guard: blocks arrive identity-stable during the loading render
    // (e.g. a consumer with placeholderData); only `loading` flips afterwards.
    // The replay effect must key on `loading` too, or the request is lost.
    const store = createViewerStore({mode: 'reader'});
    const {container, update} = renderReader(store, {blocks, loading: true});

    locateCohort(store);

    update({blocks, loading: false});

    await expectFlash(container, 'b2');
  });

  it('replays a pending request exactly once, not again on the next refetch', async () => {
    // Guards the served-nonce recording inside runLocate: without it every
    // later poll refetch re-scrolls the reader, hijacking the user.
    const scrolledBlocks = trackScrolledIds();
    const store = createViewerStore({mode: 'reader'});
    const {update} = renderReader(store, {blocks: []});

    locateCohort(store);

    // Blocks arrive → the pending request is replayed and served.
    update({blocks});
    await waitFor(() =>
      expect(scrolledBlocks.filter((id) => id === 'b2')).toHaveLength(1),
    );

    // A later poll refetch must NOT serve it a second time.
    update({blocks: [...blocks]});

    await Promise.resolve();
    expect(scrolledBlocks.filter((id) => id === 'b2')).toHaveLength(1);
  });

  it('does not replay a served request when the block list is refetched', async () => {
    // Count only scrolls to the CITED block: <ReaderInteractions> also scrolls
    // the current page's section on mount, which is not the locate path.
    const scrolledBlocks = trackScrolledIds();
    const store = createViewerStore({mode: 'reader'});
    const {update} = renderReader(store, {blocks});

    locateCohort(store);
    await waitFor(() =>
      expect(scrolledBlocks.filter((id) => id === 'b2')).toHaveLength(1),
    );

    // A poll refetch hands the reader a NEW array with the same content. The
    // request was already served, so this must not hijack the user's scroll.
    update({blocks: [...blocks]});

    await Promise.resolve();
    expect(scrolledBlocks.filter((id) => id === 'b2')).toHaveLength(1);
  });

  it('does not replay a genuine miss when the block list is refetched', async () => {
    const store = createViewerStore({mode: 'reader'});
    const {container, update} = renderReader(store, {blocks});

    act(() => {
      store.getState().actions.locateInReader('no such passage here', null);
    });
    await Promise.resolve();

    update({blocks: [...blocks]});

    await Promise.resolve();
    expect(container.querySelector('.bg-primary\\/15')).toBeNull();
  });

  it('drops a pending request that a document switch cleared', async () => {
    // Switching documents calls clearReaderLocate(); the pending request must
    // not survive it and fire the old document's citation at the new blocks.
    const store = createViewerStore({mode: 'reader'});
    const {container, update} = renderReader(store, {blocks: []});

    locateCohort(store);
    act(() => {
      store.getState().actions.clearReaderLocate();
    });

    // The newly-selected document's blocks arrive.
    update({blocks});

    await Promise.resolve();
    expect(container.querySelector('.bg-primary\\/15')).toBeNull();
  });

  it('serves a fresh locate issued after a document-switch clear', async () => {
    // The post-clear request must not collide with the pre-clear one (the
    // store's nonce survives clearReaderLocate) — otherwise the first locate
    // in the newly-selected document is silently dropped.
    const scrolledBlocks = trackScrolledIds();
    const store = createViewerStore({mode: 'reader'});
    const {container} = renderReader(store, {blocks});

    locateCohort(store);
    await waitFor(() =>
      expect(scrolledBlocks.filter((id) => id === 'b2')).toHaveLength(1),
    );

    act(() => {
      store.getState().actions.clearReaderLocate();
    });
    act(() => {
      store.getState().actions.locateInReader('Body of page two', 2);
    });

    await expectFlash(container, 'b3');
  });
});
