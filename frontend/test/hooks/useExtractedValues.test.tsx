/**
 * Tests for the rewritten ``useExtractedValues``.
 *
 * The hook now branches by ``run.stage``:
 *  - ``proposal``: hydrate from ``runDetail.proposals`` (newest-per-coord,
 *    any source). No DB call. Mirrors QA.
 *  - ``review`` / ``consensus`` / ``finalized``: hydrate from proposals as
 *    the baseline, then overlay ``ExtractionValueService.loadValuesForUser``
 *    (current decision per coord, scoped to the active reviewer).
 *  - missing run / pending / unknown: empty.
 *
 * The legacy ``save()`` method is gone — the autosave is the sole
 * writer.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })),
    },
  },
}));

vi.mock('@/services/extractionValueService', () => ({
  ExtractionValueService: {
    loadValuesForUser: vi.fn(async () => []),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { ExtractionValueService } from '@/services/extractionValueService';
import { useExtractedValues } from '@/hooks/extraction/useExtractedValues';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useExtractedValues — stage=proposal', () => {
  it('hydrates from proposals (newest-per-coord) without hitting reviewer_states', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        runId: 'run-1',
        stage: 'proposal',
        proposals: [
          {
            id: 'p-old',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            source: 'human',
            source_user_id: 'user-1',
            proposed_value: { value: 'old' },
            confidence_score: null,
            rationale: null,
            created_at: '2026-04-28T10:00:00Z',
          },
          {
            id: 'p-newest',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            source: 'human',
            source_user_id: 'user-1',
            proposed_value: { value: 'newest' },
            confidence_score: null,
            rationale: null,
            created_at: '2026-04-28T11:00:00Z',
          },
          {
            id: 'p-other',
            run_id: 'run-1',
            instance_id: 'inst-2',
            field_id: 'field-2',
            source: 'ai',
            source_user_id: null,
            proposed_value: { value: 'A', unit: 'mg' },
            confidence_score: 0.8,
            rationale: null,
            created_at: '2026-04-28T10:00:00Z',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('newest');
    expect(result.current.values['inst-2_field-2']).toEqual({
      value: 'A',
      unit: 'mg',
    });
    expect(ExtractionValueService.loadValuesForUser).not.toHaveBeenCalled();
  });

  it('returns empty when no proposals are provided', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        runId: 'run-1',
        stage: 'proposal',
        proposals: [],
      }),
    );
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values).toEqual({});
  });
});

describe('useExtractedValues — stage=review and beyond', () => {
  it('uses proposals as the baseline when no reviewer decisions exist', async () => {
    (ExtractionValueService.loadValuesForUser as any).mockResolvedValueOnce([]);

    const { result } = renderHook(() =>
      useExtractedValues({
        runId: 'run-1',
        stage: 'review',
        proposals: [
          {
            id: 'p-system',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            source: 'system',
            source_user_id: null,
            proposed_value: { value: 'seeded from published state' },
            confidence_score: null,
            rationale: null,
            created_at: '2026-04-28T10:00:00Z',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(ExtractionValueService.loadValuesForUser).toHaveBeenCalledWith(
      'run-1',
      'user-1',
    );
    expect(result.current.values['inst-1_field-1']).toBe('seeded from published state');
  });

  it('overlays reviewer decisions over proposal baselines and clears rejects', async () => {
    (ExtractionValueService.loadValuesForUser as any).mockResolvedValueOnce([
      {
        instanceId: 'inst-1',
        fieldId: 'field-1',
        value: 42,
        decision: 'edit',
        reviewerId: 'user-1',
        decidedAt: '2026-04-28T10:00:00Z',
      },
      {
        instanceId: 'inst-2',
        fieldId: 'field-2',
        value: 'should-not-show',
        decision: 'reject',
        reviewerId: 'user-1',
        decidedAt: '2026-04-28T10:00:00Z',
      },
      {
        instanceId: 'inst-3',
        fieldId: 'field-3',
        value: { value: 'A', unit: 'mg' },
        decision: 'edit',
        reviewerId: 'user-1',
        decidedAt: '2026-04-28T10:00:00Z',
      },
    ]);

    const { result } = renderHook(() =>
      useExtractedValues({
        runId: 'run-1',
        stage: 'review',
        proposals: [
          {
            id: 'p-1',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            source: 'human',
            source_user_id: 'user-1',
            proposed_value: { value: 'proposal value' },
            confidence_score: null,
            rationale: null,
            created_at: '2026-04-28T09:00:00Z',
          },
          {
            id: 'p-2',
            run_id: 'run-1',
            instance_id: 'inst-2',
            field_id: 'field-2',
            source: 'human',
            source_user_id: 'user-1',
            proposed_value: { value: 'proposal should be cleared' },
            confidence_score: null,
            rationale: null,
            created_at: '2026-04-28T09:00:00Z',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(ExtractionValueService.loadValuesForUser).toHaveBeenCalledWith(
      'run-1',
      'user-1',
    );
    expect(result.current.values['inst-1_field-1']).toBe(42);
    expect(result.current.values['inst-2_field-2']).toBeNull();
    expect(result.current.values['inst-3_field-3']).toEqual({
      value: 'A',
      unit: 'mg',
    });
  });
});

describe('useExtractedValues — missing run / no auth', () => {
  it('returns empty + initialized=true when runId is null', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        runId: null,
        stage: null,
      }),
    );
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values).toEqual({});
    expect(ExtractionValueService.loadValuesForUser).not.toHaveBeenCalled();
  });

  it('returns empty when there is no authenticated user (review path)', async () => {
    const supabase = (await import('@/integrations/supabase/client')).supabase;
    (supabase.auth.getUser as any).mockResolvedValueOnce({
      data: { user: null },
    });

    const { result } = renderHook(() =>
      useExtractedValues({
        runId: 'run-1',
        stage: 'review',
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ExtractionValueService.loadValuesForUser).not.toHaveBeenCalled();
    expect(result.current.values).toEqual({});
  });
});

describe('useExtractedValues — local update', () => {
  it('updateValue patches the local map immediately', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        runId: 'run-1',
        stage: 'proposal',
        proposals: [],
      }),
    );
    await waitFor(() => expect(result.current.initialized).toBe(true));
    result.current.updateValue('inst-1', 'field-1', 'typed');
    await waitFor(() =>
      expect(result.current.values['inst-1_field-1']).toBe('typed'),
    );
  });
});
