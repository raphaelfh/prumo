import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RequestLog {
  table: string;
  /** One entry per `.in()` filter on the request: [column, id count]. */
  filters: Array<[string, number]>;
}

const h = vi.hoisted(() => ({
  instanceRows: [] as Array<{
    id: string;
    article_id: string;
    entity_type_id: string;
  }>,
  requests: [] as RequestLog[],
  /**
   * Matches UUIDS_PER_VALUE_REQUEST: every id of every `.in()` filter rides
   * in the same query string, so the gateway rejects on their *sum*, not on
   * any single filter.
   */
  maxIds: 100,
  rangeCalls: [] as Array<[number, number]>,
  /** Articles whose extraction was never started have no form run. */
  noFormRuns: false,
}));

function thenableQuery(table: string) {
  let range: [number, number] | null = null;
  const log: RequestLog = { table, filters: [] };
  const q: {
    select: () => typeof q;
    eq: () => typeof q;
    order: () => typeof q;
    in: (col: string, ids: string[]) => typeof q;
    range: (from: number, to: number) => typeof q;
    then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => Promise<unknown>;
  } = {
    select: () => q,
    eq: () => q,
    order: () => q,
    in: (col, ids) => {
      log.filters.push([col, ids.length]);
      return q;
    },
    range: (from, to) => {
      range = [from, to];
      h.rangeCalls.push([from, to]);
      return q;
    },
    then: (resolve) => {
      if (log.filters.length > 0) h.requests.push(log);
      const ids = log.filters.reduce((sum, [, n]) => sum + n, 0);
      if (ids > h.maxIds) {
        return Promise.resolve(
          resolve({ data: null, error: { message: `URI too long: ${ids} ids` } }),
        );
      }
      if (table === 'extraction_instances') {
        const [from, to] = range ?? [0, 999];
        return Promise.resolve(
          resolve({ data: h.instanceRows.slice(from, to + 1), error: null }),
        );
      }
      return Promise.resolve(resolve({ data: [], error: null }));
    },
  };
  return q;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => thenableQuery(table),
  },
}));

vi.mock('@/services/extractionValueService', () => ({
  ExtractionValueService: {
    // One form run per article — the prod shape.
    findFormRunsByArticle: vi.fn(async (articleIds: string[]) => {
      const m = new Map<string, string>();
      if (h.noFormRuns) return m;
      for (const id of articleIds) m.set(id, `run-${id}`);
      return m;
    }),
  },
}));

import { loadArticleProgressData } from './loadArticleProgressData';

function makeInstances(count: number, articleCount: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `i${String(i).padStart(4, '0')}`,
    article_id: `a${i % articleCount}`,
    entity_type_id: 'e1',
  }));
}

/** Every `.in()` filter of every value request, flattened. */
function valueRequests() {
  return h.requests.filter((r) => r.table !== 'extraction_instances');
}

beforeEach(() => {
  h.instanceRows = [];
  h.requests = [];
  h.rangeCalls = [];
  h.noFormRuns = false;
});

describe('loadArticleProgressData — PostgREST page + URL limits', () => {
  it('pages instances past 1000 and never sends a giant .in() (trees worklist)', async () => {
    // Prod shape: ML multimodal heart failure on 2026-09-13 — 1043 instances
    // across 11 articles. One unpaged select + one .in(1043) zeroed the list.
    h.instanceRows = makeInstances(1043, 11);

    const map = await loadArticleProgressData('proj', 'tpl', 'user-1', 'extraction');

    expect(h.rangeCalls.length).toBeGreaterThanOrEqual(2);
    expect(h.rangeCalls[0]).toEqual([0, 999]);
    expect(h.rangeCalls[1]?.[0]).toBe(1000);
    expect(valueRequests().length).toBeGreaterThan(1);
    expect(map.size).toBe(11);
    expect(map.get('a0')?.instances.length).toBeGreaterThan(0);
  });

  it('keeps the run filter bounded when the project has many articles', async () => {
    // A project-wide `.in(run_id, …)` grows one uuid per article: 300
    // articles overflowed the same URL the instance filter used to.
    h.instanceRows = makeInstances(300, 300);

    const map = await loadArticleProgressData('proj', 'tpl', 'user-1', 'extraction');

    expect(map.size).toBe(300);
    for (const req of valueRequests()) {
      const ids = req.filters.reduce((sum, [, n]) => sum + n, 0);
      expect(ids).toBeLessThanOrEqual(h.maxIds);
    }
  });

  it('lists articles with no form run instead of dropping them', async () => {
    // Extraction never started: the article has instances but no run, so it
    // must still reach the worklist — as 0%, not as a missing row.
    h.instanceRows = makeInstances(10, 2);
    h.noFormRuns = true;

    const map = await loadArticleProgressData('proj', 'tpl', 'user-1', 'extraction');

    expect(map.size).toBe(2);
    expect(map.get('a0')?.instances.length).toBe(5);
    expect(map.get('a0')?.values).toEqual([]);
    expect(valueRequests()).toEqual([]);
  });

  it('returns an empty map when the template has no instances', async () => {
    h.instanceRows = [];
    const map = await loadArticleProgressData('proj', 'tpl', 'user-1', 'extraction');
    expect(map.size).toBe(0);
    expect(valueRequests()).toEqual([]);
  });
});
