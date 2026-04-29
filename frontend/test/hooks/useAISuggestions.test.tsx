/**
 * Tests for the ``useAISuggestions`` hook.
 *
 * Locks down the contract that:
 *  - The runId from props flows into ``AISuggestionService.acceptSuggestion``
 *    / ``rejectSuggestion`` (regression: the Data Extraction surface used to
 *    re-resolve the run via ``findActiveRun``, which silently posted decisions
 *    to a stale PENDING run when the article had multiple non-terminal runs).
 *  - The ``acceptStrategy='human-proposal'`` path used by Quality Assessment
 *    DOES NOT write a ReviewerDecision — it only bubbles via the
 *    ``onSuggestion*`` callbacks.
 *  - Accept / reject flip the local status of the affected suggestion so
 *    the UI can show ✓ / ✕ feedback without a refetch.
 *  - ``batchAccept`` only acts on suggestions above the threshold.
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
    acceptSuggestion: vi.fn(async () => undefined),
    rejectSuggestion: vi.fn(async () => undefined),
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
import { getSuggestionKey } from '@/types/ai-extraction';

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
      suggestions: { [getSuggestionKey('inst-A', 'f-1')]: makeSuggestion('inst-A', 'f-1') },
      count: 1,
    });

    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        projectId: 'proj-1',
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
        projectId: 'proj-1',
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
      useAISuggestions({ articleId: 'art-1', projectId: 'proj-1' }),
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
      useAISuggestions({ articleId: 'art-1', projectId: 'proj-1' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(AISuggestionService.loadSuggestions).not.toHaveBeenCalled();
    expect(result.current.suggestions).toEqual({});
  });

  it('honours enabled=false and never calls the service', async () => {
    renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        projectId: 'proj-1',
        enabled: false,
      }),
    );
    // give microtasks a chance
    await new Promise((r) => setTimeout(r, 0));
    expect(AISuggestionService.loadSuggestions).not.toHaveBeenCalled();
    expect(AISuggestionService.getArticleInstanceIds).not.toHaveBeenCalled();
  });
});

describe('useAISuggestions — reviewer-decision strategy (Data Extraction)', () => {
  beforeEach(() => {
    (AISuggestionService.loadSuggestions as any).mockResolvedValue({
      suggestions: {
        [getSuggestionKey('inst-1', 'f-1')]: makeSuggestion('inst-1', 'f-1', {
          confidence: 0.95,
        }),
        [getSuggestionKey('inst-1', 'f-2')]: makeSuggestion('inst-1', 'f-2', {
          confidence: 0.4,
        }),
      },
      count: 2,
    });
  });

  it('forwards the runId prop into AISuggestionService.acceptSuggestion', async () => {
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        projectId: 'proj-1',
        instanceIds: ['inst-1'],
        runId: 'run-active',
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(2),
    );

    await act(async () => {
      await result.current.acceptSuggestion('inst-1', 'f-1');
    });

    expect(AISuggestionService.acceptSuggestion).toHaveBeenCalledTimes(1);
    const call = (AISuggestionService.acceptSuggestion as any).mock.calls[0][0];
    expect(call.runId).toBe('run-active');
    expect(call.suggestionId).toBe('proposal-inst-1-f-1');
    expect(call.instanceId).toBe('inst-1');
    expect(call.fieldId).toBe('f-1');
  });

  it('forwards the runId prop into AISuggestionService.rejectSuggestion', async () => {
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        projectId: 'proj-1',
        instanceIds: ['inst-1'],
        runId: 'run-active',
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(2),
    );

    await act(async () => {
      await result.current.rejectSuggestion('inst-1', 'f-1');
    });

    expect(AISuggestionService.rejectSuggestion).toHaveBeenCalledTimes(1);
    const call = (AISuggestionService.rejectSuggestion as any).mock.calls[0][0];
    expect(call.runId).toBe('run-active');
    expect(call.instanceId).toBe('inst-1');
    expect(call.fieldId).toBe('f-1');
  });

  it('flips local status to "accepted" so the UI can render ✓', async () => {
    const onAccepted = vi.fn();
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        projectId: 'proj-1',
        instanceIds: ['inst-1'],
        runId: 'run-active',
        onSuggestionAccepted: onAccepted,
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(2),
    );

    await act(async () => {
      await result.current.acceptSuggestion('inst-1', 'f-1');
    });

    expect(
      result.current.suggestions[getSuggestionKey('inst-1', 'f-1')].status,
    ).toBe('accepted');
    // Callback fired with the suggestion's value
    await waitFor(() =>
      expect(onAccepted).toHaveBeenCalledWith('inst-1', 'f-1', 'Y'),
    );
  });

  it('flips local status to "rejected" and fires onSuggestionRejected', async () => {
    const onRejected = vi.fn();
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        projectId: 'proj-1',
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
      result.current.suggestions[getSuggestionKey('inst-1', 'f-1')].status,
    ).toBe('rejected');
    await waitFor(() =>
      expect(onRejected).toHaveBeenCalledWith('inst-1', 'f-1'),
    );
  });

  it('keeps existing status untouched when service throws', async () => {
    (AISuggestionService.acceptSuggestion as any).mockRejectedValueOnce(
      new Error('400 stage'),
    );
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        projectId: 'proj-1',
        instanceIds: ['inst-1'],
        runId: 'run-active',
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(2),
    );

    await act(async () => {
      await result.current.acceptSuggestion('inst-1', 'f-1');
    });

    expect(
      result.current.suggestions[getSuggestionKey('inst-1', 'f-1')].status,
    ).toBe('pending');
  });

  it('batchAccept honours the confidence threshold', async () => {
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        projectId: 'proj-1',
        instanceIds: ['inst-1'],
        runId: 'run-active',
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(2),
    );

    await act(async () => {
      await result.current.batchAccept(0.8);
    });

    // Only the 0.95-confidence suggestion is above 0.8.
    expect(AISuggestionService.acceptSuggestion).toHaveBeenCalledTimes(1);
    expect(
      (AISuggestionService.acceptSuggestion as any).mock.calls[0][0].fieldId,
    ).toBe('f-1');
  });
});

describe('useAISuggestions — human-proposal strategy (Quality Assessment)', () => {
  beforeEach(() => {
    (AISuggestionService.loadSuggestions as any).mockResolvedValue({
      suggestions: {
        [getSuggestionKey('inst-1', 'f-1')]: makeSuggestion('inst-1', 'f-1'),
      },
      count: 1,
    });
  });

  it('does NOT call AISuggestionService.acceptSuggestion (no ReviewerDecision write)', async () => {
    const onAccepted = vi.fn();
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        projectId: 'proj-1',
        instanceIds: ['inst-1'],
        runId: 'qa-run',
        acceptStrategy: 'human-proposal',
        onSuggestionAccepted: onAccepted,
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(1),
    );

    await act(async () => {
      await result.current.acceptSuggestion('inst-1', 'f-1');
    });

    expect(AISuggestionService.acceptSuggestion).not.toHaveBeenCalled();
    expect(
      result.current.suggestions[getSuggestionKey('inst-1', 'f-1')].status,
    ).toBe('accepted');
    await waitFor(() =>
      expect(onAccepted).toHaveBeenCalledWith('inst-1', 'f-1', 'Y'),
    );
  });

  it('does NOT call AISuggestionService.rejectSuggestion either', async () => {
    const onRejected = vi.fn();
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        projectId: 'proj-1',
        instanceIds: ['inst-1'],
        runId: 'qa-run',
        acceptStrategy: 'human-proposal',
        onSuggestionRejected: onRejected,
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(1),
    );

    await act(async () => {
      await result.current.rejectSuggestion('inst-1', 'f-1');
    });

    expect(AISuggestionService.rejectSuggestion).not.toHaveBeenCalled();
    expect(
      result.current.suggestions[getSuggestionKey('inst-1', 'f-1')].status,
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
        projectId: 'proj-1',
        instanceIds: ['inst-1'],
      }),
    );

    let history;
    await act(async () => {
      history = await result.current.getSuggestionsHistory('inst-1', 'f-1');
    });
    expect(AISuggestionService.getHistory).toHaveBeenCalledWith('inst-1', 'f-1', 10);
    expect(history).toHaveLength(1);
  });
});
