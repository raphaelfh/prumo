/**
 * Characterization tests for `valueParser` — pinned BEFORE routing its envelope
 * peel + emptiness check through the shared `valueSemantics` module, so the
 * refactor is provably behaviour-neutral. `FieldInput.tsx` (its only consumer)
 * depends on `extractValue` / `extractUnit` / `isEmptyValue` / `isValidNumber`.
 */
import { describe, expect, it } from 'vitest';

import {
  extractUnit,
  extractValue,
  isEmptyValue,
  isValidNumber,
  normalizeValue,
  toNumber,
  toString,
} from './valueParser';

describe('extractValue — one-level envelope peel', () => {
  it('peels {value} and {value, unit}, leaves scalars and non-envelopes', () => {
    expect(extractValue({ value: 'x' })).toBe('x');
    expect(extractValue({ value: 'x', unit: 'mg' })).toBe('x');
    expect(extractValue({ value: 0 })).toBe(0);
    expect(extractValue('x')).toBe('x');
    expect(extractValue(0)).toBe(0);
    expect(extractValue({ unit: 'mg' })).toEqual({ unit: 'mg' });
  });

  it('coerces null / undefined to null', () => {
    expect(extractValue(null)).toBeNull();
    expect(extractValue(undefined)).toBeNull();
  });
});

describe('extractUnit', () => {
  it('reads the unit sibling, else null', () => {
    expect(extractUnit({ value: 'x', unit: 'mg' })).toBe('mg');
    expect(extractUnit({ value: 'x' })).toBeNull();
    expect(extractUnit('x')).toBeNull();
    expect(extractUnit(null)).toBeNull();
    expect(extractUnit({ unit: '' })).toBeNull();
  });
});

describe('isEmptyValue', () => {
  const empty = [null, undefined, '', { value: null }, { value: '' }];
  const filled = ['x', 0, { value: 'x' }, { value: 0 }, '  ', { unit: 'mg' }];

  for (const v of empty) {
    it(`empty: ${JSON.stringify(v)}`, () => expect(isEmptyValue(v)).toBe(true));
  }
  for (const v of filled) {
    it(`filled: ${JSON.stringify(v)}`, () => expect(isEmptyValue(v)).toBe(false));
  }
});

describe('isValidNumber', () => {
  it('validates numbers through the envelope', () => {
    expect(isValidNumber('5')).toBe(true);
    expect(isValidNumber(5)).toBe(true);
    expect(isValidNumber({ value: '5' })).toBe(true);
    expect(isValidNumber(0)).toBe(true);
    expect(isValidNumber('abc')).toBe(false);
    expect(isValidNumber('')).toBe(false);
    expect(isValidNumber(null)).toBe(false);
  });
});

describe('normalizeValue / toNumber / toString (unchanged helpers)', () => {
  it('normalizeValue collapses empty to null, else the extracted value', () => {
    expect(normalizeValue({ value: '' })).toBeNull();
    expect(normalizeValue({ value: 'x' })).toBe('x');
  });
  it('toNumber returns the number or null', () => {
    expect(toNumber({ value: '7' })).toBe(7);
    expect(toNumber('nope')).toBeNull();
  });
  it('toString returns the placeholder for empty', () => {
    expect(toString({ value: '' }, '—')).toBe('—');
    expect(toString({ value: 'x' })).toBe('x');
  });
});
