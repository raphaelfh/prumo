/**
 * Regression tests for issue #161 — stale-data overwrite in collaboration hooks.
 *
 * Both `useOtherExtractions` and `useAllUserInstances` must discard responses
 * that arrive after `articleId` has changed (generation-counter guard).
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

// ── useOtherExtractions ────────────────────────────────────────────────────

vi.mock('@/services/extractionValueService', () => ({
  ExtractionValueService: {
    findActiveRun: vi.fn(),
    loadValuesForOthers: vi.fn(),
  },
}));

import { ExtractionValueService } from '@/services/extractionValueService';
import { useOtherExtractions } from '@/hooks/extraction/collaboration/useOtherExtractions';

const findActiveRunMock = ExtractionValueService.findActiveRun as ReturnType<typeof vi.fn>;
const loadValuesForOthersMock = ExtractionValueService.loadValuesForOthers as ReturnType<typeof vi.fn>;

// ── useAllUserInstances ────────────────────────────────────────────────────

vi.mock('@/integrations/supabase/client', () => {
  const orderMock = vi.fn();
  const eqMock = vi.fn(() => ({ order: orderMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  return { supabase: { from: fromMock, __orderMock: orderMock } };
});

import { supabase } from '@/integrations/supabase/client';
import { useAllUserInstances } from '@/hooks/extraction/collaboration/useAllUserInstances';

const supabaseOrderMock = (supabase as any).__orderMock as ReturnType<typeof vi.fn>;

// ──────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useOtherExtractions — stale-data guard', () => {
  it('discards a response that arrives after articleId has changed', async () => {
    // Deferred promise simulates a slow first fetch.
    let resolveFirst!: (v: unknown) => void;
    const firstFetch = new Promise((res) => { resolveFirst = res; });

    findActiveRunMock
      .mockReturnValueOnce(firstFetch)          // art-1: slow
      .mockResolvedValue(null);                 // art-2: fast, no run

    const { result, rerender } = renderHook(
      ({ articleId }) =>
        useOtherExtractions({
          articleId,
          projectId: 'proj-1',
          templateId: 'tpl-1',
          currentUserId: 'user-1',
        }),
      { initialProps: { articleId: 'art-1' } },
    );

    // Switch article while art-1 fetch is still in flight.
    rerender({ articleId: 'art-2' });

    // Now let the stale art-1 response arrive.
    resolveFirst({ id: 'run-stale' });
    loadValuesForOthersMock.mockResolvedValue([
      {
        reviewerId: 'r-1',
        reviewerName: 'Alice',
        reviewerAvatar: null,
        values: { field1: 'STALE' },
        latestDecidedAt: null,
      },
    ]);

    // art-2 has no run → resolves to empty immediately.
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Stale data from art-1 must NOT appear.
    expect(result.current.otherExtractions).toHaveLength(0);
  });
});

describe('useAllUserInstances — stale-data guard', () => {
  it('discards a response that arrives after articleId has changed', async () => {
    let resolveFirst!: (v: unknown) => void;
    const firstFetch = new Promise((res) => { resolveFirst = res; });

    supabaseOrderMock
      .mockReturnValueOnce(firstFetch)          // art-1: slow
      .mockResolvedValue({ data: [], error: null }); // art-2: fast, empty

    const staleInstances = [
      { id: 'inst-stale', article_id: 'art-1', created_by: 'user-1' },
    ];

    const { result, rerender } = renderHook(
      ({ articleId }) => useAllUserInstances({ articleId }),
      { initialProps: { articleId: 'art-1' } },
    );

    // Switch article before art-1 resolves.
    rerender({ articleId: 'art-2' });

    // Let the stale art-1 response arrive.
    resolveFirst({ data: staleInstances, error: null });

    // art-2 resolves to empty immediately.
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Stale data from art-1 must NOT appear.
    expect(result.current.instances).toHaveLength(0);
  });
});
