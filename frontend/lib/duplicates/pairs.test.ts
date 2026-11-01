import {describe, expect, it} from 'vitest';

import {
  differingFields,
  findSelectedPair,
  pairKey,
  pairsInView,
  selectAcceptableExact,
  viewCounts,
} from '@/lib/duplicates/pairs';
import type {DuplicatePair, DuplicatesRead} from '@/services/duplicatesService';

type Side = DuplicatePair['kept'];

function side(id: string, over: Partial<Side> = {}): Side {
  return {
    article_id: id,
    title: `Title ${id}`,
    authors: ['A'],
    publication_year: 2020,
    journal_title: 'J',
    doi: null,
    pmid: null,
    ingestion_source: 'PUBMED',
    has_pdf: false,
    has_abstract: true,
    screening_decisions: 0,
    has_review_work: false,
    ...over,
  };
}

function pair(
  removed: string,
  kept: string,
  over: Partial<DuplicatePair> = {},
  removedOver: Partial<Side> = {},
  keptOver: Partial<Side> = {},
): DuplicatePair {
  return {
    article_id: removed,
    kept_article_id: kept,
    tier: 'exact',
    basis: 'pmid',
    match_label: 'pmid',
    removed: side(removed, removedOver),
    kept: side(kept, keptOver),
    ...over,
  };
}

const read = (open: DuplicatePair[], resolved: DuplicatePair[] = []): DuplicatesRead => ({open, resolved});

describe('pairKey', () => {
  it('joins removed and kept ids', () => {
    expect(pairKey({article_id: 'a', kept_article_id: 'b'})).toBe('a~b');
  });
});

describe('pairsInView and viewCounts', () => {
  const data = read(
    [pair('a', 'b'), pair('c', 'd', {tier: 'likely'}), pair('e', 'f', {tier: 'possible'}), pair('g', 'h')],
    [pair('x', 'y', {verdict: 'distinct', tier: null})],
  );

  it('filters open pairs by tier and returns resolved separately', () => {
    expect(pairsInView(data, 'open')).toHaveLength(4);
    expect(pairsInView(data, 'exact').map(pairKey)).toEqual(['a~b', 'g~h']);
    expect(pairsInView(data, 'likely').map(pairKey)).toEqual(['c~d']);
    expect(pairsInView(data, 'possible').map(pairKey)).toEqual(['e~f']);
    expect(pairsInView(data, 'resolved').map(pairKey)).toEqual(['x~y']);
  });

  it('counts each view', () => {
    expect(viewCounts(data)).toEqual({open: 4, exact: 2, likely: 1, possible: 1, resolved: 1});
  });
});

describe('findSelectedPair', () => {
  const data = read([pair('a', 'b'), pair('c', 'a')], [pair('x', 'y', {verdict: 'duplicate'})]);

  it('matches both ids, open or resolved', () => {
    expect(findSelectedPair(data, 'c', 'a')?.article_id).toBe('c');
    expect(findSelectedPair(data, 'x', 'y')?.verdict).toBe('duplicate');
  });

  it('with an article only picks the first open pair containing it on either side', () => {
    expect(findSelectedPair(data, 'a', null)).toBe(data.open[0]);
    expect(findSelectedPair(data, 'c', null)).toBe(data.open[1]);
  });

  it('falls back to a resolved pair, then null', () => {
    expect(findSelectedPair(data, 'y', null)).toBe(data.resolved[0]);
    expect(findSelectedPair(data, 'zzz', null)).toBeNull();
    expect(findSelectedPair(data, null, null)).toBeNull();
  });
});

describe('selectAcceptableExact', () => {
  it('skips a pair whose keeper is removed earlier', () => {
    const open = [pair('b', 'a'), pair('c', 'a'), pair('c', 'b')];
    // AB kept A, AC kept A, BC kept B: the BC keeper B was removed by AB.
    expect(selectAcceptableExact(open).map(pairKey)).toEqual(['b~a', 'c~a']);
  });

  it('skips a chain link', () => {
    const open = [pair('b', 'a'), pair('c', 'b')];
    expect(selectAcceptableExact(open).map(pairKey)).toEqual(['b~a']);
  });

  it('skips a pair whose removed side was already removed', () => {
    const open = [pair('b', 'a'), pair('b', 'c')];
    expect(selectAcceptableExact(open).map(pairKey)).toEqual(['b~a']);
  });

  it('skips a removed side with review work', () => {
    const open = [pair('b', 'a', {}, {has_review_work: true}), pair('d', 'c')];
    expect(selectAcceptableExact(open).map(pairKey)).toEqual(['d~c']);
  });

  it('ignores non-exact pairs', () => {
    expect(selectAcceptableExact([pair('b', 'a', {tier: 'likely'})])).toEqual([]);
  });

  it('caps at 500', () => {
    const open = Array.from({length: 600}, (_, i) => pair(`r${i}`, `k${i}`));
    expect(selectAcceptableExact(open)).toHaveLength(500);
  });
});

describe('differingFields', () => {
  it('ignores case and whitespace in title and journal', () => {
    const p = pair('a', 'b', {}, {title: 'Deep  Learning', journal_title: 'Nature'}, {title: ' deep learning ', journal_title: 'NATURE'});
    expect(differingFields(p).has('title')).toBe(false);
    expect(differingFields(p).has('journal_title')).toBe(false);
  });

  it('flags a differing year, authors and decision count', () => {
    const p = pair('a', 'b', {}, {publication_year: 2019, authors: ['A', 'B'], screening_decisions: 2});
    const diff = differingFields(p);
    expect(diff.has('publication_year')).toBe(true);
    expect(diff.has('authors')).toBe(true);
    expect(diff.has('screening_decisions')).toBe(true);
    expect(diff.has('doi')).toBe(false);
  });
});
