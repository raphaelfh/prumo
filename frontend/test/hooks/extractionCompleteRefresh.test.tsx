/**
 * After an AI extraction job completes the page reloads suggestions at once;
 * the review table's proposal preview must never flash an empty suggestions
 * map while that reload is in flight.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
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

const KEY = 'inst-1_field-1';
const mapWith = (id: string) => ({
  suggestions: {
    [KEY]: { id, instanceId: 'inst-1', fieldId: 'field-1', value: id, confidence: 0.9, status: 'pending' },
  },
  count: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAISuggestions refresh after a completed job', () => {
  it('swaps the old proposal for the new one without an empty render in between', async () => {
    h.getArticleInstanceIds.mockResolvedValue(['inst-1']);
    h.loadSuggestions.mockResolvedValueOnce(mapWith('old'));

    const seen: Array<string | undefined> = [];
    const { result } = renderHook(() => {
      const hook = useAISuggestions({ articleId: 'a1', runId: 'run-1' });
      seen.push(hook.suggestions[KEY]?.id);
      return hook;
    });

    await waitFor(() => expect(result.current.suggestions[KEY]?.id).toBe('old'));
    const firstOld = seen.indexOf('old');

    let resolveNew!: (value: unknown) => void;
    h.loadSuggestions.mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));

    let done!: Promise<unknown>;
    act(() => {
      done = result.current.refresh();
    });

    // The reload is in flight: the previous proposal stays visible.
    await waitFor(() => expect(h.loadSuggestions).toHaveBeenCalledTimes(2));
    expect(result.current.suggestions[KEY]?.id).toBe('old');

    await act(async () => {
      resolveNew(mapWith('new'));
      await done;
    });

    expect(result.current.suggestions[KEY]?.id).toBe('new');
    // Once 'old' first rendered, every later render shows old or new — never empty.
    const afterFirstOld = seen.slice(firstOld);
    expect(afterFirstOld).not.toContain(undefined);
    expect(afterFirstOld.at(-1)).toBe('new');
  });
});
