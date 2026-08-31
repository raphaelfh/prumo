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
import {insertArticle, uploadArticleFile} from '@/services/articlesService';

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

  it('registration failure — result is ok:false and the object is NOT removed', async () => {
    const storageRemove = vi.fn(async () => ({error: null}));

    vi.mocked(supabase.storage.from).mockReturnValue({
      upload: vi.fn(async () => ({error: null})),
      remove: storageRemove,
    } as never);

    // apiClient rejects → registration failed after the bytes landed
    vi.mocked(apiClient).mockRejectedValueOnce(new Error('constraint violation'));

    const result = await uploadArticleFile({
      projectId: 'proj-1',
      articleId: 'art-4',
      storageKey: 'proj-1/art-4/file.pdf',
      file: FAKE_PDF,
      role: 'MAIN',
    });

    expect(result.ok).toBe(false);
    // The rollback that used to live here was never correct. On a 503 the
    // backend has ALREADY committed the article_files row (it commits before
    // enqueueing, then marks parse_failed), so removing the object destroys the
    // bytes that /article-files/{id}/reparse exists to recover. On a 4xx there
    // is no row, so the storage DELETE policy — which requires a matching
    // article_files row — denies the delete anyway, and the result was never
    // checked. Useless in one branch, destructive in the other.
    expect(storageRemove).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// insertArticle
// ---------------------------------------------------------------------------

describe('articlesService.insertArticle', () => {
  beforeEach(() => vi.clearAllMocks());

  function mockInsertResult(result: {data: unknown; error: unknown}) {
    const chain: Record<string, unknown> = {};
    chain.insert = vi.fn(() => chain);
    chain.select = vi.fn(() => chain);
    chain.single = vi.fn(async () => result);
    vi.mocked(supabase.from).mockReturnValue(chain as never);
    return chain;
  }

  it('returns the id of the row the database created', async () => {
    mockInsertResult({data: {id: 'art-created-7'}, error: null});

    const result = await insertArticle({project_id: 'proj-1', title: 'T'} as never);

    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual({id: 'art-created-7'});
  });

  it('reports failure when the insert errors', async () => {
    mockInsertResult({data: null, error: {message: 'row-level security'}});

    const result = await insertArticle({project_id: 'proj-1', title: 'T'} as never);

    expect(result.ok).toBe(false);
  });

  it('reports failure rather than throwing when the row comes back null', async () => {
    // PostgREST can answer {data: null, error: null} — reading .id off that is a
    // TypeError, which would escape as an unhandled rejection rather than an
    // ErrorResult. The suite's own shared mock returns exactly this shape.
    mockInsertResult({data: null, error: null});

    const result = await insertArticle({project_id: 'proj-1', title: 'T'} as never);

    expect(result.ok).toBe(false);
  });
});
