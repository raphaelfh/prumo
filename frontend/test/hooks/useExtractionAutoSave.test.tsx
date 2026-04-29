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

  it('skips empty / null / undefined values', async () => {
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
    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/runs/run-1/proposals',
      expect.objectContaining({
        body: expect.objectContaining({
          field_id: 'field-real',
        }),
      }),
    );
  });
});
