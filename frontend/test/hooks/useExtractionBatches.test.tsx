import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ReactNode} from 'react';

vi.mock('@/services/extractionBatchService', () => ({
  listExtractionBatches: vi.fn(),
  getExtractionBatch: vi.fn(),
  startExtractionBatch: vi.fn(),
  cancelExtractionBatch: vi.fn(),
  resumeExtractionBatch: vi.fn(),
}));

import {getExtractionBatch, listExtractionBatches} from '@/services/extractionBatchService';
import {articleExtractionValuesKeys} from '@/lib/query-keys/extraction';
import {useActiveBatches, useBatchDetail} from '@/hooks/extraction/useExtractionBatches';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {client, wrapper};
}

const counts = {
  total: 2,
  queued: 1,
  running: 1,
  done: 0,
  done_with_issues: 0,
  needs_attention: 0,
  skipped: 0,
  not_run: 0,
};

beforeEach(() => {
  vi.mocked(listExtractionBatches).mockReset();
  vi.mocked(getExtractionBatch).mockReset();
});

describe('useActiveBatches', () => {
  it('does not fetch without a project', async () => {
    const {wrapper} = makeWrapper();
    renderHook(() => useActiveBatches(null), {wrapper});
    expect(listExtractionBatches).not.toHaveBeenCalled();
  });

  it('asks only for active batches of the project', async () => {
    vi.mocked(listExtractionBatches).mockResolvedValue([]);
    const {wrapper} = makeWrapper();
    renderHook(() => useActiveBatches('p1'), {wrapper});
    await waitFor(() =>
      expect(listExtractionBatches).toHaveBeenCalledWith({projectId: 'p1', active: true}),
    );
  });
});

describe('useBatchDetail', () => {
  it('invalidates the article values when the done count grows', async () => {
    const detail = {
      id: 'b1',
      project_id: 'p1',
      project_name: 'P',
      template_id: 't1',
      template_name: 'T',
      kind: 'extraction',
      state: 'active' as const,
      stalled: false,
      stop_code: null,
      stop_message: null,
      created_at: '2026-09-15T00:00:00Z',
      finished_at: null,
      counts,
      items: [],
    };
    vi.mocked(getExtractionBatch).mockResolvedValueOnce(detail);
    const {client, wrapper} = makeWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const {rerender} = renderHook(() => useBatchDetail('b1'), {wrapper});
    await waitFor(() => expect(getExtractionBatch).toHaveBeenCalled());

    invalidate.mockClear();
    vi.mocked(getExtractionBatch).mockResolvedValue({
      ...detail,
      counts: {...counts, queued: 0, running: 1, done: 1},
    });
    await client.invalidateQueries();
    rerender();

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: articleExtractionValuesKeys.all,
      }),
    );
  });

  it('does not carry the done count across a batch switch', async () => {
    const baseDetail = {
      id: 'b1',
      project_id: 'p1',
      project_name: 'P',
      template_id: 't1',
      template_name: 'T',
      kind: 'extraction',
      state: 'active' as const,
      stalled: false,
      stop_code: null,
      stop_message: null,
      created_at: '2026-09-15T00:00:00Z',
      finished_at: null,
      counts: {...counts, queued: 0, running: 0, done: 3},
      items: [],
    };
    vi.mocked(getExtractionBatch).mockResolvedValueOnce(baseDetail);
    const {client, wrapper} = makeWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const {rerender} = renderHook(({id}: {id: string}) => useBatchDetail(id), {
      wrapper,
      initialProps: {id: 'b1'},
    });
    await waitFor(() => expect(getExtractionBatch).toHaveBeenCalledWith('b1'));

    invalidate.mockClear();
    vi.mocked(getExtractionBatch).mockResolvedValueOnce({
      ...baseDetail,
      id: 'b2',
      counts: {...counts, queued: 1, running: 0, done: 0},
    });
    rerender({id: 'b2'});
    await waitFor(() => expect(getExtractionBatch).toHaveBeenCalledWith('b2'));

    invalidate.mockClear();
    vi.mocked(getExtractionBatch).mockResolvedValue({
      ...baseDetail,
      id: 'b2',
      counts: {...counts, queued: 0, running: 1, done: 1},
    });
    await client.invalidateQueries();
    rerender({id: 'b2'});

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: articleExtractionValuesKeys.all,
      }),
    );
  });
});
