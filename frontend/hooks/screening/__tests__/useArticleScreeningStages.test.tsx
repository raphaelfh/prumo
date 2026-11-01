import {act, render, renderHook, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));

import {useArticleScreeningStages} from '@/hooks/screening/useArticleScreeningStages';
import {invalidateScreening} from '@/lib/query-keys/screening';
import type {ScreeningConfigRead, ScreeningRecordRow, ScreeningRecordsRead} from '@/services/screeningService';
import {createQueryWrapper} from '@/test/helpers/queryClientWrapper';
import {server} from '@/test/mocks/server';

const CONFIG_URL = '*/api/v1/projects/:projectId/screening/config';
const RECORDS_URL = '*/api/v1/projects/:projectId/screening/records';

const CONFIG: ScreeningConfigRead = {
  can_arbitrate: false,
  can_manage: true,
  can_review: true,
  enrolled: 2,
  exclusion_reasons: [],
  full_text_count_locked: false,
  full_text_enrolled: 0,
  full_text_ready: 0,
  full_text_reviewer_count: null,
  not_enrolled: 0,
  reviewer_capable: 2,
  reviewer_count: 1,
  reviewer_count_locked: false,
} as ScreeningConfigRead;

function row(articleId: string, status: ScreeningRecordRow['status']): ScreeningRecordRow {
  return {
    article_id: articleId,
    assignment_id: `as-${articleId}`,
    phase: 'title_abstract',
    doi: null,
    first_author: null,
    has_pdf: false,
    ingestion_source: null,
    journal_title: null,
    my_decision: null,
    my_exclusion_reason: null,
    outcome: null,
    outcome_exclusion_reason: null,
    outcome_kind: null,
    ta_outcome: null,
    ta_outcome_kind: null,
    ta_reviewer_count: null,
    pmid: null,
    publication_year: null,
    queue_rank: 0,
    status,
    title: 'A record',
  };
}

function records(rows: ScreeningRecordRow[], removed: string[] = []): ScreeningRecordsRead {
  return {
    phase: null,
    removed_duplicate_ids: removed,
    rows,
    exclusion_reasons: [],
    inclusion_criteria: [],
    reviewer_count: 1,
  } as ScreeningRecordsRead;
}

type Counts = {config: number; records: number; urls: string[]};

function serve(config: Partial<ScreeningConfigRead>, body: ScreeningRecordsRead, recordsStatus = 200): Counts {
  const counts: Counts = {config: 0, records: 0, urls: []};
  server.use(
    http.get(CONFIG_URL, () => {
      counts.config += 1;
      return HttpResponse.json({ok: true, data: {...CONFIG, ...config}});
    }),
    http.get(RECORDS_URL, ({request}) => {
      counts.records += 1;
      counts.urls.push(request.url);
      if (recordsStatus !== 200) {
        return HttpResponse.json({ok: false, error: {code: 'BOOM', message: 'x'}}, {status: recordsStatus});
      }
      return HttpResponse.json({ok: true, data: body});
    }),
  );
  return counts;
}

describe('useArticleScreeningStages', () => {
  it('full text on prefixes a TA-included row', async () => {
    const ta = records([row('a1', 'included')]);
    serve({full_text_reviewer_count: null}, ta);
    const off = renderHook(() => useArticleScreeningStages('p1'), {wrapper: createQueryWrapper().wrapper});
    await waitFor(() => expect(off.result.current.stageOf('a1')).not.toBeNull());
    expect(off.result.current.stageOf('a1')?.prefix).toBeNull();

    serve({full_text_reviewer_count: 2}, ta);
    const on = renderHook(() => useArticleScreeningStages('p1'), {wrapper: createQueryWrapper().wrapper});
    await waitFor(() => expect(on.result.current.stageOf('a1')).not.toBeNull());
    expect(on.result.current.stageOf('a1')?.prefix).toBe('tabTitleAbstract');
  });

  it('does not call records while screening is unconfigured', async () => {
    const counts = serve({reviewer_count: null}, records([row('a1', 'included')]));
    const hook = renderHook(() => useArticleScreeningStages('p1'), {wrapper: createQueryWrapper().wrapper});
    await waitFor(() => expect(counts.config).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(counts.records).toBe(0);
    expect(hook.result.current.stageOf('a1')).toBeNull();
  });

  it('calls records without phase once configured', async () => {
    const counts = serve({}, records([row('a1', 'conflict')], ['dup-1']));
    const hook = renderHook(() => useArticleScreeningStages('p1'), {wrapper: createQueryWrapper().wrapper});
    await waitFor(() => expect(hook.result.current.stageOf('a1')).not.toBeNull());
    expect(new URL(counts.urls[0]).searchParams.has('phase')).toBe(false);
    expect(hook.result.current.stageOf('a1')).toMatchObject({label: 'statusConflict', prefix: 'tabTitleAbstract'});
    expect(hook.result.current.stageOf('dup-1')?.label).toBe('stageDuplicate');
    expect(hook.result.current.stageOf('unknown')).toBeNull();
  });

  it('fetches once for many chips', async () => {
    const counts = serve({}, records([row('a1', 'excluded')]));
    const {queryClient, wrapper} = createQueryWrapper();
    function Chip({id}: {id: string}) {
      const {stageOf} = useArticleScreeningStages('p1');
      return <span data-testid={`chip-${id}`}>{stageOf('a1')?.label ?? ''}</span>;
    }
    function Many({skip}: {skip: boolean}) {
      return (
        <>
          {Array.from({length: 50}, (_, i) => (i === 0 && skip ? null : <Chip key={i} id={String(i)} />))}
        </>
      );
    }
    const view = render(<Many skip={false} />, {wrapper});
    await waitFor(() => expect(view.getByTestId('chip-3').textContent).toBe('statusExcluded'));
    view.rerender(<Many skip />);
    view.rerender(<Many skip={false} />);
    await waitFor(() => expect(view.getByTestId('chip-0').textContent).toBe('statusExcluded'));
    expect(counts).toMatchObject({config: 1, records: 1});
    expect(queryClient.isFetching()).toBe(0);
  });

  it('returns null on a records error', async () => {
    const counts = serve({}, records([]), 500);
    const hook = renderHook(() => useArticleScreeningStages('p1'), {wrapper: createQueryWrapper().wrapper});
    await waitFor(() => expect(counts.records).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(hook.result.current.stageOf('a1')).toBeNull();
    expect(counts.records).toBe(1);
  });

  it('refetches after invalidateScreening', async () => {
    const counts = serve({}, records([row('a1', 'excluded')]));
    const {queryClient, wrapper} = createQueryWrapper();
    const hook = renderHook(() => useArticleScreeningStages('p1'), {wrapper});
    await waitFor(() => expect(hook.result.current.stageOf('a1')).not.toBeNull());
    await act(async () => {
      await invalidateScreening(queryClient, 'p1');
    });
    await waitFor(() => expect(counts.records).toBe(2));
  });
});
