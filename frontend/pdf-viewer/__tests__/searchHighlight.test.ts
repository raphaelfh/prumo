import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {buildPageText} from '../core/pageText';
import {
  buildMatchRanges,
  clearPageSearchHighlights,
  PDF_SEARCH_ACTIVE_HIGHLIGHT,
  PDF_SEARCH_HIGHLIGHT,
  setPageSearchHighlights,
} from '../primitives/searchHighlight';

/** A stand-in for the spans pdf.js paints: one div per text item, in order. */
function paint(items: readonly {text: string; hasEOL?: boolean}[]): HTMLElement[] {
  const container = document.createElement('div');
  return items.map((item) => {
    const div = document.createElement('span');
    div.textContent = item.text;
    // pdf.js only appends a div that has text; the array keeps every item.
    if (item.text) container.appendChild(div);
    return div;
  });
}

describe('buildMatchRanges', () => {
  it('spans only the matched characters, not the whole line', () => {
    const items = [{text: 'Confidence sensitivity endpoint baseline regression'}];
    const pageText = buildPageText(items);
    const start = pageText.text.indexOf('baseline');
    const ranges = buildMatchRanges(pageText, paint(items), start, start + 'baseline'.length);

    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('baseline');
  });

  it('splits a match that straddles two items into one range per item', () => {
    const items = [{text: 'machine', hasEOL: true}, {text: 'learning'}];
    const pageText = buildPageText(items);
    const ranges = buildMatchRanges(pageText, paint(items), 0, pageText.text.length);

    expect(ranges.map((r) => r.toString())).toEqual(['machine', 'learning']);
  });

  it('maps through a folded ligature back onto the single source character', () => {
    const items = [{text: 'the ﬁnal page'}];
    const pageText = buildPageText(items);
    const start = pageText.text.indexOf('final');
    const ranges = buildMatchRanges(pageText, paint(items), start, start + 'final'.length);

    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('ﬁnal');
  });

  it('ignores an item the text layer painted as empty', () => {
    const items = [{text: 'alpha'}, {text: ''}, {text: ' beta'}];
    const pageText = buildPageText(items);
    const start = pageText.text.indexOf('beta');
    const ranges = buildMatchRanges(pageText, paint(items), start, start + 'beta'.length);

    expect(ranges.map((r) => r.toString())).toEqual(['beta']);
  });

  it('never builds a range past the end of a span (the line-break space)', () => {
    const items = [{text: 'alpha', hasEOL: true}, {text: 'beta'}];
    const pageText = buildPageText(items);
    // 'alpha beta' — the space is attributed one past 'alpha' s last character.
    expect(() => buildMatchRanges(pageText, paint(items), 0, pageText.text.length)).not.toThrow();
  });
});

describe('the document-wide highlight registry', () => {
  // `CSS.highlights` is one registry for the whole document, so every mounted
  // page publishes into the same two entries. `byContainer` exists so two
  // viewers on screen cannot clobber each other — this is the test for that
  // invariant. jsdom implements neither `Highlight` nor `CSS.highlights`.
  let highlights: Map<string, {ranges: Range[]; priority?: number}>;

  beforeEach(() => {
    highlights = new Map();
    vi.stubGlobal(
      'Highlight',
      class {
        ranges: Range[];
        priority?: number;
        constructor(...ranges: Range[]) {
          this.ranges = ranges;
        }
      },
    );
    vi.stubGlobal('CSS', {highlights});
  });

  // `byContainer` is module state that outlives a test, so every container a
  // test registers is unregistered again here.
  const registered: HTMLElement[] = [];

  afterEach(() => {
    for (const container of registered.splice(0)) {
      clearPageSearchHighlights(container);
      container.remove();
    }
    vi.unstubAllGlobals();
  });

  const rangeIn = (text: string): {container: HTMLElement; range: Range} => {
    const container = document.createElement('div');
    container.textContent = text;
    document.body.append(container);
    registered.push(container);
    const range = document.createRange();
    range.selectNodeContents(container);
    return {container, range};
  };

  it('merges both pages rather than letting the second replace the first', () => {
    const a = rangeIn('page one');
    const b = rangeIn('page two');

    setPageSearchHighlights(a.container, [a.range], []);
    setPageSearchHighlights(b.container, [b.range], []);

    expect(highlights.get(PDF_SEARCH_HIGHLIGHT)?.ranges).toHaveLength(2);
  });

  it('clearing one page leaves the other page painted', () => {
    const a = rangeIn('page one');
    const b = rangeIn('page two');
    setPageSearchHighlights(a.container, [a.range], []);
    setPageSearchHighlights(b.container, [b.range], []);

    clearPageSearchHighlights(a.container);

    const left = highlights.get(PDF_SEARCH_HIGHLIGHT)?.ranges;
    expect(left).toHaveLength(1);
    expect(left?.[0]).toBe(b.range);
  });

  it('removes the entry entirely once the last page clears', () => {
    const a = rangeIn('page one');
    setPageSearchHighlights(a.container, [a.range], []);
    clearPageSearchHighlights(a.container);

    expect(highlights.has(PDF_SEARCH_HIGHLIGHT)).toBe(false);
  });

  it('paints the active match over the others', () => {
    const a = rangeIn('page one');
    setPageSearchHighlights(a.container, [a.range], [a.range]);

    expect(highlights.get(PDF_SEARCH_ACTIVE_HIGHLIGHT)?.priority).toBe(1);
  });

  it('does not throw when the browser has no Highlight API', () => {
    vi.stubGlobal('CSS', undefined);
    vi.stubGlobal('Highlight', undefined);
    const a = rangeIn('page one');

    expect(() => setPageSearchHighlights(a.container, [a.range], [])).not.toThrow();
    expect(() => clearPageSearchHighlights(a.container)).not.toThrow();
  });
});
