/**
 * Contract tests for fetchModelProgress.
 *
 * These tests pin the frontend ↔ Supabase RPC contract for
 * `calculate_model_progress`. If the argument names or the RPC name
 * drift, Supabase returns PGRST202 (unknown function) and the UI
 * silently shows 0% progress for every model instance. The mocks here
 * catch that class of regression before it reaches production.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const rpc = vi.fn();
  return {supabase: {rpc}};
});

import {supabase} from '@/integrations/supabase/client';
import {fetchModelProgress} from '@/services/extractionInstanceService';

const rpcMock = supabase.rpc as ReturnType<typeof vi.fn>;

describe('fetchModelProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls supabase.rpc with the exact argument names required by the DB function', async () => {
    // The DB function signature is:
    //   calculate_model_progress(p_article_id uuid, p_model_id uuid)
    // Wrong keys → PGRST202 → silent 0% progress; this test catches that.
    rpcMock.mockResolvedValueOnce({
      data: [{completed_fields: 3, total_fields: 5, percentage: '60'}],
      error: null,
    });

    const result = await fetchModelProgress('a-1', 'model-instance-1');

    expect(rpcMock).toHaveBeenCalledOnce();
    expect(rpcMock).toHaveBeenCalledWith('calculate_model_progress', {
      p_article_id: 'a-1',
      p_model_id: 'model-instance-1',
    });
    expect(result).toEqual({completed: 3, total: 5, percentage: 60});
  });

  it('returns a zero-progress object when the RPC returns an error', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {message: 'relation does not exist', code: 'PGRST202'},
    });

    const result = await fetchModelProgress('a-1', 'model-instance-1');

    expect(result).toEqual({completed: 0, total: 0, percentage: 0});
  });

  it('returns zero progress when the RPC returns an empty result set', async () => {
    rpcMock.mockResolvedValueOnce({data: [], error: null});

    const result = await fetchModelProgress('a-1', 'model-instance-1');

    expect(result).toEqual({completed: 0, total: 0, percentage: 0});
  });
});
