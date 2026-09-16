import {describe, expect, it, vi, beforeEach} from 'vitest';

// The CI vitest job runs with NO VITE_ env. `@/integrations/api/client`
// imports the supabase client at module load, which calls `createClient('')`
// and throws `supabaseUrl is required` — so `importActual` below cannot load
// it unmocked (repo convention, see useAddEntry.test.tsx).
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: null}})}},
}));

vi.mock('@/integrations/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/integrations/api/client')>(
    '@/integrations/api/client',
  );
  return {...actual, apiClient: vi.fn()};
});

import {apiClient} from '@/integrations/api/client';
import {
  cancelExtractionBatch,
  getExtractionBatch,
  listExtractionBatches,
  resumeExtractionBatch,
  startExtractionBatch,
} from '@/services/extractionBatchService';

const mocked = vi.mocked(apiClient);

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue({} as never);
});

describe('extractionBatchService', () => {
  it('POSTs the snake_case start payload', async () => {
    await startExtractionBatch({
      project_id: 'p1',
      template_id: 't1',
      article_ids: ['a1', 'a2'],
      skip_articles_with_ai_suggestions: true,
    });
    expect(mocked).toHaveBeenCalledWith('/api/v1/extraction/batches', {
      method: 'POST',
      body: {
        project_id: 'p1',
        template_id: 't1',
        article_ids: ['a1', 'a2'],
        skip_articles_with_ai_suggestions: true,
      },
    });
  });

  it('lists active batches for a project with query params', async () => {
    mocked.mockResolvedValue([] as never);
    await listExtractionBatches({projectId: 'p1', active: true});
    expect(mocked).toHaveBeenCalledWith(
      '/api/v1/extraction/batches?project_id=p1&active=true',
    );
  });

  it('omits absent list params', async () => {
    mocked.mockResolvedValue([] as never);
    await listExtractionBatches({});
    expect(mocked).toHaveBeenCalledWith('/api/v1/extraction/batches');
  });

  it('encodes the batch id on detail, cancel and resume', async () => {
    await getExtractionBatch('b/1');
    expect(mocked).toHaveBeenLastCalledWith('/api/v1/extraction/batches/b%2F1');
    await cancelExtractionBatch('b1');
    expect(mocked).toHaveBeenLastCalledWith('/api/v1/extraction/batches/b1/cancel', {
      method: 'POST',
    });
    await resumeExtractionBatch('b1');
    expect(mocked).toHaveBeenLastCalledWith('/api/v1/extraction/batches/b1/resume', {
      method: 'POST',
    });
  });
});
