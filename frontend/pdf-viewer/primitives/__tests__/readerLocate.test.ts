import {describe, expect, it} from 'vitest';
import {findBlockForQuote, type LocatableBlock} from '../readerLocate';

const blocks: LocatableBlock[] = [
  {id: 'b1', pageNumber: 1, text: 'SMART-CARE is a **prospective, multicenter, observational** cohort study enrolling 300 adult patients with CHF.'},
  {id: 'b2', pageNumber: 1, text: '# Methods'},
  {id: 'b3', pageNumber: 2, text: 'Patients were followed for six months.'},
  {id: 'b4', pageNumber: 2, text: '| Age ≥ 18 years | Pregnancy |'},
];

describe('findBlockForQuote', () => {
  it('returns null for an empty quote', () => {
    expect(findBlockForQuote(blocks, '   ')).toBeNull();
  });

  it('matches the block that contains the quote (whitespace/case-insensitive)', () => {
    expect(
      findBlockForQuote(blocks, 'prospective, MULTICENTER, observational cohort'),
    ).toBe('b1');
  });

  it('matches a plain quote against a block carrying markdown syntax', () => {
    // Quote has no ** but the block does — markdown is stripped before matching.
    expect(
      findBlockForQuote(blocks, 'a prospective, multicenter, observational cohort study'),
    ).toBe('b1');
  });

  it('matches a quote against a markdown table cell', () => {
    expect(findBlockForQuote(blocks, 'Age ≥ 18 years', 2)).toBe('b4');
  });

  it('tolerates a trailing ellipsis on the evidence snippet', () => {
    expect(
      findBlockForQuote(blocks, 'SMART-CARE is a prospective, multicenter...'),
    ).toBe('b1');
  });

  it('prefers the page-hinted pool', () => {
    expect(findBlockForQuote(blocks, 'followed for six months', 2)).toBe('b3');
  });

  it('falls back to all pages when the hinted page has no match', () => {
    // page 2 has no CHF block; should still find b1 on page 1.
    expect(findBlockForQuote(blocks, 'enrolling 300 adult patients', 2)).toBe('b1');
  });

  it('matches when a short block is contained within a longer quote', () => {
    expect(
      findBlockForQuote(blocks, 'Patients were followed for six months. (see Methods)'),
    ).toBe('b3');
  });

  it('returns null when nothing matches', () => {
    expect(findBlockForQuote(blocks, 'no such text anywhere')).toBeNull();
  });
});
