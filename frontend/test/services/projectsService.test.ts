// frontend/test/services/projectsService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({supabase: {from: vi.fn()}}));

import {supabase} from '@/integrations/supabase/client';
import {listProjectsForDashboard} from '@/services/projectsService';

function chain(payload: {data: unknown; error?: {message: string} | null}) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.order = vi.fn(async () => ({data: payload.data, error: payload.error ?? null}));
  return c;
}

describe('projectsService.listProjectsForDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects the list projection and orders by created_at desc', async () => {
    const rows = [{id: 'p1'}, {id: 'p2'}];
    const c = chain({data: rows});
    vi.mocked(supabase.from).mockReturnValue(c as never);

    const result = await listProjectsForDashboard();

    expect(supabase.from).toHaveBeenCalledWith('projects');
    expect(c.select).toHaveBeenCalledWith(
      'id, name, description, created_at, is_active, review_title',
    );
    expect(c.order).toHaveBeenCalledWith('created_at', {ascending: false});
    expect(result).toEqual({ok: true, data: rows});
  });

  it('returns ok with [] when data is null', async () => {
    vi.mocked(supabase.from).mockReturnValue(chain({data: null}) as never);
    expect(await listProjectsForDashboard()).toEqual({ok: true, data: []});
  });

  it('returns ok:false (never throws) on a supabase error', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      chain({data: null, error: {message: 'permission denied'}}) as never,
    );
    const result = await listProjectsForDashboard();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('permission denied');
  });
});
