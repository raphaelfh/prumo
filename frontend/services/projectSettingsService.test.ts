import {afterEach, describe, expect, it, vi} from 'vitest';

// Terminal .eq() resolves to whatever `resultRef.current` holds, so each test
// can inject a PostgrestError (or success) without re-mocking the chain.
const {resultRef} = vi.hoisted(() => ({
  resultRef: {current: {error: null as {message: string; code?: string} | null}},
}));

vi.mock('@/integrations/supabase/client', () => {
  const eq = () => Promise.resolve(resultRef.current);
  return {
    supabase: {
      from: () => ({
        update: () => ({eq}),
        delete: () => ({eq}),
      }),
    },
  };
});

import {removeProjectMember, updateMemberRole} from './projectSettingsService';
import {PgError} from '@/lib/error-utils';

afterEach(() => {
  resultRef.current = {error: null};
});

describe('projectSettingsService — PM001 min-one-manager guard surfaces as PgError', () => {
  it('updateMemberRole re-wraps a PM001 PostgrestError so .code survives toResult', async () => {
    resultRef.current = {error: {message: 'a project must retain at least one manager', code: 'PM001'}};
    const result = await updateMemberRole('member-1', 'reviewer');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // This is the load-bearing assertion: a bare `throw error` would reach
      // the caller as a PostgrestError, and `instanceof PgError` would be false.
      expect(result.error).toBeInstanceOf(PgError);
      expect((result.error as PgError).code).toBe('PM001');
    }
  });

  it('removeProjectMember re-wraps a PM001 PostgrestError so .code survives toResult', async () => {
    resultRef.current = {error: {message: 'a project must retain at least one manager', code: 'PM001'}};
    const result = await removeProjectMember('member-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PgError);
      expect((result.error as PgError).code).toBe('PM001');
    }
  });

  it('updateMemberRole returns ok on success', async () => {
    resultRef.current = {error: null};
    const result = await updateMemberRole('member-1', 'viewer');
    expect(result.ok).toBe(true);
  });
});
