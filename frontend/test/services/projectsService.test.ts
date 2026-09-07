// frontend/test/services/projectsService.test.ts
/**
 * The list read's shape. This is a hand-rolled chain stub, so it pins the
 * projection and the sort, NOT PostgREST's behaviour — see the plan's
 * "Accepted" section. What the affordance actually depends on is proved in
 * `frontend/test/types/projectManager.test.ts`, which does not trust the
 * transport filter at all.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({supabase: {from: vi.fn()}}));

import {supabase} from '@/integrations/supabase/client';
import {listProjectsForDashboard} from '@/services/projectsService';

function readChain(payload: {data: unknown; error?: {message: string} | null}) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.order = vi.fn(async () => ({data: payload.data, error: payload.error ?? null}));
  return c;
}

describe('projectsService.listProjectsForDashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('selects updated_at and the membership rows, newest update first', async () => {
    const rows = [{id: 'p1', project_members: [{user_id: 'u1', role: 'manager'}]}];
    const c = readChain({data: rows});
    vi.mocked(supabase.from).mockReturnValue(c as never);

    const result = await listProjectsForDashboard('u1');

    expect(supabase.from).toHaveBeenCalledWith('projects');
    expect(c.select).toHaveBeenCalledWith(
      'id, name, description, created_at, updated_at, is_active, review_title, project_members(user_id, role)',
    );
    // Transport narrowing only — the affordance re-checks the row's owner.
    expect(c.eq).toHaveBeenCalledWith('project_members.user_id', 'u1');
    expect(c.order).toHaveBeenCalledWith('updated_at', {ascending: false});
    expect(result).toEqual({ok: true, data: rows});
  });

  it('returns ok with [] when data is null', async () => {
    vi.mocked(supabase.from).mockReturnValue(readChain({data: null}) as never);
    expect(await listProjectsForDashboard('u1')).toEqual({ok: true, data: []});
  });

  it('returns ok:false (never throws) on a supabase error', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      readChain({data: null, error: {message: 'permission denied'}}) as never,
    );
    const result = await listProjectsForDashboard('u1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('permission denied');
  });
});
