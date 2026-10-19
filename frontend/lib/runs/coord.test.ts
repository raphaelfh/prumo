import {describe, expect, it} from 'vitest';

import {coordKey, parseCoordKey} from '@/lib/runs/coord';

describe('coord', () => {
  it('round-trips a coordinate through its key', () => {
    const key = coordKey('3f2a9c1e-0000-4000-8000-000000000001', '7b1d-field-uuid');
    expect(parseCoordKey(key)).toEqual({
      instanceId: '3f2a9c1e-0000-4000-8000-000000000001',
      fieldId: '7b1d-field-uuid',
    });
  });

  it('splits at the first separator, so a field id may carry one', () => {
    expect(parseCoordKey('inst-1_field_with_underscores')).toEqual({instanceId: 'inst-1', fieldId: 'field_with_underscores'});
  });

  it('reads a key without a separator as an instance with no field', () => {
    expect(parseCoordKey('inst-1')).toEqual({instanceId: 'inst-1', fieldId: ''});
  });
});
