// frontend/test/services/profileService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getUser: vi.fn()}, from: vi.fn()},
}));

import {supabase} from '@/integrations/supabase/client';
import {fetchProfile} from '@/services/profileService';

function profilesChain(payload: {data: unknown; error?: {message: string} | null}) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.maybeSingle = vi.fn(async () => ({data: payload.data, error: payload.error ?? null}));
  return c;
}

describe('profileService.fetchProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps profile row fields to camelCase with auth-user email', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue(
      {data: {user: {id: 'u1', email: 'a@b.c'}}} as never,
    );
    const c = profilesChain({data: {avatar_url: 'http://x/avatar.png', full_name: 'Ada'}});
    vi.mocked(supabase.from).mockReturnValue(c as never);

    const result = await fetchProfile();

    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(c.select).toHaveBeenCalledWith('*');
    expect(c.eq).toHaveBeenCalledWith('id', 'u1');
    expect(result).toEqual({
      ok: true,
      data: {email: 'a@b.c', avatarUrl: 'http://x/avatar.png', fullName: 'Ada'},
    });
  });

  it('resolves ok with null when no user is signed in', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({data: {user: null}} as never);
    const result = await fetchProfile();
    expect(result).toEqual({ok: true, data: null});
  });

  it('treats a profiles-query error as non-fatal and falls back to auth-user fields', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue(
      {data: {user: {id: 'u1', email: 'a@b.c'}}} as never,
    );
    vi.mocked(supabase.from).mockReturnValue(
      profilesChain({data: null, error: {message: 'permission denied'}}) as never,
    );

    const result = await fetchProfile();

    expect(result).toEqual({
      ok: true,
      data: {email: 'a@b.c', avatarUrl: '', fullName: ''},
    });
  });
});
