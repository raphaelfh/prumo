import {describe, expect, it} from 'vitest';
import {doiUrl} from '../doi';

describe('doiUrl', () => {
  it('wraps a bare DOI', () => {
    expect(doiUrl('10.1234/abcd')).toBe('https://doi.org/10.1234/abcd');
  });

  it('strips a doi: prefix', () => {
    expect(doiUrl('doi: 10.1234/abcd')).toBe('https://doi.org/10.1234/abcd');
  });

  it('normalises a full https://doi.org/ URL', () => {
    expect(doiUrl('https://doi.org/10.1234/abcd')).toBe('https://doi.org/10.1234/abcd');
  });

  it('normalises a http://dx.doi.org/ URL', () => {
    expect(doiUrl('http://dx.doi.org/10.1234/abcd')).toBe('https://doi.org/10.1234/abcd');
  });

  it('trims surrounding whitespace', () => {
    expect(doiUrl('  10.1234/abcd  ')).toBe('https://doi.org/10.1234/abcd');
  });

  it('returns null for an empty string', () => {
    expect(doiUrl('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(doiUrl(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(doiUrl(undefined)).toBeNull();
  });
});
