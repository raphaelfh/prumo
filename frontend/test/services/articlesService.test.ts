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
import {addArticle, uploadArticleFile} from '@/services/articlesService';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ARTICLE_DATA = {
  project_id: 'proj-1',
  title: 'Test Article',
  abstract: null,
  authors: null,
  publication_year: null,
  publication_month: null,
  journal_title: null,
  journal_issn: null,
  volume: null,
  issue: null,
  pages: null,
  doi: null,
  pmid: null,
  pmcid: null,
  keywords: null,
  url_landing: null,
};

const FAKE_PDF = new File(['%PDF'], 'test.pdf', {type: 'application/pdf'});

// ---------------------------------------------------------------------------
// addArticle
// ---------------------------------------------------------------------------

describe('articlesService.addArticle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('storage upload failure — article row is deleted and result is ok:false', async () => {
    // Article insert succeeds
    vi.mocked(supabase.from).mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.insert = vi.fn(() => c);
      c.select = vi.fn(() => c);
      c.delete = vi.fn(() => c);
      c.eq = vi.fn(async () => ({data: null, error: null}));
      c.single = vi.fn(async () => ({data: {id: 'art-1'}, error: null}));
      return c as never;
    });
    // Storage upload fails
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn(async () => ({error: {message: 'upload failed'}})),
      remove: vi.fn(async () => ({error: null})),
    } as never);

    const result = await addArticle(ARTICLE_DATA, {
      file: FAKE_PDF,
      detectedFormat: 'application/pdf',
    });

    expect(result.ok).toBe(false);
    // The delete call should have been made on 'articles'
    const fromCalls = vi.mocked(supabase.from).mock.calls;
    const deletedOnArticles = fromCalls.some(([table]) => table === 'articles');
    expect(deletedOnArticles).toBe(true);
  });

  it('article_files insert failure — storage object removed AND article row deleted', async () => {
    // After the change: apiClient rejection triggers the rollback path
    let callIndex = 0;
    const articleDeleteEq = vi.fn(async () => ({data: null, error: null}));
    const storageRemove = vi.fn(async () => ({error: null}));

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'articles') {
        callIndex++;
        if (callIndex === 1) {
          // First call: insert succeeds
          const c: Record<string, unknown> = {};
          c.insert = vi.fn(() => c);
          c.select = vi.fn(() => c);
          c.single = vi.fn(async () => ({data: {id: 'art-2'}, error: null}));
          return c as never;
        }
        // Second call: delete rollback
        const c: Record<string, unknown> = {};
        c.delete = vi.fn(() => c);
        c.eq = articleDeleteEq;
        return c as never;
      }
      // No article_files PostgREST calls expected any more
      const c: Record<string, unknown> = {};
      c.insert = vi.fn(async () => ({error: null}));
      return c as never;
    });

    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn(async () => ({error: null})),
      remove: storageRemove,
    } as never);

    // apiClient rejects → triggers rollback
    vi.mocked(apiClient).mockRejectedValueOnce(new Error('constraint violation'));

    const result = await addArticle(ARTICLE_DATA, {
      file: FAKE_PDF,
      detectedFormat: 'application/pdf',
    });

    expect(result.ok).toBe(false);
    // Storage object removed
    expect(storageRemove).toHaveBeenCalled();
    // Article row deleted
    expect(articleDeleteEq).toHaveBeenCalledWith('id', 'art-2');
  });

  it('happy path — article insert + storage upload + backend confirm called (no direct article_files insert)', async () => {
    const storageUpload = vi.fn(async () => ({error: null}));

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'articles') {
        const c: Record<string, unknown> = {};
        c.insert = vi.fn(() => c);
        c.select = vi.fn(() => c);
        c.single = vi.fn(async () => ({data: {id: 'art-3'}, error: null}));
        return c as never;
      }
      // article_files should NOT be called — fail loudly if it is
      return {insert: vi.fn(async () => ({error: {message: 'unexpected article_files insert'}})) } as never;
    });

    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: storageUpload,
    } as never);

    const result = await addArticle(ARTICLE_DATA, {
      file: FAKE_PDF,
      detectedFormat: 'application/pdf',
    });

    expect(result.ok).toBe(true);
    expect(storageUpload).toHaveBeenCalled();
    // Backend confirm endpoint was called
    expect(apiClient).toHaveBeenCalledWith(
      '/api/v1/articles/art-3/files',
      expect.objectContaining({method: 'POST'}),
    );
    // No direct article_files PostgREST insert
    const fromCalls = vi.mocked(supabase.from).mock.calls.map(c => c[0]);
    expect(fromCalls).not.toContain('article_files');
  });
});

// ---------------------------------------------------------------------------
// addArticle — backend confirm (new test from brief)
// ---------------------------------------------------------------------------

describe('articlesService.addArticle — backend confirm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers the file via the backend, not a direct article_files insert', async () => {
    // article insert + storage upload succeed
    vi.mocked(supabase.from).mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.insert = vi.fn(() => c);
      c.select = vi.fn(() => c);
      c.single = vi.fn(async () => ({data: {id: 'art-1'}, error: null}));
      c.delete = vi.fn(() => c);
      c.eq = vi.fn(() => c);
      return c;
    });
    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn(async () => ({error: null})),
      remove: vi.fn(async () => ({error: null})),
    } as never);

    const res = await addArticle(ARTICLE_DATA as never, {
      file: FAKE_PDF,
      detectedFormat: 'PDF',
    } as never);

    expect(res.ok).toBe(true);
    expect(apiClient).toHaveBeenCalledWith(
      '/api/v1/articles/art-1/files',
      expect.objectContaining({method: 'POST'}),
    );
    // No direct article_files PostgREST insert anymore:
    const fromCalls = vi.mocked(supabase.from).mock.calls.map(c => c[0]);
    expect(fromCalls).not.toContain('article_files');
  });
});

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

    vi.mocked(supabase.from).mockImplementation(() => ({
      insert: vi.fn(async () => ({error: {message: 'insert failed'}})),
    } as never));

    const result = await uploadArticleFile({
      projectId: 'proj-1',
      articleId: 'art-4',
      storageKey: 'proj-1/art-4/file.pdf',
      file: FAKE_PDF,
      role: 'MAIN',
    });

    expect(result.ok).toBe(false);
    expect(storageRemove).toHaveBeenCalledWith(['proj-1/art-4/file.pdf']);
    expect(vi.mocked(supabase.from)).toHaveBeenCalledWith('article_files');
  });
});
