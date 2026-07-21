import { describe, expect, it } from 'vitest';

import { extractValueForSave } from './selectOther';

// ADR-0016 Phase 1 write contract: extractValueForSave must carry the
// `absent_reason` disposition sibling out of the `{value}` envelope so a
// resolved "no information" marker can round-trip through writeRunFieldValue,
// instead of being stripped to a bare null on save.
describe('extractValueForSave — absent_reason marker', () => {
  it('carries the absent_reason sibling from a marker envelope', () => {
    const result = extractValueForSave({
      value: null,
      absent_reason: 'no_information',
    });
    expect(result).toEqual({
      value: null,
      unit: null,
      isOther: false,
      absentReason: 'no_information',
    });
  });

  it('returns absentReason null for a plain value envelope (no fabrication)', () => {
    const result = extractValueForSave({ value: 'Retrospective cohort' });
    expect(result.value).toBe('Retrospective cohort');
    expect(result.absentReason).toBeNull();
    expect(result.isOther).toBe(false);
  });

  it('returns absentReason null for a bare scalar', () => {
    expect(extractValueForSave('hello').absentReason).toBeNull();
  });

  it('preserves unit and reports absentReason null for a number+unit envelope', () => {
    const result = extractValueForSave({ value: 240, unit: 'days' });
    expect(result.value).toBe(240);
    expect(result.unit).toBe('days');
    expect(result.absentReason).toBeNull();
  });

  it('does not touch the "other" path — absentReason null, structure preserved', () => {
    const other = { selected: 'other', other_text: 'freetext' };
    const result = extractValueForSave(other);
    expect(result.isOther).toBe(true);
    expect(result.value).toEqual(other);
    expect(result.absentReason).toBeNull();
  });
});
