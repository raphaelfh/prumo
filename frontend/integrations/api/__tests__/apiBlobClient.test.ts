import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBlobClient } from '@/integrations/api/client';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'tok' } },
      }),
    },
  },
}));

function res(init: { status: number; headers?: Record<string, string>; body?: BodyInit | null }) {
  return new Response(init.body ?? null, { status: init.status, headers: init.headers });
}

describe('apiBlobClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a sync blob + parsed filename on 200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      res({
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="charms_export.xlsx"',
        },
        body: 'PK\x03\x04binary',
      }),
    );
    const out = await apiBlobClient('/api/v1/x', { method: 'POST', body: { a: 1 } });
    expect(out.kind).toBe('sync');
    if (out.kind === 'sync') {
      expect(out.filename).toBe('charms_export.xlsx');
      expect(out.blob.size).toBeGreaterThan(0);
    }
  });

  it('returns an async job_id on 202', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      res({ status: 202, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { job_id: 'job-1' } }) }),
    );
    const out = await apiBlobClient('/api/v1/x', { method: 'POST', body: {} });
    expect(out).toEqual({ kind: 'async', job_id: 'job-1' });
  });

  it('throws ApiError carrying error.message on a 422 JSON envelope', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      res({ status: 422, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'too many columns' } }) }),
    );
    await expect(apiBlobClient('/api/v1/x', { method: 'POST', body: {} })).rejects.toMatchObject({
      name: 'ApiError',
      message: 'too many columns',
      status: 422,
    });
  });

  it('rejects a 200 that is actually a JSON error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      res({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: { message: 'boom' } }) }),
    );
    await expect(apiBlobClient('/api/v1/x', { method: 'POST', body: {} })).rejects.toMatchObject({ message: 'boom' });
  });
});
