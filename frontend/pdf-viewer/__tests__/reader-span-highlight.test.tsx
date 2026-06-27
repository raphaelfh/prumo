import {act, render, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {Reader, type ReaderTextBlock} from '../primitives/Reader';
import {CITATION_HIGHLIGHT_NAME} from '../primitives/spanHighlight';
import {ViewerProvider} from '../core/context';
import {createViewerStore} from '../core/store';

const scrollSpy = vi.fn();

const blocks: ReaderTextBlock[] = [
  {
    id: 'b1',
    pageNumber: 1,
    blockIndex: 0,
    text: 'SMART-CARE is a prospective, multicenter cohort study.',
    blockType: 'paragraph',
  },
];

class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

beforeEach(() => {
  scrollSpy.mockReset();
  (Element.prototype as unknown as {scrollIntoView: () => void}).scrollIntoView =
    scrollSpy;
});
afterEach(() => {
  delete (Element.prototype as unknown as {scrollIntoView?: () => void})
    .scrollIntoView;
  vi.unstubAllGlobals();
});

describe('<Reader> precise span highlight (CSS Custom Highlight API)', () => {
  it('registers a citation-quote highlight when supported and the quote is found', async () => {
    const store = new Map<string, unknown>();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', {...(globalThis.CSS ?? {}), highlights: store});

    const viewer = createViewerStore({mode: 'reader'});
    render(
      <ViewerProvider store={viewer}>
        <Reader blocks={blocks} />
      </ViewerProvider>,
    );

    act(() => {
      viewer.getState().actions.locateInReader('prospective, multicenter cohort', 1);
    });

    await waitFor(() => {
      expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(true);
    });
  });

  it('falls back to block-flash (no throw, no highlight) when the API is unsupported', async () => {
    vi.stubGlobal('Highlight', undefined);
    // CSS may exist but without `highlights`; emulate an unsupported browser.
    vi.stubGlobal('CSS', {escape: (s: string) => s});

    const viewer = createViewerStore({mode: 'reader'});
    const {container} = render(
      <ViewerProvider store={viewer}>
        <Reader blocks={blocks} />
      </ViewerProvider>,
    );

    act(() => {
      viewer.getState().actions.locateInReader('prospective, multicenter cohort', 1);
    });

    // Block-flash (the existing behaviour) still happens — no regression.
    const target = container.querySelector<HTMLElement>('[data-block-id="b1"]');
    await waitFor(() => {
      expect(target!.className).toContain('bg-primary/15');
    });
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('does not register a highlight when the quote is not found in the DOM', async () => {
    // Fake timers so the flash setTimeout this locate schedules cannot leak a
    // live real timer into later tests; vi.useRealTimers() discards it.
    vi.useFakeTimers();
    const store = new Map<string, unknown>();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', {...(globalThis.CSS ?? {}), highlights: store});

    const viewer = createViewerStore({mode: 'reader'});
    render(
      <ViewerProvider store={viewer}>
        <Reader blocks={blocks} />
      </ViewerProvider>,
    );

    // Locate resolves to block b1 by page, but this quote is not in its text.
    act(() => {
      viewer.getState().actions.locateInReader('a passage absent from the block', 1);
    });

    expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(false);
    vi.useRealTimers();
  });

  it('clears the highlight when the flash timer elapses', async () => {
    vi.useFakeTimers();
    const store = new Map<string, unknown>();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', {...(globalThis.CSS ?? {}), highlights: store});

    const viewer = createViewerStore({mode: 'reader'});
    render(
      <ViewerProvider store={viewer}>
        <Reader blocks={blocks} />
      </ViewerProvider>,
    );

    act(() => {
      viewer.getState().actions.locateInReader('prospective, multicenter cohort', 1);
    });
    expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000); // > FLASH_MS (1800)
    });
    expect(store.has(CITATION_HIGHLIGHT_NAME)).toBe(false);

    vi.useRealTimers();
  });
});
