import {describe, expect, it} from 'vitest';

import {articleTypeChipLabel, languageChipLabel, pubmedUrl} from '@/lib/screening/recordMeta';

describe('languageChipLabel', () => {
  it.each(['eng', 'EN', 'English', 'en-GB', 'en_US', ' eng ', '', '  ', null, undefined])(
    'shows no chip for English or empty (%j)',
    (raw) => {
      expect(languageChipLabel(raw)).toBeNull();
    },
  );

  it.each([
    ['spa', 'Spanish'],
    ['POR', 'Portuguese'],
    ['fre', 'French'],
    ['ger', 'German'],
    ['chi', 'Chinese'],
    ['jpn', 'Japanese'],
    ['ita', 'Italian'],
    ['rus', 'Russian'],
    ['dut', 'Dutch'],
    ['kor', 'Korean'],
  ])('names the ISO 639-2 code %s as %s', (raw, label) => {
    expect(languageChipLabel(raw)).toBe(label);
  });

  it('keeps an unknown value raw and trimmed', () => {
    expect(languageChipLabel(' Deutsch ')).toBe('Deutsch');
  });

  it('does not treat a word merely starting with "en" as English', () => {
    expect(languageChipLabel('enm')).toBe('enm');
  });
});

describe('articleTypeChipLabel', () => {
  it.each(['Journal Article', 'journalArticle', 'JOUR', ' journal article ', null, undefined, ''])(
    'shows no chip for a generic journal article (%j)',
    (raw) => {
      expect(articleTypeChipLabel(raw)).toBeNull();
    },
  );

  it('keeps a specific type as stored', () => {
    expect(articleTypeChipLabel('Randomized Controlled Trial')).toBe('Randomized Controlled Trial');
  });

  it('formats a Zotero item type key', () => {
    expect(articleTypeChipLabel('conferencePaper')).toBe('Conference Paper');
  });
});

describe('pubmedUrl', () => {
  it('links a numeric PMID', () => {
    expect(pubmedUrl('12345')).toBe('https://pubmed.ncbi.nlm.nih.gov/12345/');
  });

  it('trims before linking', () => {
    expect(pubmedUrl(' 12345 ')).toBe('https://pubmed.ncbi.nlm.nih.gov/12345/');
  });

  it.each(['abc', '12a', '', null, undefined])('returns null for a non-numeric PMID (%j)', (raw) => {
    expect(pubmedUrl(raw)).toBeNull();
  });
});
