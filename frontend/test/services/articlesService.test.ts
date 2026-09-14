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
import type {ErrorResult} from '@/lib/error-utils';
import {
  fetchProjectArticles,
  insertArticle,
  loadExtractionTableArticles,
  uploadArticleFile,
} from '@/services/articlesService';

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

// ---------------------------------------------------------------------------
// Project-wide article lists
// ---------------------------------------------------------------------------

describe('articlesService — project article lists', () => {
  beforeEach(() => vi.clearAllMocks());

  /** PostgREST answers at most 1000 rows per request, without saying so. */
  function mockArticleRows(total: number) {
    const rows = Array.from({length: total}, (_, i) => ({
      id: `art-${String(i).padStart(4, '0')}`,
      title: `T${i}`,
      authors: null,
      publication_year: null,
      doi: null,
      created_at: '2026-01-01T00:00:00Z',
    }));
    const ranges: Array<[number, number]> = [];
    const orderedBy: string[] = [];
    let range: [number, number] | null = null;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    const order = vi.fn((column: string, _opts?: {ascending?: boolean}) => {
      orderedBy.push(column);
      return chain;
    });
    chain.order = order;
    chain.range = vi.fn((from: number, to: number) => {
      range = [from, to];
      ranges.push([from, to]);
      return chain;
    });
    chain.then = (resolve: (v: {data: unknown; error: null}) => unknown) => {
      const [from, to] = range ?? [0, 999];
      return Promise.resolve(
        resolve({data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null}),
      );
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);
    return {ranges, orderedBy, order};
  }

  type ListLoader = (projectId: string) => Promise<ErrorResult<unknown[]>>;
  const loaders: Array<[string, ListLoader]> = [
    ['loadExtractionTableArticles', loadExtractionTableArticles],
    ['fetchProjectArticles', fetchProjectArticles],
  ];

  it.each(loaders)(
    '%s pages past the 1000-row cap instead of silently truncating',
    async (_name, load) => {
      // A single unpaged select drops article 1001 onward — and the worklist,
      // the dashboard and the HITL list then disagree about how many exist.
      const {ranges} = mockArticleRows(1200);

      const result = await load('proj-1');

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toHaveLength(1200);
      expect(ranges[0]).toEqual([0, 999]);
      expect(ranges[1]?.[0]).toBe(1000);
    },
  );

  it.each(loaders)('%s breaks created_at ties on a second column', async (_name, load) => {
    // Seeded articles share a created_at. Without a tiebreaker the order is
    // undefined across requests, so a row can repeat on one page and vanish
    // from the next.
    const {orderedBy} = mockArticleRows(3);

    await load('proj-1');

    expect(orderedBy).toEqual(['created_at', 'id']);
  });

  it.each(loaders)('%s stops paging on the first short page', async (_name, load) => {
    // 1200 rows = one full page, then a short page of 200. No third request.
    const {ranges} = mockArticleRows(1200);
    await load('proj-1');
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });
  it.each(loaders)('%s orders by created_at descending, then id ascending', async (_name, load) => {
    const {order} = mockArticleRows(3);
    await load('proj-1');
    expect(order.mock.calls).toEqual([['created_at', {ascending: false}], ['id']]);
  });
});
