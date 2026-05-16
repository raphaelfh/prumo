/**
 * Tests for the rewritten ``useExtractionAutoSave`` — confirms it
 * persists user edits as ``human`` proposals on the active run via
 * ``POST /api/v1/runs/{runId}/proposals`` (direct ``apiClient`` call,
 * bypassing ``useCreateProposal`` so per-keystroke writes don't
 * invalidate the run detail cache), only writes coordinates whose
 * value actually changed since the last successful save, and is a
 * no-op when no run is open.
 *
 * The 3s debounce is bypassed by calling ``saveNow()`` directly so
 * tests stay deterministic.
 */

import { act, renderHook } from '@testing-library/react';
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
import { useExtractionAutoSave } from '@/hooks/extraction/useExtractionAutoSave';

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

describe('useExtractionAutoSave (proposals path)', () => {
  it('writes a human proposal per changed coord on saveNow()', async () => {
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    const { result } = renderHook(() =>
      useExtractionAutoSave({
        runId: 'run-1',
        values: { 'inst-1_field-1': 'hello' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/runs/run-1/proposals', {
      method: 'POST',
      body: {
        instance_id: 'inst-1',
        field_id: 'field-1',
        source: 'human',
        proposed_value: { value: 'hello' },
      },
    });
    expect(result.current.lastSaved).not.toBeNull();
  });

  it('skips coords whose value did not change since the last save', async () => {
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    const { result, rerender } = renderHook(
      ({ values }) =>
        useExtractionAutoSave({
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

    // Re-render with the SAME value — saveNow should be a no-op.
    rerender({ values: { 'inst-1_field-1': 'a' } });
    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(1);

    // Change the value — saveNow writes a new proposal.
    rerender({ values: { 'inst-1_field-1': 'b' } });
    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when runId is missing', async () => {
    const { result } = renderHook(() =>
      useExtractionAutoSave({
        runId: null,
        values: { 'inst-1_field-1': 'hello' },
      }),
    );

    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).not.toHaveBeenCalled();
  });

  it('skips only undefined values; null and empty-string are persisted as deliberate clears (#25)', async () => {
    apiClientMock.mockResolvedValue(PROPOSAL_RESPONSE);

    const { result } = renderHook(() =>
      useExtractionAutoSave({
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
    // undef skipped → empty, null, real are written (3 calls).
    expect(apiClientMock).toHaveBeenCalledTimes(3);
    const fieldIds = apiClientMock.mock.calls.map(
      (c) => (c[1] as any).body.field_id,
    );
    expect(fieldIds).toEqual(
      expect.arrayContaining(['field-empty', 'field-null', 'field-real']),
    );
    expect(fieldIds).not.toContain('field-undef');
    // Cleared fields go out as { value: null }.
    const clearCall = apiClientMock.mock.calls.find(
      (c) => (c[1] as any).body.field_id === 'field-empty',
    );
    expect((clearCall![1] as any).body.proposed_value).toEqual({ value: null });
  });

  it('saveNow is a no-op when enabled=false even with a valid runId (#51)', async () => {
    const { result } = renderHook(() =>
      useExtractionAutoSave({
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

  it('concurrent saveNow invocations do not double-write (#13/#47 mutex)', async () => {
    // Make every apiClient call hang until we resolve it manually.
    let releaseFirstBatch!: () => void;
    const block = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve;
    });
    apiClientMock.mockImplementation(async () => {
      await block;
      return PROPOSAL_RESPONSE;
    });

    const { result } = renderHook(() =>
      useExtractionAutoSave({
        runId: 'run-1',
        values: { 'inst-1_field-1': 'hello' },
      }),
    );

    // Fire two concurrent saves without awaiting the first.
    let first: Promise<void>;
    let second: Promise<void>;
    await act(async () => {
      first = result.current.saveNow();
      second = result.current.saveNow();
      releaseFirstBatch();
      await Promise.all([first, second]);
    });

    // Without the mutex both calls would hit the SELECT/diff in parallel
    // and POST twice. With the guard the second is a silent no-op.
    expect(apiClientMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces partial Promise.all failures and persists successful writes (#74)', async () => {
    // First call resolves, second rejects, third resolves — without the
    // ``allSettled`` rewrite the catch block would fire mid-flight and
    // leave ``lastSavedByKey`` inconsistent.
    apiClientMock
      .mockResolvedValueOnce(PROPOSAL_RESPONSE)
      .mockRejectedValueOnce(new Error('network drop'))
      .mockResolvedValueOnce(PROPOSAL_RESPONSE);

    const { result, rerender } = renderHook(
      ({ values }) =>
        useExtractionAutoSave({
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
    expect(result.current.error).not.toBeNull();

    // Re-running saveNow without changing values should retry only the
    // one that failed (a and c are already in lastSavedByKey).
    apiClientMock.mockClear();
    apiClientMock.mockResolvedValueOnce(PROPOSAL_RESPONSE);
    rerender({
      values: {
        'inst-1_a': '1',
        'inst-1_b': '2',
        'inst-1_c': '3',
      },
    });
    await act(async () => {
      await result.current.saveNow();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect((apiClientMock.mock.calls[0][1] as any).body.field_id).toBe('b');
  });
});
