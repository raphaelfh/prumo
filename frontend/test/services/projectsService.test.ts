// frontend/test/services/projectsService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({supabase: {from: vi.fn()}}));

import {supabase} from '@/integrations/supabase/client';
import {listProjects} from '@/services/projectsService';

function chain(payload: {data: unknown; error?: {message: string} | null}) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.order = vi.fn(async () => ({data: payload.data, error: payload.error ?? null}));
  return c;
}

describe('projectsService.listProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok with rows ordered by created_at desc', async () => {
    const rows = [{id: 'p1'}, {id: 'p2'}];
    const c = chain({data: rows});
    vi.mocked(supabase.from).mockReturnValue(c as never);

    const result = await listProjects();

    expect(supabase.from).toHaveBeenCalledWith('projects');
    expect(c.select).toHaveBeenCalledWith('*');
    expect(c.order).toHaveBeenCalledWith('created_at', {ascending: false});
    expect(result).toEqual({ok: true, data: rows});
  });

  it('returns ok with [] when data is null', async () => {
    vi.mocked(supabase.from).mockReturnValue(chain({data: null}) as never);
    const result = await listProjects();
    expect(result).toEqual({ok: true, data: []});
  });

  it('returns ok:false (never throws) on a supabase error', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      chain({data: null, error: {message: 'permission denied'}}) as never,
    );
    const result = await listProjects();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('permission denied');
  });
});
