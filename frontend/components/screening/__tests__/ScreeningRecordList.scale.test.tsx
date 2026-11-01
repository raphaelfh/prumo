/**
 * The 5,000-row size target (spec §4.6): the list mounts a window of rows
 * (unwindowed, jsdom measured 1.8–4.6 s to mount). Measures (a) mount, (b) a
 * status-view switch until its rows show, (c) a re-render after a refetch
 * delivers a new read, best of three attempts, and logs the numbers (the PR
 * records them; the default reporter hides a passing test's log, so run it
 * with --reporter=verbose). Strict 200 ms budget locally; under CI a generous
 * 2,000 ms ceiling, so a slow shared runner does not flake the required suite
 * while a gross regression still fails.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));

import {ScreeningRecordList} from '@/components/screening/ScreeningRecordList';
import type {StatusView} from '@/lib/screening/records';
import type {ScreeningConfigRead, ScreeningRecordRow, ScreeningRecordsRead} from '@/services/screeningService';

const ROWS = 5000;
const budget = process.env.CI ? 2000 : 200;

const STATUSES: ScreeningRecordRow['status'][] = ['to_screen', 'waiting', 'included', 'excluded'];

function rows(decidedEvery: number): ScreeningRecordRow[] {
  return Array.from({length: ROWS}, (_, index) => ({
    article_id: `art${index}`,
    assignment_id: `as${index}`,
    doi: null,
    first_author: `Author ${index}`,
    has_pdf: false,
    ingestion_source: 'pubmed',
    journal_title: `Journal ${index % 40}`,
    my_decision: null,
    my_exclusion_reason: null,
    outcome: null,
    outcome_exclusion_reason: null,
    outcome_kind: null,
    ta_outcome: null,
    ta_outcome_kind: null,
    ta_reviewer_count: null,
    pmid: null,
    publication_year: 1990 + (index % 35),
    queue_rank: index + 1,
    status: index % decidedEvery === 0 ? 'included' : STATUSES[index % STATUSES.length],
    title: `Record ${index}`,
  }));
}

const read = (decidedEvery: number): ScreeningRecordsRead => ({
  exclusion_reasons: [],
  inclusion_criteria: [],
  phase: 'title_abstract',
  reviewer_count: 2,
  rows: rows(decidedEvery),
});

const CONFIG: ScreeningConfigRead = {
  can_arbitrate: false,
  can_manage: false,
  can_review: true,
  enrolled: ROWS,
  exclusion_reasons: [],
  not_enrolled: 0,
  reviewer_capable: 2,
  reviewer_count: 2,
  reviewer_count_locked: true,
  full_text_reviewer_count: null,
  full_text_count_locked: false,
  full_text_ready: 0,
  full_text_enrolled: 0,
};

const EMPTY = new Set<string>();
/** Body rows the table announces (aria-rowcount counts the header row too). */
const rowCount = () => Number(screen.getByRole('table').getAttribute('aria-rowcount')) - 1;
const noop = () => {};

function List({data, status, onStatusChange}: {data: ScreeningRecordsRead; status: StatusView; onStatusChange: (s: StatusView) => void}) {
  return (
    <ScreeningRecordList
      projectId="p1"
      read={data}
      config={CONFIG}
      status={status}
      onStatusChange={onStatusChange}
      activeArticleId={null}
      cursorArticleId={null}
      onOpenRow={noop}
      checkedIds={EMPTY}
      onCheckedChange={noop}
      onToggleRow={noop}
      toolbarActions={null}
      keepArticleIds={EMPTY}
      onFiltersChange={noop}
      maximized={false}
    />
  );
}

const ATTEMPTS = 3;

describe('ScreeningRecordList at 5,000 rows', () => {
  it('windows 5,000 rows, switches a status view and re-renders after a refetch', () => {
    const client = new QueryClient();
    let status: StatusView = 'all';
    const wrap = (data: ScreeningRecordsRead) => (
      <QueryClientProvider client={client}>
        <List data={data} status={status} onStatusChange={(next) => (status = next)} />
      </QueryClientProvider>
    );
    // Built before any clock starts: the reads arrive from the cache.
    const loaded = read(7);
    // A decision refetch: a new read object, more rows decided.
    const refetched = read(5);

    /** One mount → status switch → refetch sequence, in ms. */
    const attempt = () => {
      status = 'all';
      let start = performance.now();
      const view = render(wrap(loaded));
      const mount = performance.now() - start;
      expect(rowCount()).toBe(ROWS);
      expect(screen.getAllByRole('row').length).toBeLessThan(100);

      start = performance.now();
      fireEvent.click(screen.getByRole('tab', {name: /^To screen/}));
      act(() => view.rerender(wrap(loaded)));
      const switchView = performance.now() - start;
      expect(status).toBe('to_screen');
      const toScreen = rowCount();
      expect(toScreen).toBeGreaterThan(0);
      expect(toScreen).toBeLessThan(ROWS);

      start = performance.now();
      act(() => view.rerender(wrap(refetched)));
      const refetch = performance.now() - start;
      expect(rowCount()).not.toBe(toScreen);
      view.unmount();
      return {mount, switchView, refetch};
    };

    // Best of three: the floor is the render cost; the spread is the
    // scheduler (a loaded machine or a parallel suite), not the list.
    const runs = Array.from({length: ATTEMPTS}, attempt);
    const best = (key: keyof (typeof runs)[number]) => Math.min(...runs.map((run) => run[key]));
    const [mount, switchView, refetch] = [best('mount'), best('switchView'), best('refetch')];
    const all = runs.map((run) => `${run.mount.toFixed(0)}/${run.switchView.toFixed(0)}/${run.refetch.toFixed(0)}`);

    console.info(
      `[scale] 5,000 rows (best of ${ATTEMPTS}): mount ${mount.toFixed(0)} ms, status switch ${switchView.toFixed(0)} ms, refetch re-render ${refetch.toFixed(0)} ms (budget ${budget} ms; runs ${all.join(', ')})`,
    );
    expect(mount).toBeLessThan(budget);
    expect(switchView).toBeLessThan(budget);
    expect(refetch).toBeLessThan(budget);
  });
});
