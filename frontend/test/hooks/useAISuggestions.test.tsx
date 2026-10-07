/**
 * Tests for the ``useAISuggestions`` hook.
 *
 * Locks down the contract that:
 *  - Loading is scoped to the run and the caller's instances.
 *  - Reject NEVER writes to the backend from the hook — it flips the local
 *    status (✕ feedback without a refetch) and bubbles via
 *    ``onSuggestionRejected``; accepting is ``useRunValues``' decision.
 *  - ``suggestionsReady`` reports only a successful load.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })),
    },
  },
}));

vi.mock('@/services/aiSuggestionService', () => ({
  AISuggestionService: {
    getArticleInstanceIds: vi.fn(async () => ['inst-1']),
    loadSuggestions: vi.fn(async () => ({ suggestions: {}, count: 0 })),
    getHistory: vi.fn(async () => []),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { AISuggestionService } from '@/services/aiSuggestionService';
import { useAISuggestions } from '@/hooks/extraction/ai/useAISuggestions';
import type { AISuggestion } from '@/types/ai-extraction';
import { coordKey } from '@/lib/runs/coord';

function makeSuggestion(
  instanceId: string,
  fieldId: string,
  overrides: Partial<AISuggestion> = {},
): AISuggestion {
  return {
    id: `proposal-${instanceId}-${fieldId}`,
    runId: 'run-original',
    value: 'Y',
    confidence: 0.9,
    reasoning: 'because',
    status: 'pending',
    timestamp: new Date('2026-04-28T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAISuggestions — load', () => {
  it('uses provided instanceIds when available (skips article-wide lookup)', async () => {
    (AISuggestionService.loadSuggestions as any).mockResolvedValueOnce({
      suggestions: { [coordKey('inst-A', 'f-1')]: makeSuggestion('inst-A', 'f-1') },
      count: 1,
    });

    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-A', 'inst-B'],
      }),
    );

    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(1),
    );
    expect(AISuggestionService.getArticleInstanceIds).not.toHaveBeenCalled();
    expect(AISuggestionService.loadSuggestions).toHaveBeenCalledWith(
      'art-1',
      ['inst-A', 'inst-B'],
      undefined,
    );
  });

  it('forwards runId to loadSuggestions so QA proposals do not bleed in', async () => {
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        runId: 'run-explicit',
        instanceIds: ['inst-1'],
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(AISuggestionService.loadSuggestions).toHaveBeenCalledWith(
      'art-1',
      ['inst-1'],
      'run-explicit',
    );
  });

  it('falls back to article-wide instance lookup when no instanceIds prop is set', async () => {
    (AISuggestionService.getArticleInstanceIds as any).mockResolvedValueOnce([
      'inst-X',
      'inst-Y',
    ]);
    const { result } = renderHook(() =>
      useAISuggestions({ articleId: 'art-1' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(AISuggestionService.getArticleInstanceIds).toHaveBeenCalledWith('art-1');
    expect(AISuggestionService.loadSuggestions).toHaveBeenCalledWith(
      'art-1',
      ['inst-X', 'inst-Y'],
      undefined,
    );
  });

  it('returns empty when there are no instances', async () => {
    (AISuggestionService.getArticleInstanceIds as any).mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useAISuggestions({ articleId: 'art-1' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(AISuggestionService.loadSuggestions).not.toHaveBeenCalled();
    expect(result.current.suggestions).toEqual({});
  });

  it('honours enabled=false and never calls the service', async () => {
    renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        enabled: false,
      }),
    );
    // give microtasks a chance
    await new Promise((r) => setTimeout(r, 0));
    expect(AISuggestionService.loadSuggestions).not.toHaveBeenCalled();
    expect(AISuggestionService.getArticleInstanceIds).not.toHaveBeenCalled();
  });
});

describe('useAISuggestions — reject (bubble-only)', () => {
  beforeEach(() => {
    (AISuggestionService.loadSuggestions as any).mockResolvedValue({
      suggestions: {
        [coordKey('inst-1', 'f-1')]: makeSuggestion('inst-1', 'f-1', {
          confidence: 0.95,
        }),
        [coordKey('inst-1', 'f-2')]: makeSuggestion('inst-1', 'f-2', {
          confidence: 0.4,
        }),
      },
      count: 2,
    });
  });

  it('flips local status to "rejected" and fires onSuggestionRejected', async () => {
    const onRejected = vi.fn();
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
        runId: 'run-active',
        onSuggestionRejected: onRejected,
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(2),
    );

    await act(async () => {
      await result.current.rejectSuggestion('inst-1', 'f-1');
    });

    expect(
      result.current.suggestions[coordKey('inst-1', 'f-1')].status,
    ).toBe('rejected');
    await waitFor(() =>
      expect(onRejected).toHaveBeenCalledWith('inst-1', 'f-1'),
    );
  });

});

describe('useAISuggestions — getSuggestionsHistory', () => {
  it('delegates to AISuggestionService.getHistory with a sensible default limit', async () => {
    (AISuggestionService.getHistory as any).mockResolvedValueOnce([
      makeSuggestion('inst-1', 'f-1'),
    ]);
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
      }),
    );

    let history;
    await act(async () => {
      history = await result.current.getSuggestionsHistory('inst-1', 'f-1');
    });
    expect(AISuggestionService.getHistory).toHaveBeenCalledWith('art-1', 'inst-1', 'f-1', 10);
    expect(history).toHaveLength(1);
  });

  it('forwards an explicit limit (consensus trace passes 50)', async () => {
    (AISuggestionService.getHistory as any).mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
      }),
    );

    await act(async () => {
      await result.current.getSuggestionsHistory('inst-1', 'f-1', 50);
    });
    expect(AISuggestionService.getHistory).toHaveBeenCalledWith('art-1', 'inst-1', 'f-1', 50);
  });
});

describe('useAISuggestions — readiness', () => {
  it('suggestionsReady flips true→false when a refresh fails (red-green: kills the always-false mutant)', async () => {
    (AISuggestionService.loadSuggestions as any).mockResolvedValueOnce({
      suggestions: { [coordKey('inst-1', 'f-1')]: makeSuggestion('inst-1', 'f-1') },
      count: 1,
    });

    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
      }),
    );

    // Positive control: a successful load reports ready.
    await waitFor(() => expect(result.current.suggestionsReady).toBe(true));

    // The next load fails → the signal must drop back to unavailable so the
    // consensus Manual chip suppresses instead of trusting a stale map.
    (AISuggestionService.loadSuggestions as any).mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.suggestionsReady).toBe(false);
    expect(result.current.suggestions).toEqual({});
  });
});
