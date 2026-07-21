/**
 * Shared FE/BE emptiness + absent_reason vector.
 *
 * This file asserts the SAME truth table as the backend
 * `backend/tests/unit/test_value_semantics.py`, so the two implementations of
 * the "is this coordinate filled?" rule are kept mechanically in lock-step
 * (replacing the old "the docstring says they mirror"). Any drift here or there
 * flips a row and one suite goes red.
 */
import { describe, expect, it } from 'vitest';

import {
  isValueEmpty,
  isValueFilled,
  toConsensusValueEnvelope,
  unwrapValueEnvelope,
  valueAbsentReason,
} from './valueSemantics';

describe('isValueEmpty / isValueFilled — the shared cross-checked vector', () => {
  const cases: Array<[string, unknown, boolean]> = [
    // legacy emptiness (mirrors the backend base table; FE also has `undefined`)
    ['null', null, true],
    ['undefined', undefined, true],
    ['empty-string', '', true],
    ['envelope-none', { value: null }, true],
    ['envelope-empty-string', { value: '' }, true],
    ['envelope-undefined', { value: undefined }, true],
    ['scalar-string', 'x', false],
    ['zero', 0, false],
    ['false', false, false],
    ['empty-list', [], false],
    ['whitespace', '  ', false],
    ['envelope-value', { value: 'x' }, false],
    ['envelope-zero', { value: 0 }, false],
    ['double-wrapped-unit', { value: { value: 'x', unit: 'mg' } }, false],
    ['dict-without-value-key', { unit: 'mg' }, false],
    // absent_reason marker (ADR-0016) — a resolved disposition counts as filled
    ['marker-no-information', { value: null, absent_reason: 'no_information' }, false],
    ['marker-not-applicable', { value: null, absent_reason: 'not_applicable' }, false],
    ['marker-not-evaluated', { value: null, absent_reason: 'not_evaluated' }, false],
    ['marker-with-real-value', { value: 'x', absent_reason: 'no_information' }, false],
    ['marker-empty-reason', { value: null, absent_reason: '' }, true],
    ['marker-unknown-code', { value: null, absent_reason: 'garbage' }, true],
    // a disposition string carried in-band is just a non-empty scalar → filled
    // (stored data was migrated by 0039; the emptiness rule never interprets
    // strings — only the write-time normalizer converts a picked legacy option)
    ['legacy-string-envelope', { value: 'No information' }, false],
    ['legacy-string-scalar', 'No information', false],
  ];

  for (const [id, raw, empty] of cases) {
    it(`${id} → ${empty ? 'empty' : 'filled'}`, () => {
      expect(isValueEmpty(raw)).toBe(empty);
      expect(isValueFilled(raw)).toBe(!empty);
    });
  }
});

describe('valueAbsentReason — only valid closed-vocabulary codes', () => {
  const cases: Array<[string, unknown, string | null]> = [
    ['no_information', { value: null, absent_reason: 'no_information' }, 'no_information'],
    ['not_applicable', { value: null, absent_reason: 'not_applicable' }, 'not_applicable'],
    ['not_evaluated', { value: null, absent_reason: 'not_evaluated' }, 'not_evaluated'],
    ['empty-reason', { value: null, absent_reason: '' }, null],
    ['unknown-code', { value: null, absent_reason: 'garbage' }, null],
    ['no-marker', { value: null }, null],
    ['real-value', { value: 'x' }, null],
    ['bare-null', null, null],
    ['bare-scalar', 'x', null],
  ];

  for (const [id, raw, code] of cases) {
    it(`${id} → ${code ?? 'null'}`, () => {
      expect(valueAbsentReason(raw)).toBe(code);
    });
  }
});

describe('toConsensusValueEnvelope — override payload = select_existing shape', () => {
  it('wraps a scalar once (text/select value)', () => {
    expect(toConsensusValueEnvelope('Low')).toEqual({ value: 'Low' });
  });
  it('wraps a {value, unit} number once (canonical nested envelope)', () => {
    expect(toConsensusValueEnvelope({ value: '5', unit: 'mg' })).toEqual({
      value: { value: '5', unit: 'mg' },
    });
  });
  it('wraps an array once (multiselect)', () => {
    expect(toConsensusValueEnvelope(['a', 'b'])).toEqual({ value: ['a', 'b'] });
  });
  it('passes a disposition marker through FLAT — never double-wrapped', () => {
    expect(
      toConsensusValueEnvelope({ value: null, absent_reason: 'no_information' }),
    ).toEqual({ value: null, absent_reason: 'no_information' });
  });
  it('wraps an out-of-vocabulary reason as an ordinary object (not a marker)', () => {
    expect(toConsensusValueEnvelope({ value: null, absent_reason: 'nope' })).toEqual({
      value: { value: null, absent_reason: 'nope' },
    });
  });
});

describe('unwrapValueEnvelope — peels exactly one {value} level', () => {
  it('peels one level and leaves a bare scalar / non-envelope dict untouched', () => {
    expect(unwrapValueEnvelope({ value: 'x' })).toBe('x');
    expect(unwrapValueEnvelope('x')).toBe('x');
    expect(unwrapValueEnvelope({ unit: 'mg' })).toEqual({ unit: 'mg' });
    // only one level (a double-wrapped unit envelope keeps its inner unit)
    expect(unwrapValueEnvelope({ value: { value: 'x', unit: 'mg' } })).toEqual({
      value: 'x',
      unit: 'mg',
    });
    // an array is not an envelope even though `'value' in []` is false
    expect(unwrapValueEnvelope(['a'])).toEqual(['a']);
  });
});
