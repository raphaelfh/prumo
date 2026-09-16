import {describe, expect, it} from 'vitest';
import {buildPageText} from '../core/pageText';
import {buildMatchRanges} from '../primitives/searchHighlight';

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
