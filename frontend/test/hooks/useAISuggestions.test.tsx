/**
 * Tests for the ``useAISuggestions`` hook.
 *
 * Locks down the contract that:
 *  - Accept / select / reject NEVER write to the backend from the hook —
 *    they only bubble via the ``onSuggestion*`` callbacks (the screens'
 *    autosave persists the value; the old ``acceptStrategy`` service
 *    chain was removed in the 2026-07-05 verify-then-prune).
 *  - Accept / reject flip the local status of the affected suggestion so
 *    the UI can show ✓ / ✕ feedback without a refetch.
 *  - ``batchAccept`` only acts on suggestions above the threshold.
 *  - ``sessionAdoption`` records only real session events (D0) and is
 *    never seeded from server-rehydrated status.
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

import { toast } from 'sonner';

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

describe('useAISuggestions — accept/reject (bubble-only)', () => {
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

  it('flips local status to "accepted" so the UI can render ✓', async () => {
    const onAccepted = vi.fn();
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
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

  it('batchAccept honours the confidence threshold', async () => {
    const onAccepted = vi.fn();
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
        runId: 'run-active',
        onSuggestionAccepted: onAccepted,
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(2),
    );

    await act(async () => {
      await result.current.batchAccept(0.8);
    });

    // Only the 0.95-confidence suggestion is above 0.8.
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(onAccepted).toHaveBeenCalledWith('inst-1', 'f-1', 'Y');
  });

  it('batchAccept never accepts an abstention, even above the confidence threshold', async () => {
    // ADR-0016 decision #3: an AI abstention ("no information") must not be
    // silently swept into a bulk accept-all — a reviewer accepts it deliberately.
    // Even with an (artificially) high confidence, the marker is excluded from the
    // batch; only the real proposal is accepted. On the pre-fix code BOTH would be.
    (AISuggestionService.loadSuggestions as any).mockResolvedValueOnce({
      suggestions: {
        [getSuggestionKey('inst-1', 'f-real')]: makeSuggestion('inst-1', 'f-real', {
          confidence: 0.95,
          value: 'Y',
        }),
        [getSuggestionKey('inst-1', 'f-abstain')]: makeSuggestion('inst-1', 'f-abstain', {
          confidence: 0.95,
          value: { value: null, absent_reason: 'no_information' },
        }),
      },
      count: 2,
    });
    const onAccepted = vi.fn();
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
        runId: 'run-active',
        onSuggestionAccepted: onAccepted,
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(2),
    );

    await act(async () => {
      await result.current.batchAccept(0.8);
    });

    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(onAccepted).toHaveBeenCalledWith('inst-1', 'f-real', 'Y');
  });

  it('batchAccept fires ONE success toast, not one per item (#160)', async () => {
    (AISuggestionService.loadSuggestions as any).mockResolvedValue({
      suggestions: {
        [getSuggestionKey('inst-1', 'f-1')]: makeSuggestion('inst-1', 'f-1', { confidence: 0.95 }),
        [getSuggestionKey('inst-1', 'f-2')]: makeSuggestion('inst-1', 'f-2', { confidence: 0.92 }),
        [getSuggestionKey('inst-1', 'f-3')]: makeSuggestion('inst-1', 'f-3', { confidence: 0.9 }),
      },
      count: 3,
    });
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
        runId: 'run-active',
      }),
    );
    await waitFor(() => expect(Object.keys(result.current.suggestions)).toHaveLength(3));

    await act(async () => {
      await result.current.batchAccept(0.8);
    });

    // The per-item accepts run silently; only the batch summary toasts.
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});

describe('useAISuggestions — selectSuggestion (accept-by-proposal-id)', () => {
  beforeEach(() => {
    (AISuggestionService.loadSuggestions as any).mockResolvedValue({
      suggestions: {
        [getSuggestionKey('inst-1', 'f-1')]: makeSuggestion('inst-1', 'f-1', {
          confidence: 0.5,
        }),
      },
      count: 1,
    });
  });

  it('pins the CHOSEN version locally and bubbles its value', async () => {
    const onAccepted = vi.fn();
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
        runId: 'run-active',
        onSuggestionAccepted: onAccepted,
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(1),
    );

    await act(async () => {
      await result.current.selectSuggestion('inst-1', 'f-1', 'p-older', 5, 0.7);
    });

    await waitFor(() =>
      expect(onAccepted).toHaveBeenCalledWith('inst-1', 'f-1', 5),
    );
    const updated = result.current.suggestions[getSuggestionKey('inst-1', 'f-1')];
    expect(updated.status).toBe('accepted');
    // The coord's entry now reflects the CHOSEN version (id + value + its own
    // confidence), so the review popover highlights the right version across
    // close+reopen — not the newest one. (Was 'proposal-inst-1-f-1' / 'Y' / 0.5.)
    expect(updated.id).toBe('p-older');
    expect(updated.value).toBe(5);
    expect(updated.confidence).toBe(0.7);
  });

  it('bubbles a (possibly null) "no information" selection', async () => {
    const onAccepted = vi.fn();
    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
        runId: 'qa-run',
        onSuggestionAccepted: onAccepted,
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(1),
    );

    await act(async () => {
      // Selecting a "no information" version → null value, no confidence.
      await result.current.selectSuggestion('inst-1', 'f-1', 'p-noinfo', null, 0);
    });

    await waitFor(() =>
      expect(onAccepted).toHaveBeenCalledWith('inst-1', 'f-1', null),
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

describe('useAISuggestions — session adoption + readiness (D0)', () => {
  it('fabrication regression: a server-rehydrated "accepted" status produces NO adoption entry', async () => {
    // The backend marks any non-reject caller decision 'accepted' (including
    // plain manual edits), so hydrated status must never seed the link map.
    (AISuggestionService.loadSuggestions as any).mockResolvedValueOnce({
      suggestions: {
        [getSuggestionKey('inst-1', 'f-1')]: makeSuggestion('inst-1', 'f-1', {
          status: 'accepted',
        }),
      },
      count: 1,
    });

    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
      }),
    );

    await waitFor(() => expect(result.current.suggestionsReady).toBe(true));
    expect(result.current.sessionAdoption).toEqual({});
  });

  it('accept and select set the coord entry to the chosen proposal id', async () => {
    (AISuggestionService.loadSuggestions as any).mockResolvedValueOnce({
      suggestions: { [getSuggestionKey('inst-1', 'f-1')]: makeSuggestion('inst-1', 'f-1') },
      count: 1,
    });

    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(1),
    );

    await act(async () => {
      await result.current.acceptSuggestion('inst-1', 'f-1');
    });
    expect(result.current.sessionAdoption).toEqual({
      [getSuggestionKey('inst-1', 'f-1')]: 'proposal-inst-1-f-1',
    });

    await act(async () => {
      await result.current.selectSuggestion('inst-1', 'f-1', 'proposal-older', 'Z', 0.7);
    });
    expect(result.current.sessionAdoption).toEqual({
      [getSuggestionKey('inst-1', 'f-1')]: 'proposal-older',
    });
  });

  it('reject tombstones the coord entry with null', async () => {
    (AISuggestionService.loadSuggestions as any).mockResolvedValueOnce({
      suggestions: { [getSuggestionKey('inst-1', 'f-1')]: makeSuggestion('inst-1', 'f-1') },
      count: 1,
    });

    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
      }),
    );
    await waitFor(() =>
      expect(Object.keys(result.current.suggestions)).toHaveLength(1),
    );

    await act(async () => {
      await result.current.rejectSuggestion('inst-1', 'f-1');
    });
    expect(result.current.sessionAdoption).toEqual({
      [getSuggestionKey('inst-1', 'f-1')]: null,
    });
  });

  it('suggestionsReady is false after a failed load', async () => {
    (AISuggestionService.loadSuggestions as any).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() =>
      useAISuggestions({
        articleId: 'art-1',
        instanceIds: ['inst-1'],
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.suggestionsReady).toBe(false);
  });
});
