import { describe, expect, it } from 'vitest';

import {
  currentValuesToValuesMap,
  publishedStatesToValuesMap,
} from '@/lib/extraction/publishedValues';
import type { PublishedStateResponse, RunViewCurrentValue } from '@/hooks/runs/types';

function row(over: Partial<PublishedStateResponse>): PublishedStateResponse {
  return {
    id: 'ps1',
    run_id: 'r1',
    instance_id: 'i1',
    field_id: 'f1',
    value: { value: 'x' },
    published_at: '2026-07-01T00:00:00Z',
    published_by: 'u1',
    version: 1,
    ...over,
  };
}

describe('publishedStatesToValuesMap', () => {
  it('returns an empty map for undefined/empty rows', () => {
    expect(publishedStatesToValuesMap(undefined)).toEqual({});
    expect(publishedStatesToValuesMap([])).toEqual({});
  });

  it('unwraps a plain envelope to the scalar', () => {
    const map = publishedStatesToValuesMap([row({ value: { value: 'RCT registry' } })]);
    expect(map['i1_f1']).toBe('RCT registry');
  });

  it('preserves an ADR-0016 marker envelope verbatim (FieldInput renders the label)', () => {
    const marker = { value: null, absent_reason: 'no_information' };
    const map = publishedStatesToValuesMap([row({ value: marker })]);
    expect(map['i1_f1']).toEqual(marker);
  });

  it('keeps units from a double-wrapped envelope (the only unit shape writers produce)', () => {
    const map = publishedStatesToValuesMap([
      row({ value: { value: { value: 12, unit: 'weeks' } } }),
    ]);
    expect(map['i1_f1']).toEqual({ value: 12, unit: 'weeks' });
  });

  it('keys by instance and field', () => {
    const map = publishedStatesToValuesMap([
      row({ instance_id: 'iA', field_id: 'fA', value: { value: 1 } }),
      row({ instance_id: 'iB', field_id: 'fB', value: { value: 2 } }),
    ]);
    expect(Object.keys(map).sort()).toEqual(['iA_fA', 'iB_fB']);
  });
});

function cv(over: Partial<RunViewCurrentValue>): RunViewCurrentValue {
  return {
    instance_id: 'i1',
    field_id: 'f1',
    value: { value: 'x' },
    decision: 'edit',
    ...over,
  };
}

// D8: the QA screen hydrates AND baselines from runDetail.current_values via
// this one map — same envelope contract as publishedStatesToValuesMap.
describe('currentValuesToValuesMap', () => {
  it('returns an empty map for undefined/empty rows', () => {
    expect(currentValuesToValuesMap(undefined)).toEqual({});
    expect(currentValuesToValuesMap([])).toEqual({});
  });

  it('unwraps a plain envelope to the scalar', () => {
    const map = currentValuesToValuesMap([cv({ value: { value: 'Probably yes' } })]);
    expect(map['i1_f1']).toBe('Probably yes');
  });

  it('keeps units from a double-wrapped envelope (the Phase-B double-wrap pin)', () => {
    const map = currentValuesToValuesMap([
      cv({ value: { value: { value: 5, unit: 'mg' } } }),
    ]);
    expect(map['i1_f1']).toEqual({ value: 5, unit: 'mg' });
  });

  it('preserves an ADR-0016 marker envelope verbatim', () => {
    const marker = { value: null, absent_reason: 'no_information' };
    const map = currentValuesToValuesMap([cv({ value: marker })]);
    expect(map['i1_f1']).toEqual(marker);
  });

  it('skips reject decisions (the audit row stays; the form coord clears)', () => {
    const map = currentValuesToValuesMap([
      cv({ decision: 'reject', value: null }),
      cv({ instance_id: 'i2', value: { value: 'kept' } }),
    ]);
    expect(map).toEqual({ i2_f1: 'kept' });
  });

  it('hydrates Layer-1 rows (human_proposal / system_proposal) like decisions', () => {
    const map = currentValuesToValuesMap([
      cv({ decision: 'human_proposal', value: { value: 'typed pre-D8' } }),
      cv({ instance_id: 'i2', decision: 'system_proposal', value: { value: 'seeded' } }),
    ]);
    expect(map['i1_f1']).toBe('typed pre-D8');
    expect(map['i2_f1']).toBe('seeded');
  });
});
