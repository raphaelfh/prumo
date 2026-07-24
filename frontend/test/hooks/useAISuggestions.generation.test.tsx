/**
 * Regression test for the stale-load overwrite in ``useAISuggestions`` (#406).
 *
 * The loader effect re-runs when ``articleId`` changes. Without a generation
 * guard, a load started for article A can resolve after article B's and write
 * A's suggestion map into state — the extraction form then shows another
 * article's AI suggestions.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getArticleInstanceIds: vi.fn(),
  loadSuggestions: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/aiSuggestionService', () => ({
  AISuggestionService: {
    getArticleInstanceIds: h.getArticleInstanceIds,
    loadSuggestions: h.loadSuggestions,
  },
}));

import { useAISuggestions } from '@/hooks/extraction/ai/useAISuggestions';

beforeEach(() => {
  vi.clearAllMocks();
});

const suggestionFor = (id: string) => ({
  suggestions: {
    [`inst-1|field-1`]: { id, instanceId: 'inst-1', fieldId: 'field-1', confidence: 0.9 },
  },
  count: 1,
});

describe('useAISuggestions — a superseded load must not write (#406)', () => {
  it('keeps the newer article suggestions when the older load resolves last', async () => {
    h.getArticleInstanceIds.mockResolvedValue(['inst-1']);

    const deferred: Array<(v: unknown) => void> = [];
    h.loadSuggestions.mockImplementation(
      () => new Promise((resolve) => deferred.push(resolve)),
    );

    const { rerender, result } = renderHook(
      ({ articleId }) => useAISuggestions({ articleId, instanceIds: ['inst-1'] }),
      { initialProps: { articleId: 'article-A' } },
    );

    await waitFor(() => {
      expect(h.loadSuggestions).toHaveBeenCalledWith('article-A', ['inst-1'], undefined);
    });

    rerender({ articleId: 'article-B' });
    await waitFor(() => {
      expect(h.loadSuggestions).toHaveBeenCalledWith('article-B', ['inst-1'], undefined);
    });
    expect(deferred).toHaveLength(2);

    // Newer load lands first...
    deferred[1](suggestionFor('from-B'));
    await waitFor(() => {
      expect(result.current.suggestions['inst-1|field-1']).toMatchObject({ id: 'from-B' });
    });

    // ...then the stale one for article-A resolves.
    deferred[0](suggestionFor('from-A'));
    await waitFor(() => {
      expect(h.loadSuggestions).toHaveBeenCalledTimes(2);
    });

    expect(result.current.suggestions['inst-1|field-1']).toMatchObject({ id: 'from-B' });
  });

  it('still writes the result of a load that is not superseded', async () => {
    h.getArticleInstanceIds.mockResolvedValue(['inst-1']);
    h.loadSuggestions.mockResolvedValue(suggestionFor('only-load'));

    const { result } = renderHook(() =>
      useAISuggestions({ articleId: 'article-A', instanceIds: ['inst-1'] }),
    );

    await waitFor(() => {
      expect(result.current.suggestions['inst-1|field-1']).toMatchObject({ id: 'only-load' });
    });
    expect(result.current.suggestionsReady).toBe(true);
  });
});
