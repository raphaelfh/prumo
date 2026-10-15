import {describe, expect, it} from 'vitest';
import {normalizeOptions, optionLabelMap} from './options';

describe('normalizeOptions', () => {
  it('reads every stored shape as {value,label}', () => {
    const canonical = [{value: 'Y', label: 'Yes'}, {value: 'N', label: 'No'}];
    expect(normalizeOptions(canonical)).toEqual(canonical);
    expect(normalizeOptions(['Yes', 'No'])).toEqual([
      {value: 'Yes', label: 'Yes'}, {value: 'No', label: 'No'}]);
    expect(normalizeOptions({options: ['Yes']})).toEqual([{value: 'Yes', label: 'Yes'}]);
    expect(normalizeOptions({options: [{value: 'NI', label: 'No information'}]}))
      .toEqual([{value: 'NI', label: 'No information'}]);
    expect(normalizeOptions([{value: 'Y'}])).toEqual([{value: 'Y', label: 'Y'}]);
    expect(normalizeOptions([{label: 'Only label'}])).toEqual([{value: 'Only label', label: 'Only label'}]);
  });
  it('yields [] for null, junk and empty items', () => {
    expect(normalizeOptions(null)).toEqual([]);
    expect(normalizeOptions('nonsense')).toEqual([]);
    expect(normalizeOptions([null, 3, '', {}])).toEqual([]);
  });
  it('maps codes to labels', () => {
    expect(optionLabelMap([{value: 'NI', label: 'No information'}, 'Y']))
      .toEqual(new Map([['NI', 'No information'], ['Y', 'Y']]));
  });
});
