/**
 * Tests for the unified ``useAutoSaveProposals`` hook.
 *
 * Coverage:
 *   - Diff-aware POSTs (only changed coords)
 *   - State machine transitions (idle → dirty → saving → saved | error)
 *   - Survivability: flush on unmount, ``pagehide`` triggers save, all
 *     POSTs carry ``keepalive: true``
 *   - Mutex on concurrent ``saveNow``
 *   - ``saveNow`` cancels the debounce timer
 *   - ``hasUnsavedChanges`` reflects the diff against last-saved
 *   - One shared write path (D8): every write is an ``edit`` decision on
 *     ``/runs/{id}/decisions`` for BOTH run kinds; autosave only writes in
 *     the ``extract`` stage
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/api', () => ({
  apiClient: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { apiClient } from '@/integrations/api';
import { useAutoSaveProposals } from '@/hooks/runs/useAutoSaveProposals';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

const DECISION_RESPONSE = {
  id: 'd-1',
  run_id: 'run-1',
  instance_id: 'inst-1',
  field_id: 'field-1',
  decision: 'edit',
  proposal_record_id: null,
  value: { value: 'hello' },
  rationale: null,
  created_at: '2026-04-28T00:00:00Z',
};

beforeEach(() => {
  apiClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAutoSaveProposals — basic write semantics', () => {
  it("writes an 'edit' decision per changed coord on saveNow()", async () => {
    apiClientMock.mockResolvedValue(DECISION_RESPONSE);

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'hello' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/decisions',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: {
          instance_id: 'inst-1',
          field_id: 'field-1',
          decision: 'edit',
          value: { value: 'hello' },
        },
      }),
    );
    expect(result.current.lastSavedAt).not.toBeNull();
    expect(result.current.saveState).toBe('saved');
  });

  it('skips coords whose value did not change since the last save', async () => {
    apiClientMock.mockResolvedValue(DECISION_RESPONSE);

    const { result, rerender } = renderHook(
      ({ values }) =>
        useAutoSaveProposals({
          runId: 'run-1',
          stage: 'extract',
          values,
        }),
      {
        initialProps: {
          values: { 'inst-1_field-1': 'a' } as Record<string, unknown>,
        },
      },
    );

    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(1);

    rerender({ values: { 'inst-1_field-1': 'a' } });
    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(1);

    rerender({ values: { 'inst-1_field-1': 'b' } });
    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when runId is missing', async () => {
    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: null,
        stage: 'extract',
        values: { 'inst-1_field-1': 'hello' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).not.toHaveBeenCalled();
    expect(result.current.saveState).toBe('idle');
  });

  it('skips only undefined; null and empty-string are persisted as clears (#25)', async () => {
    apiClientMock.mockResolvedValue(DECISION_RESPONSE);

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: {
          'inst-1_field-empty': '',
          'inst-1_field-null': null,
          'inst-1_field-undef': undefined,
          'inst-1_field-real': 'hello',
        },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(3);
    const fieldIds = apiClientMock.mock.calls.map(
      (c) => (c[1] as { body: { field_id: string } }).body.field_id,
    );
    expect(fieldIds).toEqual(
      expect.arrayContaining(['field-empty', 'field-null', 'field-real']),
    );
    expect(fieldIds).not.toContain('field-undef');
    const clearCall = apiClientMock.mock.calls.find(
      (c) => (c[1] as { body: { field_id: string } }).body.field_id === 'field-empty',
    );
    expect(
      (clearCall![1] as { body: { value: unknown } }).body.value,
    ).toEqual({ value: null });
  });

  it('saveNow is a no-op when enabled=false (#51)', async () => {
    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'hello' },
        enabled: false,
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).not.toHaveBeenCalled();
  });
});

describe('useAutoSaveProposals — one shared write path (D8)', () => {
  // D8: the write target no longer depends on the run kind. Every autosave
  // write in the editable ``extract`` stage is a per-reviewer ``edit``
  // decision on /decisions — extraction (the multi-reviewer blind contract)
  // and quality_assessment (decisions parity) alike. The old ``kind`` prop
  // and the human /proposals fallback are gone: outside ``extract`` the hook
  // writes nothing.

  it("writes an 'edit' ReviewerDecision per dirty coord for extraction in 'extract'", async () => {
    apiClientMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'reviewer-typed' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/decisions',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: {
          instance_id: 'inst-1',
          field_id: 'field-1',
          decision: 'edit',
          value: { value: 'reviewer-typed' },
        },
      }),
    );
  });

  it('never posts to /proposals (the human proposal write path is gone)', async () => {
    apiClientMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'x' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalled();
    for (const call of apiClientMock.mock.calls) {
      expect(call[0]).not.toMatch(/\/proposals$/);
    }
  });

  it("preserves null/empty as deliberate clears (decision='edit' with value=null)", async () => {
    apiClientMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': '' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledTimes(1);
    const [, opts] = apiClientMock.mock.calls[0];
    expect((opts as { body: { value: unknown } }).body.value).toEqual({
      value: null,
    });
  });

  it('does not write when stage is undefined (stage-based guard, D8)', async () => {
    // Pre-D8 a stage-less caller fell back to human /proposals writes (the
    // legacy QA flow). Both QA and extraction now pass the run stage; a
    // stage-less invocation writes nothing rather than something wrong.
    apiClientMock.mockResolvedValue(DECISION_RESPONSE);

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        values: { 'inst-1_field-1': 'hello' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).not.toHaveBeenCalled();
    expect(result.current.saveState).toBe('idle');
  });

  it("writes an 'edit' decision for a QA run in 'extract' (decisions parity)", async () => {
    // QA passes stage exactly like extraction; the kind is irrelevant to the
    // write target since D8.
    apiClientMock.mockResolvedValue(DECISION_RESPONSE);

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'hello' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/decisions',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('useAutoSaveProposals — non-writable stages are inert', () => {
  // Regression: opening a run parked at ``consensus`` (or ``finalized``)
  // fired a doomed POST on load, which the backend rejects (HTTP 400 "run
  // stage is consensus, not in ['extract']") and the UI surfaced as a
  // spurious "Error saving data automatically" toast. Only the editable
  // ``extract`` stage writes — /decisions for both kinds (D8).
  it.each(['consensus', 'finalized', 'pending'])(
    'does NOT POST and stays idle when stage=%s',
    async (stage) => {
      apiClientMock.mockResolvedValue(DECISION_RESPONSE);

      const { result } = renderHook(() =>
        useAutoSaveProposals({
          runId: 'run-1',
          stage,
          values: { 'inst-1_field-1': 'hello' },
        }),
      );

      await act(async () => {
        await result.current.saveNow();
      });

      expect(apiClientMock).not.toHaveBeenCalled();
      expect(result.current.saveState).toBe('idle');
    },
  );
});

describe('useAutoSaveProposals — mutex + error handling', () => {
  it('concurrent saveNow invocations do not double-write unchanged values', async () => {
    let release!: () => void;
    const block = new Promise<void>((resolve) => {
      release = resolve;
    });
    apiClientMock.mockImplementation(async () => {
      await block;
      return DECISION_RESPONSE;
    });

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'hello' },
      }),
    );

    await act(async () => {
      const first = result.current.saveNow();
      const second = result.current.saveNow();
      release();
      await Promise.all([first, second]);
    });

    expect(apiClientMock).toHaveBeenCalledTimes(1);
  });

  it('queues a trailing save when values change during an in-flight save', async () => {
    let releaseFirst!: () => void;
    const firstRequest = new Promise<typeof DECISION_RESPONSE>((resolve) => {
      releaseFirst = () => resolve(DECISION_RESPONSE);
    });
    apiClientMock
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce(DECISION_RESPONSE);

    const { result, rerender } = renderHook(
      ({ values }) =>
        useAutoSaveProposals({
          runId: 'run-1',
          stage: 'extract',
          values,
        }),
      {
        initialProps: {
          values: { 'inst-1_field-1': 'first' } as Record<string, unknown>,
        },
      },
    );

    let firstSave!: Promise<void>;
    await act(async () => {
      firstSave = result.current.saveNow();
      await Promise.resolve();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(1);

    rerender({ values: { 'inst-1_field-1': 'second' } });

    let trailingSave!: Promise<void>;
    await act(async () => {
      trailingSave = result.current.saveNow();
      await Promise.resolve();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirst();
      await Promise.all([firstSave, trailingSave]);
    });

    expect(apiClientMock).toHaveBeenCalledTimes(2);
    expect(apiClientMock).toHaveBeenLastCalledWith(
      '/api/v1/runs/run-1/decisions',
      expect.objectContaining({
        body: expect.objectContaining({
          value: { value: 'second' },
        }),
      }),
    );
  });

  it('surfaces partial failures and retries only the failed coord', async () => {
    apiClientMock
      .mockResolvedValueOnce(DECISION_RESPONSE)
      .mockRejectedValueOnce(new Error('network drop'))
      .mockResolvedValueOnce(DECISION_RESPONSE);

    const { result, rerender } = renderHook(
      ({ values }) =>
        useAutoSaveProposals({
          runId: 'run-1',
          stage: 'extract',
          values,
        }),
      {
        initialProps: {
          values: {
            'inst-1_a': '1',
            'inst-1_b': '2',
            'inst-1_c': '3',
          } as Record<string, unknown>,
        },
      },
    );

    await act(async () => {
      // The failed coord makes saveNow reject so a caller can gate run-advance
      // on a successful flush; saveState still reflects the partial failure.
      await expect(result.current.saveNow()).rejects.toThrow();
    });

    expect(apiClientMock).toHaveBeenCalledTimes(3);
    expect(result.current.saveState).toBe('error');
    expect(result.current.error).not.toBeNull();

    apiClientMock.mockClear();
    apiClientMock.mockResolvedValueOnce(DECISION_RESPONSE);
    rerender({
      values: { 'inst-1_a': '1', 'inst-1_b': '2', 'inst-1_c': '3' },
    });
    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect((apiClientMock.mock.calls[0][1] as { body: { field_id: string } }).body.field_id)
      .toBe('b');
    expect(result.current.saveState).toBe('saved');
  });

  it('saveNow() rejects when a write fails so run-advance can be gated (#5)', async () => {
    // Regression: performSave used to swallow the rejection and resolve, so
    // saveNow always resolved and the onMarkReady / onOpenConsensus
    // `.catch(() => false)` guard was dead — a failed flush advanced the run
    // (EXTRACT → CONSENSUS) and the unsaved edit was lost. saveNow must reject.
    apiClientMock.mockRejectedValue(new Error('network drop'));

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'unsaved-edit' },
      }),
    );

    await act(async () => {
      // Mirror the caller's guard: `.then(() => true).catch(() => false)`.
      const gated = await result.current
        .saveNow()
        .then(() => true)
        .catch(() => false);
      expect(gated).toBe(false);
    });
    expect(result.current.saveState).toBe('error');
  });
});

describe('useAutoSaveProposals — state machine', () => {
  it('transitions idle → dirty → saving → saved through the debounce', async () => {
    apiClientMock.mockResolvedValue(DECISION_RESPONSE);

    const { result, rerender } = renderHook(
      ({ values }) =>
        useAutoSaveProposals({
          runId: 'run-1',
          stage: 'extract',
          values,
          debounceMs: 20,
        }),
      {
        initialProps: { values: {} as Record<string, unknown> },
      },
    );
    expect(result.current.saveState).toBe('idle');

    rerender({ values: { 'inst-1_field-1': 'typed' } });
    expect(result.current.saveState).toBe('dirty');
    expect(result.current.hasUnsavedChanges).toBe(true);

    await waitFor(() => expect(result.current.saveState).toBe('saved'), {
      timeout: 1000,
    });
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(apiClientMock).toHaveBeenCalledTimes(1);
  });

  it('error → dirty cycle on the next keystroke', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('boom'));

    const { result, rerender } = renderHook(
      ({ values }) =>
        useAutoSaveProposals({
          runId: 'run-1',
          stage: 'extract',
          values,
        }),
      {
        initialProps: {
          values: { 'inst-1_a': 'x' } as Record<string, unknown>,
        },
      },
    );

    await act(async () => {
      await expect(result.current.saveNow()).rejects.toThrow();
    });
    expect(result.current.saveState).toBe('error');

    apiClientMock.mockResolvedValueOnce(DECISION_RESPONSE);
    rerender({ values: { 'inst-1_a': 'y' } });
    expect(result.current.saveState).toBe('dirty');

    await act(async () => {
      await result.current.saveNow();
    });
    expect(result.current.saveState).toBe('saved');
  });
});

describe('useAutoSaveProposals — lifecycle survivability', () => {
  it('flushes pending edits on unmount (the original bug)', async () => {
    apiClientMock.mockResolvedValue(DECISION_RESPONSE);

    const { unmount } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'mid-typing' },
        debounceMs: 5000,
      }),
    );

    // User leaves the page WAY before the 5s debounce would have fired.
    unmount();

    await waitFor(() => expect(apiClientMock).toHaveBeenCalledTimes(1));
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/decisions',
      expect.objectContaining({ keepalive: true }),
    );
  });

  it('does not flush on unmount when there are no dirty changes', async () => {
    apiClientMock.mockResolvedValue(DECISION_RESPONSE);

    const { result, unmount } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'persisted' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(apiClientMock).toHaveBeenCalledTimes(1);
  });

  it('pagehide triggers an immediate flush', async () => {
    apiClientMock.mockResolvedValue(DECISION_RESPONSE);

    renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'about-to-leave' },
        debounceMs: 5000,
      }),
    );

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });

    await waitFor(() => expect(apiClientMock).toHaveBeenCalledTimes(1));
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/decisions',
      expect.objectContaining({ keepalive: true }),
    );
  });

  it('visibilitychange to "hidden" triggers a flush', async () => {
    apiClientMock.mockResolvedValue(DECISION_RESPONSE);

    renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'tab-switched' },
        debounceMs: 5000,
      }),
    );

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(apiClientMock).toHaveBeenCalledTimes(1));
  });
});

describe('useAutoSaveProposals — AI link stamping (D0)', () => {
  it('attaches proposal_record_id to the edit decision for linked coords', async () => {
    apiClientMock.mockResolvedValue({});

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'ai text' },
        linkByKey: { 'inst-1_field-1': 'prop-9' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/decisions',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: {
          instance_id: 'inst-1',
          field_id: 'field-1',
          decision: 'edit',
          value: { value: 'ai text' },
          proposal_record_id: 'prop-9',
        },
      }),
    );
  });

  it('omits proposal_record_id for unlinked coords', async () => {
    apiClientMock.mockResolvedValue({});

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'typed by hand' },
        linkByKey: { 'inst-OTHER_field-1': 'prop-9' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledTimes(1);
    const body = apiClientMock.mock.calls[0][1].body;
    expect(body).not.toHaveProperty('proposal_record_id');
  });

  it('a link-only adoption on an unchanged value still writes the linked decision', async () => {
    apiClientMock.mockResolvedValue({});

    const baseProps: Parameters<typeof useAutoSaveProposals>[0] = {
      runId: 'run-1',
      stage: 'extract',
      values: { 'inst-1_field-1': 'same' },
      baselineValues: { 'inst-1_field-1': 'same' },
    };
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useAutoSaveProposals>[0]) => useAutoSaveProposals(props),
      { initialProps: baseProps },
    );

    // Baseline-equal value, no link: nothing to save.
    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).not.toHaveBeenCalled();

    // The reviewer adopts an AI version whose value is byte-identical — the
    // selection event must still append a linked decision (D0 / §IX).
    rerender({ ...baseProps, linkByKey: { 'inst-1_field-1': 'prop-9' } });
    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/decisions',
      expect.objectContaining({
        body: expect.objectContaining({
          value: { value: 'same' },
          proposal_record_id: 'prop-9',
        }),
      }),
    );
  });

  it('mount with the persisted link (baselineLinkByKey) does not re-post', async () => {
    apiClientMock.mockResolvedValue({});

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'extract',
        values: { 'inst-1_field-1': 'same' },
        baselineValues: { 'inst-1_field-1': 'same' },
        linkByKey: { 'inst-1_field-1': 'prop-9' },
        baselineLinkByKey: { 'inst-1_field-1': 'prop-9' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).not.toHaveBeenCalled();
  });
});
