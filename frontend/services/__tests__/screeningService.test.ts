import {http, HttpResponse} from 'msw';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));

import {fetchScreeningRecords} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

function captureSearch(): {search: string | null} {
  const seen: {search: string | null} = {search: null};
  server.use(
    http.get('*/api/v1/projects/:projectId/screening/records', ({request}) => {
      seen.search = new URL(request.url).search;
      return HttpResponse.json({ok: true, data: {rows: []}});
    }),
  );
  return seen;
}

describe('fetchScreeningRecords', () => {
  it('sends no query string without a phase', async () => {
    const seen = captureSearch();
    const result = await fetchScreeningRecords('p1');
    expect(result.ok).toBe(true);
    expect(seen.search).toBe('');
  });

  it('sends the phase when given', async () => {
    const seen = captureSearch();
    await fetchScreeningRecords('p1', 'title_abstract');
    expect(seen.search).toBe('?phase=title_abstract');
  });
});
