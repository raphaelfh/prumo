import {describe, expect, it} from 'vitest';

import {ApiError} from '@/integrations/api/client';
import {duplicatesErrorMessage} from '@/lib/duplicates/errors';

const apiError = (code: string, status: number) => new ApiError(code, code, status);

describe('duplicatesErrorMessage', () => {
  it.each([
    ['DUPLICATE_HAS_REVIEW_WORK', 409, 'This record already has full-text or extraction work, so keep it instead.'],
    ['DUPLICATE_KEPT_IS_REMOVED', 409, 'The record you chose to keep was already removed as a duplicate.'],
    ['VALIDATION_ERROR', 422, 'Something went wrong. Try again.'],
  ])('maps %s', (code, status, message) => {
    expect(duplicatesErrorMessage(apiError(code, status))).toBe(message);
  });

  it('words a 403 as manager-only', () => {
    expect(duplicatesErrorMessage(apiError('FORBIDDEN', 403))).toBe('Only project managers can do this');
  });

  it('falls back to generic for an unknown code or a non-ApiError', () => {
    expect(duplicatesErrorMessage(apiError('WHATEVER', 500))).toBe('Something went wrong. Try again.');
    expect(duplicatesErrorMessage(new Error('x'))).toBe('Something went wrong. Try again.');
  });
});
