import {describe, expect, it} from 'vitest';
import {buildPageText, normalizeQuery} from '../core/pageText';

describe('buildPageText', () => {
  it('breaks the line at hasEOL instead of gluing the words together', () => {
    // The pdf.js item stream carries line ends as `hasEOL`, not as text.
    const {text} = buildPageText([
      {text: 'validate clinical', hasEOL: true},
      {text: 'machine learning models locally on', hasEOL: true},
      {text: 'temporally stamped data'},
    ]);
    expect(text).toBe(
      'validate clinical machine learning models locally on temporally stamped data',
    );
  });

  it('rejoins a word hyphenated across a line break', () => {
    const {text} = buildPageText([{text: 'inter-', hasEOL: true}, {text: 'vention'}]);
    expect(text).toBe('intervention');
  });

  it('collapses whitespace runs and trims the page', () => {
    const {text} = buildPageText([{text: '  a   \t b  '}]);
    expect(text).toBe('a b');
  });

  it('folds ligatures and diacritics so the plain query matches', () => {
    const {text} = buildPageText([{text: 'the ﬁnal café re­sult'}]);
    expect(text).toBe('the final cafe result');
  });

  it('maps every emitted character back to its source item and offset', () => {
    const {text, sources} = buildPageText([{text: 'ab', hasEOL: true}, {text: 'cd'}]);
    expect(text).toBe('ab cd');
    expect(sources).toHaveLength(text.length);
    expect(sources[0]).toEqual({itemIndex: 0, offset: 0});
    expect(sources[1]).toEqual({itemIndex: 0, offset: 1});
    expect(sources[3]).toEqual({itemIndex: 1, offset: 0});
    expect(sources[4]).toEqual({itemIndex: 1, offset: 1});
  });

  it('keeps indices aligned with items the text layer renders as empty', () => {
    // pdf.js pushes an entry into textDivs for an empty item too; dropping it
    // here would shift every later itemIndex against the rendered divs.
    const {sources} = buildPageText([{text: 'a'}, {text: ''}, {text: 'b'}]);
    expect(sources.at(-1)).toEqual({itemIndex: 2, offset: 0});
  });

  it('normalizes the query the same way as the page text', () => {
    expect(normalizeQuery('  Café  ﬁn  ')).toBe('Cafe fin');
  });
});
