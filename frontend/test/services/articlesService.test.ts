// frontend/test/services/articlesService.test.ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const storageMock = {remove: vi.fn(), upload: vi.fn()};
  const storageFrom = vi.fn(() => storageMock);
  const dbChain: Record<string, unknown> = {};
  dbChain.insert = vi.fn(() => dbChain);
  dbChain.select = vi.fn(() => dbChain);
  dbChain.delete = vi.fn(() => dbChain);
  dbChain.eq = vi.fn(() => dbChain);
  dbChain.single = vi.fn(async () => ({data: null, error: null}));
  const from = vi.fn(() => dbChain);
  return {supabase: {from, storage: {from: storageFrom}}};
});

vi.mock('@/integrations/api', () => ({apiClient: vi.fn(async () => ({}))}));

// file-validation is a pure util — let it run, or stub it simply
vi.mock('@/lib/file-validation', () => ({detectFileFormat: vi.fn(() => 'application/pdf')}));

import {supabase} from '@/integrations/supabase/client';
import {apiClient} from '@/integrations/api';
import {uploadArticleFile} from '@/services/articlesService';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_PDF = new File(['%PDF'], 'test.pdf', {type: 'application/pdf'});

// ---------------------------------------------------------------------------
// uploadArticleFile
// ---------------------------------------------------------------------------

describe('articlesService.uploadArticleFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('article_files insert failure — storage object removed and result is ok:false', async () => {
    const storageRemove = vi.fn(async () => ({error: null}));

    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn(async () => ({error: null})),
      remove: storageRemove,
    } as never);

    // apiClient rejects → triggers storage rollback
    vi.mocked(apiClient).mockRejectedValueOnce(new Error('constraint violation'));

    const result = await uploadArticleFile({
      projectId: 'proj-1',
      articleId: 'art-4',
      storageKey: 'proj-1/art-4/file.pdf',
      file: FAKE_PDF,
      role: 'MAIN',
    });

    expect(result.ok).toBe(false);
    expect(storageRemove).toHaveBeenCalledWith(['proj-1/art-4/file.pdf']);
    // The article_files table is never touched directly — registration goes
    // through the backend endpoint, not a PostgREST insert.
    const fromCalls = vi.mocked(supabase.from).mock.calls.map(c => c[0]);
    expect(fromCalls).not.toContain('article_files');
  });
});

describe('articlesService.uploadArticleFile — backend confirm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers supplements via the backend, not a direct insert', async () => {
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn(async () => ({error: null})),
      remove: vi.fn(async () => ({error: null})),
    } as never);

    const res = await uploadArticleFile({
      projectId: 'proj-1',
      articleId: 'art-1',
      storageKey: 'proj-1/art-1/supp.pdf',
      file: FAKE_PDF,
      role: 'SUPPLEMENT',
    } as never);

    expect(res.ok).toBe(true);
    expect(apiClient).toHaveBeenCalledWith(
      '/api/v1/articles/art-1/files',
      expect.objectContaining({method: 'POST'}),
    );
    const fromCalls = vi.mocked(supabase.from).mock.calls.map(c => c[0]);
    expect(fromCalls).not.toContain('article_files');
  });
});
