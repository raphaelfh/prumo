// frontend/lib/error-utils.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('sonner', () => ({
  toast: {error: vi.fn(), success: vi.fn(), info: vi.fn()},
}));

import {toast} from 'sonner';
import {toResult} from './error-utils';

describe('toResult', () => {
  beforeEach(() => vi.clearAllMocks());

  it('wraps a resolved value in ok:true', async () => {
    const result = await toResult(async () => 42, 'test.op');
    expect(result).toEqual({ok: true, data: 42});
  });

  it('normalizes a thrown supabase-style error object', async () => {
    const result = await toResult(async () => {
      throw {message: 'row not found', code: 'PGRST116'};
    }, 'test.op');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('row not found');
    }
  });

  it('never toasts - presentation is the caller\'s job', async () => {
    await toResult(async () => {
      throw new Error('boom');
    }, 'test.op');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
