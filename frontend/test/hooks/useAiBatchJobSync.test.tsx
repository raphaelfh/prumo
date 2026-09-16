/**
 * useAiBatchJobSync (spec 2026-09-15 §11.5): mirrors active batches into the
 * background-jobs store, one job per batch, `completedAt` stamped once.
 */
import {renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const useActiveBatchesMock = vi.fn();
vi.mock('@/hooks/extraction/useExtractionBatches', () => ({
  useActiveBatches: (...args: unknown[]) => useActiveBatchesMock(...args),
}));

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

describe('useAiBatchJobSync', () => {
  beforeEach(() => {
    useBackgroundJobs.setState({jobs: [], lastReadAt: Date.now(), ownerId: null});
    useActiveBatchesMock.mockReset();
  });

  it('adds a running job for an active batch', () => {
    useActiveBatchesMock.mockReturnValue({data: [summary('active')]});
    renderHook(() => useAiBatchJobSync());

    const job = useBackgroundJobs.getState().getJob('ai-batch-b1');
    expect(job?.type).toBe('ai-batch');
    expect(job?.status).toBe('running');
    expect(job?.completedAt).toBeUndefined();
  });

  it('marks the job completed with a completedAt on the terminal transition', () => {
    useActiveBatchesMock.mockReturnValue({data: [summary('active')]});
    const {rerender} = renderHook(() => useAiBatchJobSync());

    useActiveBatchesMock.mockReturnValue({data: [summary('finished')]});
    rerender();

    const job = useBackgroundJobs.getState().getJob('ai-batch-b1');
    expect(job?.status).toBe('completed');
    expect(job?.completedAt).toBeTypeOf('number');
  });

  it('does not restamp completedAt on a further re-render of a finished batch', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    useActiveBatchesMock.mockReturnValue({data: [summary('active')]});
    const {rerender} = renderHook(() => useAiBatchJobSync());

    nowSpy.mockReturnValueOnce(2000);
    useActiveBatchesMock.mockReturnValue({data: [summary('finished')]});
    rerender();
    const firstCompletedAt = useBackgroundJobs.getState().getJob('ai-batch-b1')?.completedAt;
    expect(firstCompletedAt).toBe(2000);

    nowSpy.mockReturnValueOnce(3000);
    useActiveBatchesMock.mockReturnValue({data: [{...summary('finished'), counts: {...summary('finished').counts, done: 2}}]});
    rerender();
    const secondCompletedAt = useBackgroundJobs.getState().getJob('ai-batch-b1')?.completedAt;

    expect(secondCompletedAt).toBe(firstCompletedAt);
    nowSpy.mockRestore();
  });
});
