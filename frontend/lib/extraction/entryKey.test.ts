import {describe, expect, it} from 'vitest';

import {
  displayEntryKey,
  entryKeyOf,
  isDuplicateEntryKey,
  keyFieldOf,
  normalizeEntryKey,
} from './entryKey';

describe('normalizeEntryKey — mirrors backend entity_key.normalize_key', () => {
  // The same vectors as backend/tests/unit/test_entity_key.py: the two sides
  // must agree or a human-created entry never matches an AI re-run.
  it('is case and whitespace insensitive', () => {
    expect(normalizeEntryKey('  XGBoost  ')).toBe(normalizeEntryKey('xgboost'));
    expect(normalizeEntryKey('Gradient  Boosting')).toBe('gradient boosting');
    expect(normalizeEntryKey('Random\tForest')).toBe('random forest');
  });

  it('keeps distinct entities distinct', () => {
    expect(normalizeEntryKey('XGBoost')).not.toBe(normalizeEntryKey('LightGBM'));
  });
});

describe('entryKeyOf / displayEntryKey', () => {
  it('reads the materialized key and tolerates rows without one', () => {
    expect(entryKeyOf({metadata: {entity_key: 'xgboost'}})).toBe('xgboost');
    expect(entryKeyOf({metadata: {created_via: 'hitl_session'}})).toBeNull();
    expect(entryKeyOf({metadata: null})).toBeNull();
    expect(entryKeyOf({})).toBeNull();
  });

  it('shows the label casing when the key is just the folded label, else the key', () => {
    expect(displayEntryKey({label: 'XGBoost', metadata: {entity_key: 'xgboost'}})).toBe('XGBoost');
    expect(displayEntryKey({label: 'Model 1', metadata: {entity_key: 'xgboost'}})).toBe('xgboost');
    expect(displayEntryKey({label: 'Model 1', metadata: {}})).toBe('Model 1');
  });
});

describe('keyFieldOf / isDuplicateEntryKey', () => {
  it('finds the declared key field or null', () => {
    type F = {id: string; is_entity_key?: boolean};
    const key: F = {id: 'k', is_entity_key: true};
    const fields: F[] = [{id: 'a'}, key];
    expect(keyFieldOf(fields)).toBe(key);
    expect(keyFieldOf<F>([{id: 'a', is_entity_key: false}])).toBeNull();
  });

  it('blocks an exact duplicate regardless of case and spacing', () => {
    expect(isDuplicateEntryKey(' xgboost ', ['XGBoost', 'LightGBM'])).toBe(true);
    expect(isDuplicateEntryKey('Gradient Boosting', ['XGBoost'])).toBe(false);
  });
});
