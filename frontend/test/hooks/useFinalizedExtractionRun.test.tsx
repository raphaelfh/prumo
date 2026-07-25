/**
 * Regression test for the stale-response overwrite in
 * ``useFinalizedExtractionRun`` (#285).
 *
 * The hook looks up the latest finalized run for an (article × template) pair.
 * Without a generation guard, switching articles while a lookup is in flight
 * lets the slower, older response land last and overwrite the newer article's
 * result — the user sees another article's run behind the "Reopen for
 * revision" affordance.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  findLatestFinalizedRun: vi.fn(),
}));

vi.mock('@/services/extractionValueService', () => ({
  ExtractionValueService: { findLatestFinalizedRun: h.findLatestFinalizedRun },
}));

import { useFinalizedExtractionRun } from '@/hooks/extraction/useFinalizedExtractionRun';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useFinalizedExtractionRun — stale response must not win (#285)', () => {
  it('keeps the newer article result when the older lookup resolves last', async () => {
    const deferred: Array<(value: { id: string }) => void> = [];
    h.findLatestFinalizedRun.mockImplementation(
      () => new Promise<{ id: string }>((resolve) => deferred.push(resolve)),
    );

    const { rerender, result } = renderHook(
      ({ articleId }) => useFinalizedExtractionRun({ articleId, projectTemplateId: 't1' }),
      { initialProps: { articleId: 'article-A' } },
    );

    await waitFor(() => {
      expect(h.findLatestFinalizedRun).toHaveBeenCalledWith('article-A', 't1');
    });

    // Switch to a second article while the first lookup is still in flight.
    rerender({ articleId: 'article-B' });
    await waitFor(() => {
      expect(h.findLatestFinalizedRun).toHaveBeenCalledWith('article-B', 't1');
    });
    expect(deferred).toHaveLength(2);

    // Resolve the NEWER lookup first, then let the stale one land afterwards.
    deferred[1]({ id: 'run-for-B' });
    await waitFor(() => {
      expect(result.current.finalizedRun).toEqual({ id: 'run-for-B' });
    });

    deferred[0]({ id: 'run-for-A' });
    await waitFor(() => {
      expect(h.findLatestFinalizedRun).toHaveBeenCalledTimes(2);
    });

    // The stale article-A response must be discarded.
    expect(result.current.finalizedRun).toEqual({ id: 'run-for-B' });
  });

  it('still stores the result of a lookup that is not superseded', async () => {
    h.findLatestFinalizedRun.mockResolvedValue({ id: 'run-1' });

    const { result } = renderHook(() =>
      useFinalizedExtractionRun({ articleId: 'article-A', projectTemplateId: 't1' }),
    );

    await waitFor(() => {
      expect(result.current.finalizedRun).toEqual({ id: 'run-1' });
    });
    expect(result.current.loading).toBe(false);
  });
});
