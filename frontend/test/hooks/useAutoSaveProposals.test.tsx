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

const PROPOSAL_RESPONSE = {
  id: 'p-1',
  run_id: 'run-1',
  instance_id: 'inst-1',
  field_id: 'field-1',
  source: 'human',
  source_user_id: null,
  proposed_value: { value: 'hello' },
  confidence_score: null,
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
  it('writes a human proposal per changed coord on saveNow()', async () => {
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        values: { 'inst-1_field-1': 'hello' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/proposals',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: {
          instance_id: 'inst-1',
          field_id: 'field-1',
          source: 'human',
          proposed_value: { value: 'hello' },
        },
      }),
    );
    expect(result.current.lastSavedAt).not.toBeNull();
    expect(result.current.saveState).toBe('saved');
  });

  it('skips coords whose value did not change since the last save', async () => {
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    const { result, rerender } = renderHook(
      ({ values }) =>
        useAutoSaveProposals({
          runId: 'run-1',
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
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
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
      (clearCall![1] as { body: { proposed_value: unknown } }).body.proposed_value,
    ).toEqual({ value: null });
  });

  it('saveNow is a no-op when enabled=false (#51)', async () => {
    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
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

describe('useAutoSaveProposals — stage-aware write target (Layer 2 fix)', () => {
  // Bug B (multi-reviewer blind review): during stage='review' every
  // reviewer's edit must land as a per-user ``ReviewerDecision`` so the
  // load path (``loadValuesForUser``) keeps them blinded from each
  // other. The previous unified write to /proposals appended the value
  // as a shared ProposalRecord, which broke the per-user contract and
  // also wasted writes that ``useExtractedValues``' review branch would
  // never read back. Fix: when the caller passes ``stage='review'``,
  // POST to /decisions with decision='edit'.

  it("writes an 'edit' ReviewerDecision per dirty coord when stage='review'", async () => {
    apiClientMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'review',
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

  it("does NOT post a /proposals write when stage='review' (no double write)", async () => {
    apiClientMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'review',
        values: { 'inst-1_field-1': 'x' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    for (const call of apiClientMock.mock.calls) {
      expect(call[0]).not.toMatch(/\/proposals$/);
    }
  });

  it("preserves null/empty as deliberate clears (decision='edit' with value=null)", async () => {
    apiClientMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'review',
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

  it("falls back to /proposals when stage is undefined (QA backwards compat)", async () => {
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        values: { 'inst-1_field-1': 'hello' },
        // stage omitted on purpose — QA never passes it
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/proposals',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it("writes to /proposals when stage='proposal' explicitly (extraction PROPOSAL stage)", async () => {
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        stage: 'proposal',
        values: { 'inst-1_field-1': 'hello' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/proposals',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('useAutoSaveProposals — mutex + error handling', () => {
  it('concurrent saveNow invocations do not double-write unchanged values', async () => {
    let release!: () => void;
    const block = new Promise<void>((resolve) => {
      release = resolve;
    });
    apiClientMock.mockImplementation(async () => {
      await block;
      return PROPOSAL_RESPONSE;
    });

    const { result } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
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
    const firstRequest = new Promise<typeof PROPOSAL_RESPONSE>((resolve) => {
      releaseFirst = () => resolve(PROPOSAL_RESPONSE);
    });
    apiClientMock
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce(PROPOSAL_RESPONSE);

    const { result, rerender } = renderHook(
      ({ values }) =>
        useAutoSaveProposals({
          runId: 'run-1',
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
      '/api/v1/runs/run-1/proposals',
      expect.objectContaining({
        body: expect.objectContaining({
          proposed_value: { value: 'second' },
        }),
      }),
    );
  });

  it('surfaces partial failures and retries only the failed coord', async () => {
    apiClientMock
      .mockResolvedValueOnce(PROPOSAL_RESPONSE)
      .mockRejectedValueOnce(new Error('network drop'))
      .mockResolvedValueOnce(PROPOSAL_RESPONSE);

    const { result, rerender } = renderHook(
      ({ values }) =>
        useAutoSaveProposals({
          runId: 'run-1',
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
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledTimes(3);
    expect(result.current.saveState).toBe('error');
    expect(result.current.error).not.toBeNull();

    apiClientMock.mockClear();
    apiClientMock.mockResolvedValueOnce(PROPOSAL_RESPONSE);
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
});

describe('useAutoSaveProposals — state machine', () => {
  it('transitions idle → dirty → saving → saved through the debounce', async () => {
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    const { result, rerender } = renderHook(
      ({ values }) =>
        useAutoSaveProposals({
          runId: 'run-1',
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
          values,
        }),
      {
        initialProps: {
          values: { 'inst-1_a': 'x' } as Record<string, unknown>,
        },
      },
    );

    await act(async () => {
      await result.current.saveNow();
    });
    expect(result.current.saveState).toBe('error');

    apiClientMock.mockResolvedValueOnce(PROPOSAL_RESPONSE);
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
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    const { unmount } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        values: { 'inst-1_field-1': 'mid-typing' },
        debounceMs: 5000,
      }),
    );

    // User leaves the page WAY before the 5s debounce would have fired.
    unmount();

    await waitFor(() => expect(apiClientMock).toHaveBeenCalledTimes(1));
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/proposals',
      expect.objectContaining({ keepalive: true }),
    );
  });

  it('does not flush on unmount when there are no dirty changes', async () => {
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    const { result, unmount } = renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
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
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
        values: { 'inst-1_field-1': 'about-to-leave' },
        debounceMs: 5000,
      }),
    );

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });

    await waitFor(() => expect(apiClientMock).toHaveBeenCalledTimes(1));
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/proposals',
      expect.objectContaining({ keepalive: true }),
    );
  });

  it('visibilitychange to "hidden" triggers a flush', async () => {
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    renderHook(() =>
      useAutoSaveProposals({
        runId: 'run-1',
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
