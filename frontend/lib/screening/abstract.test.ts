import {describe, expect, it} from 'vitest';

import {parseStructuredAbstract} from '@/lib/screening/abstract';

describe('parseStructuredAbstract', () => {
  it('parses PubMed labelled paragraphs', () => {
    const raw =
      'BACKGROUND: Sepsis is common.\n\nMETHODS: We randomised 120 adults.\n\nRESULTS: Mortality fell.\n\nCONCLUSIONS: Early triage helps.';
    expect(parseStructuredAbstract(raw)).toEqual([
      {label: 'BACKGROUND', text: 'Sepsis is common.'},
      {label: 'METHODS', text: 'We randomised 120 adults.'},
      {label: 'RESULTS', text: 'Mortality fell.'},
      {label: 'CONCLUSIONS', text: 'Early triage helps.'},
    ]);
  });

  it('keeps a leading unlabelled paragraph as an untitled section', () => {
    expect(parseStructuredAbstract('Context first.\n\nMETHODS: a\n\nRESULTS: b')).toEqual([
      {label: null, text: 'Context first.'},
      {label: 'METHODS', text: 'a'},
      {label: 'RESULTS', text: 'b'},
    ]);
  });

  it('accepts labels with spaces, slash, ampersand and digits', () => {
    expect(parseStructuredAbstract('METHODS/DESIGN: a\n\nCONCLUSIONS AND RELEVANCE: b')).toEqual([
      {label: 'METHODS/DESIGN', text: 'a'},
      {label: 'CONCLUSIONS AND RELEVANCE', text: 'b'},
    ]);
    expect(parseStructuredAbstract('AIMS & SCOPE: a\nPHASE 2 RESULTS: b')).toEqual([
      {label: 'AIMS & SCOPE', text: 'a'},
      {label: 'PHASE 2 RESULTS', text: 'b'},
    ]);
  });

  it('returns null for prose such as "Note: …"', () => {
    expect(parseStructuredAbstract('Note: this is prose.\n\nMore prose.')).toBeNull();
  });

  it('returns null for one label only', () => {
    expect(parseStructuredAbstract('HIV: a disease.')).toBeNull();
  });

  it('returns null for mixed-case labels', () => {
    expect(parseStructuredAbstract('Background: a\n\nMethods: b')).toBeNull();
  });

  it('returns null for inline labels on one line', () => {
    expect(parseStructuredAbstract('BACKGROUND: a. METHODS: b.')).toBeNull();
  });

  it('returns null when an unlabelled paragraph follows a labelled one', () => {
    expect(parseStructuredAbstract('BACKGROUND: a\n\nloose prose\n\nMETHODS: b')).toBeNull();
  });

  it('returns null for a label over 40 characters', () => {
    const long = 'A'.repeat(41);
    expect(long).toHaveLength(41);
    expect(parseStructuredAbstract(`${long}: a\n\n${long}: b`)).toBeNull();
    const max = 'A'.repeat(40);
    expect(parseStructuredAbstract(`${max}: a\n\n${max}: b`)).toHaveLength(2);
  });

  it('returns null for empty or whitespace', () => {
    expect(parseStructuredAbstract('')).toBeNull();
    expect(parseStructuredAbstract('  \n\n  ')).toBeNull();
  });
});
