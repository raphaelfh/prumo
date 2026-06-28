import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  READER_SEARCH_ACTIVE_HIGHLIGHT,
  READER_SEARCH_HIGHLIGHT,
  clearReaderSearchHighlights,
  computeRevealScroll,
  findReaderMatches,
  setReaderSearchHighlights,
} from '../readerSearch';

/** Build a reader-like root: an <article> with `[data-block-id]` blocks. */
function reader(...blocksHtml: string[]): HTMLElement {
  const root = document.createElement('article');
  root.innerHTML = blocksHtml
    .map((html, i) => `<div data-block-id="b${i}">${html}</div>`)
    .join('');
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('findReaderMatches', () => {
  it('finds every occurrence across blocks in document order', () => {
    const root = reader(
      '<p>The tumor was small.</p>',
      '<p>A second tumor appeared, then a third tumor.</p>',
    );
    const ranges = findReaderMatches(root, 'tumor', {
      caseSensitive: false,
      wholeWords: false,
    });
    expect(ranges).toHaveLength(3);
    for (const r of ranges) {
      expect(r.toString().toLowerCase()).toBe('tumor');
    }
  });

  it('is case-insensitive by default', () => {
    const root = reader('<p>Tumor TUMOR tumor</p>');
    const ranges = findReaderMatches(root, 'tumor', {
      caseSensitive: false,
      wholeWords: false,
    });
    expect(ranges).toHaveLength(3);
  });

  it('respects the case-sensitive option', () => {
    const root = reader('<p>Tumor TUMOR tumor</p>');
    const ranges = findReaderMatches(root, 'tumor', {
      caseSensitive: true,
      wholeWords: false,
    });
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('tumor');
  });

  it('respects the whole-words option', () => {
    const root = reader('<p>a tumor and a peritumoral region</p>');
    const all = findReaderMatches(root, 'tumor', {
      caseSensitive: false,
      wholeWords: false,
    });
    expect(all).toHaveLength(2); // "tumor" + the "tumor" inside "peritumoral"
    const wholeOnly = findReaderMatches(root, 'tumor', {
      caseSensitive: false,
      wholeWords: true,
    });
    expect(wholeOnly).toHaveLength(1);
    expect(wholeOnly[0].toString()).toBe('tumor');
  });

  it('matches a phrase split across inline markup', () => {
    const root = reader(
      '<p>elevated <strong>tumor mutational</strong> burden overall</p>',
    );
    const ranges = findReaderMatches(root, 'tumor mutational burden', {
      caseSensitive: false,
      wholeWords: false,
    });
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString().toLowerCase()).toContain('mutational');
  });

  it('matches phrases regardless of collapsed whitespace', () => {
    const root = reader('<p>were   FOLLOWED\n   for six months</p>');
    const ranges = findReaderMatches(root, 'were followed for', {
      caseSensitive: false,
      wholeWords: false,
    });
    expect(ranges).toHaveLength(1);
  });

  it('returns [] for an empty or whitespace query', () => {
    const root = reader('<p>some content here</p>');
    expect(findReaderMatches(root, '', {caseSensitive: false, wholeWords: false})).toEqual([]);
    expect(findReaderMatches(root, '   ', {caseSensitive: false, wholeWords: false})).toEqual([]);
  });

  it('ignores text outside [data-block-id] blocks (page-header chrome)', () => {
    const root = document.createElement('article');
    root.innerHTML =
      '<header>Page 1</header><div data-block-id="b0"><p>body text</p></div>';
    document.body.appendChild(root);
    // "Page" lives only in the chrome header → no match.
    expect(
      findReaderMatches(root, 'Page', {caseSensitive: false, wholeWords: false}),
    ).toHaveLength(0);
    expect(
      findReaderMatches(root, 'body', {caseSensitive: false, wholeWords: false}),
    ).toHaveLength(1);
  });

  it('does not match a phrase that spans two separate blocks', () => {
    const root = reader('<p>ends here</p>', '<p>here begins</p>');
    expect(
      findReaderMatches(root, 'here here', {caseSensitive: false, wholeWords: false}),
    ).toHaveLength(0);
  });
});

describe('computeRevealScroll', () => {
  // Scroller viewport occupies client-y [100, 700] (top=100, clientHeight=600);
  // comfortable band with margin 24 is [124, 676].
  const base = {scrollerTop: 100, clientHeight: 600, scrollTop: 0, margin: 24};

  it('does not scroll when the match is comfortably in view', () => {
    const r = computeRevealScroll({...base, rangeTop: 300, rangeHeight: 20});
    expect(r.needsScroll).toBe(false);
  });

  it('centers a match that is below the viewport', () => {
    const r = computeRevealScroll({...base, rangeTop: 2000, rangeHeight: 20});
    expect(r.needsScroll).toBe(true);
    // scrollTop + (rangeTop - scrollerTop) - (clientHeight - rangeHeight)/2
    expect(r.top).toBe(0 + (2000 - 100) - (600 - 20) / 2);
  });

  it('scrolls up for a match above the viewport', () => {
    const r = computeRevealScroll({...base, scrollTop: 500, rangeTop: 110, rangeHeight: 20});
    expect(r.needsScroll).toBe(true);
    expect(r.top).toBe(500 + (110 - 100) - (600 - 20) / 2);
  });

  it('aligns to the top (not center) for a match taller than the viewport', () => {
    const r = computeRevealScroll({...base, rangeTop: 1000, rangeHeight: 800});
    expect(r.needsScroll).toBe(true);
    expect(r.top).toBe(0 + (1000 - 100) - 24); // scrollTop + offset - margin
  });

  it('never returns a negative scroll target', () => {
    const r = computeRevealScroll({...base, scrollTop: 0, rangeTop: 110, rangeHeight: 20});
    expect(r.needsScroll).toBe(true);
    expect(r.top).toBe(0); // clamped from a negative center target
  });
});

describe('reader search highlight registry', () => {
  it('is a no-op (no throw) when the Highlight API is unsupported', () => {
    vi.stubGlobal('Highlight', undefined);
    const root = reader('<p>alpha beta gamma</p>');
    const ranges = findReaderMatches(root, 'beta', {caseSensitive: false, wholeWords: false});
    expect(() => setReaderSearchHighlights(ranges, 0)).not.toThrow();
    expect(() => clearReaderSearchHighlights()).not.toThrow();
  });

  it('registers all matches plus the active one when supported', () => {
    const store = new Map<string, unknown>();
    class FakeHighlight {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', {...(globalThis.CSS ?? {}), highlights: store});

    const root = reader('<p>alpha beta alpha</p>');
    const ranges = findReaderMatches(root, 'alpha', {caseSensitive: false, wholeWords: false});
    expect(ranges).toHaveLength(2);

    setReaderSearchHighlights(ranges, 1);
    expect(store.has(READER_SEARCH_HIGHLIGHT)).toBe(true);
    expect(store.has(READER_SEARCH_ACTIVE_HIGHLIGHT)).toBe(true);
    // The active registry holds exactly the active range.
    expect((store.get(READER_SEARCH_ACTIVE_HIGHLIGHT) as FakeHighlight).ranges).toEqual([
      ranges[1],
    ]);

    clearReaderSearchHighlights();
    expect(store.has(READER_SEARCH_HIGHLIGHT)).toBe(false);
    expect(store.has(READER_SEARCH_ACTIVE_HIGHLIGHT)).toBe(false);
  });
});
