import {describe, expect, it} from 'vitest';

import {APIError, getErrorCode} from '@/lib/ai-extraction/errors';

describe('APIError', () => {
  it('carries the backend envelope code it is given', () => {
    const err = new APIError('refused', 409, {traceId: 'tr-1'}, 'MISSING_ENTITY_KEY');
    expect(err.code).toBe('MISSING_ENTITY_KEY');
    expect(getErrorCode(err)).toBe('MISSING_ENTITY_KEY');
    expect(err.details).toEqual({statusCode: 409, traceId: 'tr-1'});
  });

  it('falls back to the class tag without a code', () => {
    expect(new APIError('boom').code).toBe('API_ERROR');
    expect(new APIError('boom', 500, {originalError: 'x'}).code).toBe('API_ERROR');
  });
});
