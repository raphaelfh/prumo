import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Article} from '@/types/article';

// A Supabase builder that serves a server capped at 1,000 rows: without an
// explicit .range() a read returns at most the cap; with one, exactly the
// requested window.
function makeCappedQuery(all: Record<string, unknown>[], cap = 1000) {
  const calls: Array<[number, number]> = [];
  const orders: Array<{column: string; ascending: boolean}> = [];
  let ranged = false;
  let from = 0;
  let to = 0;
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order(column: string, opts: {ascending: boolean}) {
      orders.push({column, ascending: opts.ascending});
      return builder;
    },
    range(fromArg: number, toArg: number) {
      ranged = true;
      from = fromArg;
      to = toArg;
      calls.push([fromArg, toArg]);
      return builder;
    },
    then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
      const end = ranged ? to : Math.min(all.length, cap) - 1;
      const page = end < from ? [] : all.slice(from, end + 1);
      Promise.resolve({data: page, error: null}).then(resolve, reject);
    },
  };
  return {builder, calls, orders};
}

let query: ReturnType<typeof makeCappedQuery>;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => query.builder,
  },
}));

import {loadProjectArticles} from '@/services/projectsService';

function rows(count: number): Record<string, unknown>[] {
  return Array.from({length: count}, (_, i) => ({id: `a${count - i}`})) as Record<string, unknown>[];
}

describe('loadProjectArticles', () => {
  beforeEach(() => {
    query = makeCappedQuery(rows(2500));
  });

  it('pages past the server max-rows cap and returns every article', async () => {
    const result = await loadProjectArticles('p1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as Article[]).length).toBe(2500);
    expect(query.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('stops paging on a short page', async () => {
    query = makeCappedQuery(rows(120));

    const result = await loadProjectArticles('p1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as Article[]).length).toBe(120);
    expect(query.calls).toEqual([[0, 999]]);
  });

  it('orders by created_at with an id tie-break so page windows are stable', async () => {
    // One import batch shares one created_at (#1053): 1,500 rows on a single
    // timestamp, so created_at alone cannot tell the server where one page
    // ends and the next begins.
    const tied = Array.from({length: 1500}, (_, i) => ({
      id: `a${1500 - i}`,
      created_at: '2026-10-24T00:00:00',
    }));
    query = makeCappedQuery(tied as unknown as Record<string, unknown>[]);

    const result = await loadProjectArticles('p1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as Article[];
    expect(data.length).toBe(1500);
    expect(query.orders.slice(0, 2)).toEqual([
      {column: 'created_at', ascending: false},
      {column: 'id', ascending: false},
    ]);
  });

  it('dedupes a row repeated at a page boundary by a concurrent insert', async () => {
    // An insert while page 2 is being read shifts every later row down one
    // offset, so the last row of page 1 comes back as the first row of page 2.
    const shifted = [...rows(2000)];
    query = makeCappedQuery([]);
    let readCount = 0;
    query.builder.then = ((
      resolve: (value: unknown) => void,
      reject: (reason: unknown) => void,
    ) => {
      readCount += 1;
      const page =
        readCount === 1
          ? shifted.slice(0, 1000)
          : readCount === 2
            ? [shifted[999], ...shifted.slice(1000, 2000)]
            : [];
      Promise.resolve({data: page, error: null}).then(resolve, reject);
    }) as typeof query.builder.then;

    const result = await loadProjectArticles('p1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as Article[];
    expect(data.length).toBe(2000);
    expect(new Set(data.map((a) => a.id)).size).toBe(2000);
  });
});
