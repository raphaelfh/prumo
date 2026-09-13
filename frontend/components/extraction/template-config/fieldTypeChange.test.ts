import {describe, expect, it} from 'vitest';

import {typeChangeUpdates} from './fieldTypeChange';

const OPTION_CLEARS = {
  allowed_values: null,
  allow_other: false,
  other_label: null,
  other_placeholder: null,
};
const UNIT_CLEARS = {unit: null, allowed_units: null};

describe('typeChangeUpdates', () => {
  it('keeps units and clears options when the new type is a number', () => {
    expect(typeChangeUpdates('number')).toEqual({field_type: 'number', ...OPTION_CLEARS});
  });

  it.each(['select', 'multiselect'])('keeps options and clears units for %s', (fieldType) => {
    expect(typeChangeUpdates(fieldType)).toEqual({field_type: fieldType, ...UNIT_CLEARS});
  });

  it('clears both groups for a type that supports neither', () => {
    expect(typeChangeUpdates('text')).toEqual({
      field_type: 'text',
      ...OPTION_CLEARS,
      ...UNIT_CLEARS,
    });
  });
});
