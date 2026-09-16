/**
 * useAiBatchJobSync (spec 2026-09-15 §11.5): mirrors the caller's recent
 * batches (active AND terminal, from `useRecentBatches`) into the
 * background-jobs store, one job per batch, `completedAt` stamped once.
 *
 * These tests exercise the REAL `useRecentBatches`/`useActiveBatches` query
 * hooks (only the service is mocked) so they can prove the query the sync
 * hook drives is one the server can actually answer — a batch that finished
 * is terminal and would be silently dropped by `useActiveBatches`.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ReactNode} from 'react';

vi.mock('@/services/extractionBatchService', () => ({
  listExtractionBatches: vi.fn(),
  getExtractionBatch: vi.fn(),
  startExtractionBatch: vi.fn(),
  cancelExtractionBatch: vi.fn(),
  resumeExtractionBatch: vi.fn(),
}));

import {listExtractionBatches} from '@/services/extractionBatchService';
import {useAiBatchJobSync} from '@/hooks/useAiBatchJobSync';
import {useBackgroundJobs} from '@/stores/useBackgroundJobs';

function summary(state: 'active' | 'finished') {
  return {
    id: 'b1',
    kind: 'extraction',
    project_id: 'p1',
    project_name: 'Project 1',
    template_id: 't1',
    template_name: 'Template 1',
    state,
    stalled: false,
    stop_code: null,
    stop_message: null,
    created_at: '2026-09-15T00:00:00Z',
    finished_at: null,
    counts: {
      done: 1,
      done_with_issues: 0,
      needs_attention: 0,
      not_run: 0,
      queued: 0,
      running: 1,
      skipped: 0,
      total: 2,
    },
  };
}

function Harness() {
  useAiBatchJobSync();
  return null;
}

function renderWithClient() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const Wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Harness />, {wrapper: Wrapper});
}

describe('useAiBatchJobSync', () => {
  beforeEach(() => {
    useBackgroundJobs.setState({jobs: [], lastReadAt: Date.now(), ownerId: null});
    vi.mocked(listExtractionBatches).mockReset();
  });

  it('fetches the caller\'s recent batches with no project filter', async () => {
    vi.mocked(listExtractionBatches).mockResolvedValue([summary('active')]);
    renderWithClient();

    await waitFor(() => expect(listExtractionBatches).toHaveBeenCalled());
    expect(listExtractionBatches).toHaveBeenCalledWith({});
  });

  it('adds a running job for an active batch', async () => {
    vi.mocked(listExtractionBatches).mockResolvedValue([summary('active')]);
    renderWithClient();

    await waitFor(() => expect(useBackgroundJobs.getState().getJob('ai-batch-b1')).toBeDefined());
    const job = useBackgroundJobs.getState().getJob('ai-batch-b1');
    expect(job?.type).toBe('ai-batch');
    expect(job?.status).toBe('running');
    expect(job?.completedAt).toBeUndefined();
  });

  it('observes a batch that finished — through the real list response, not a hand-fed summary', async () => {
    vi.mocked(listExtractionBatches).mockResolvedValueOnce([summary('active')]);
    renderWithClient();

    await waitFor(() =>
      expect(useBackgroundJobs.getState().getJob('ai-batch-b1')?.status).toBe('running'),
    );

    vi.mocked(listExtractionBatches).mockResolvedValue([summary('finished')]);
    // Force the poll: refetchInterval only fires while a batch is active,
    // which is true right now, so advancing past ACTIVE_BATCH_POLL_MS
    // triggers the next fetch of the real query.
    await waitFor(
      () => expect(useBackgroundJobs.getState().getJob('ai-batch-b1')?.status).toBe('completed'),
      {timeout: 8000, interval: 100},
    );

    const job = useBackgroundJobs.getState().getJob('ai-batch-b1');
    expect(job?.completedAt).toBeTypeOf('number');
  }, 10000);
});
