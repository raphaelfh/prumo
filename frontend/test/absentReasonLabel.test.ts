import { describe, expect, it } from 'vitest';

import { absentReasonLabel } from '@/lib/extraction/absentReasonLabel';

describe('absentReasonLabel', () => {
  it('returns the human label for each coded disposition marker', () => {
    expect(absentReasonLabel({ value: null, absent_reason: 'no_information' })).toBe(
      'No information',
    );
    expect(absentReasonLabel({ value: null, absent_reason: 'not_applicable' })).toBe(
      'Not applicable',
    );
    expect(absentReasonLabel({ value: null, absent_reason: 'not_evaluated' })).toBe(
      'Not evaluated',
    );
  });

  it('returns null when raw carries no resolved marker', () => {
    expect(absentReasonLabel({ value: 'Low' })).toBeNull();
    expect(absentReasonLabel('Low')).toBeNull();
    expect(absentReasonLabel({ value: null })).toBeNull(); // bare null, no marker
    expect(absentReasonLabel({ value: null, absent_reason: '' })).toBeNull();
    expect(absentReasonLabel({ value: null, absent_reason: 'garbage' })).toBeNull();
    expect(absentReasonLabel(null)).toBeNull();
    expect(absentReasonLabel(undefined)).toBeNull();
  });

  it('matches the backend export labels exactly (FE/BE parity)', () => {
    // These strings mirror backend value_semantics.ABSENT_REASON_LABELS so an
    // on-screen reviewer cell and its exported cell can never disagree. If the
    // backend labels change, this test and the copy keys must move together.
    expect(absentReasonLabel({ value: null, absent_reason: 'no_information' })).toBe(
      'No information',
    );
    expect(absentReasonLabel({ value: null, absent_reason: 'not_applicable' })).toBe(
      'Not applicable',
    );
    expect(absentReasonLabel({ value: null, absent_reason: 'not_evaluated' })).toBe(
      'Not evaluated',
    );
  });
});
