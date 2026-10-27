import {describe, expect, it} from 'vitest';

import {matchesSourceFilter} from '@/lib/articlesListDisplay';

describe('matchesSourceFilter', () => {
  it('matches a PubMed article case-insensitively', () => {
    expect(matchesSourceFilter('pubmed', ['PUBMED'])).toBe(true);
  });

  it('treats a missing source as MANUAL', () => {
    expect(matchesSourceFilter(null, ['MANUAL'])).toBe(true);
    expect(matchesSourceFilter(undefined, ['MANUAL'])).toBe(true);
  });

  it('rejects a source outside the selection', () => {
    expect(matchesSourceFilter('zotero', ['PUBMED'])).toBe(false);
  });

  it('matches RIS', () => {
    expect(matchesSourceFilter('RIS', ['RIS'])).toBe(true);
  });
});
