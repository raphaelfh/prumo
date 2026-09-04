import {describe, expect, it} from 'vitest';

import {APIError, getErrorCode} from '@/lib/ai-extraction/errors';

describe('APIError', () => {
  it('carries the backend envelope code when the details hold one', () => {
    const err = new APIError('refused', 409, {code: 'MISSING_ENTITY_KEY', traceId: 'tr-1'});
    expect(err.code).toBe('MISSING_ENTITY_KEY');
    expect(getErrorCode(err)).toBe('MISSING_ENTITY_KEY');
    expect(err.details).toEqual({statusCode: 409, code: 'MISSING_ENTITY_KEY', traceId: 'tr-1'});
  });

  it('falls back to the class tag without details', () => {
    expect(new APIError('boom').code).toBe('API_ERROR');
  });

  it('falls back to the class tag when the details carry no string code', () => {
    expect(new APIError('boom', 500, {originalError: 'x'}).code).toBe('API_ERROR');
  });
});
