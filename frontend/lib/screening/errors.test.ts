import {describe, expect, it} from 'vitest';

import {ApiError} from '@/integrations/api/client';
import {screeningErrorMessage} from '@/lib/screening/errors';

// Every code the screening map translates; Tasks 11–12 append theirs.
const MAPPED_CODES = [
  'SCREENING_CONFIG_FROZEN',
  'SCREENING_TOO_FEW_REVIEWERS',
  'VALIDATION_ERROR',
  'NCBI_EMAIL_NOT_CONFIGURED',
  'SERVICE_UNAVAILABLE',
  'SCREENING_REVIEWER_CAP',
  'SCREENING_UNKNOWN_EXCLUSION_REASON',
  'SCREENING_NOT_CONFIGURED',
  'SCREENING_STALE_DECISIONS',
  'SCREENING_NOT_IN_CONFLICT',
  'SCREENING_DECISION_FINAL',
  'SCREENING_SELF_ARBITRATION',
];

describe('screeningErrorMessage', () => {
  it.each(MAPPED_CODES)('maps %s to copy without a placeholder', (code) => {
    const message = screeningErrorMessage(new ApiError(code, 'x', 409));
    expect(message).not.toBe('');
    expect(message).not.toContain('{{');
    // A mapped code never falls through to the status fallback.
    expect(message).not.toBe('Something went wrong. Please try again.');
  });

  it('maps a validation error to the generic validation copy', () => {
    expect(screeningErrorMessage(new ApiError('VALIDATION_ERROR', 'x', 422))).toBe(
      'That was not accepted. Check what you entered and try again.',
    );
  });

  it('says a decision is final', () => {
    expect(screeningErrorMessage(new ApiError('SCREENING_DECISION_FINAL', 'x', 409))).toBe(
      'You already decided on this record. Decisions are final.',
    );
  });

  it('says a reviewer of the record cannot resolve its conflict', () => {
    expect(screeningErrorMessage(new ApiError('SCREENING_SELF_ARBITRATION', 'x', 403))).toBe(
      'You screened this record, so a manager or consensus member who did not screen it resolves the conflict.',
    );
  });

  it('falls back by status', () => {
    expect(screeningErrorMessage(new ApiError('UNKNOWN', 'x', 403))).toBe(
      'You do not have permission to do this.',
    );
    expect(screeningErrorMessage(new ApiError('UNKNOWN', 'x', 404))).toBe('This record no longer exists.');
    expect(screeningErrorMessage(new ApiError('UNKNOWN', 'x', 500))).toBe(
      'Something went wrong. Please try again.',
    );
    expect(screeningErrorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});
