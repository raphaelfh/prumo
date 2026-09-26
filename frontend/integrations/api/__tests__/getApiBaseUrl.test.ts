import {afterEach, describe, expect, it, vi} from 'vitest';
import {apiClient, getApiBaseUrl} from '@/integrations/api/client';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {session: {access_token: 'tok'}},
      }),
    },
  },
}));

afterEach(() => {
  vi.stubEnv('VITE_API_URL', '');
  vi.restoreAllMocks();
});

describe('getApiBaseUrl', () => {
  it('returns VITE_API_URL when set', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example');
    expect(getApiBaseUrl()).toBe('https://api.example');
  });

  it('falls back to the local dev server when unset', () => {
    vi.stubEnv('VITE_API_URL', '');
    expect(getApiBaseUrl()).toBe('http://127.0.0.1:8000');
  });

  it('apiClient builds the request URL from getApiBaseUrl', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example');
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ok: true, data: 1})));

    await apiClient('/api/v1/x');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example/api/v1/x',
      expect.anything(),
    );
  });
});
