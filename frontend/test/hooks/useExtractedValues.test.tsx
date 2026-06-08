/**
 * Tests for the rewritten ``useExtractedValues``.
 *
 * The hook now branches by ``run.stage``:
 *  - ``proposal``: hydrate from ``runDetail.proposals`` (newest-per-coord,
 *    any source). No DB call. Mirrors QA.
 *  - ``review`` / ``consensus`` / ``finalized``: hydrate from the
 *    ``currentValues`` embedded in the run view (current decision per
 *    coord, resolved + reviewer-scoped server-side). No DB call.
 *  - missing run / pending / unknown: empty.
 *
 * The legacy ``save()`` method is gone — the autosave is the sole
 * writer.
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

vi.mock('@/services/extractionValueService', () => ({
  ExtractionValueService: {
    loadValuesForUser: vi.fn(async () => []),
  },
  unwrapValue: (raw: unknown) => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'object' && raw !== null && 'value' in raw) {
      return (raw as { value: unknown }).value ?? null;
    }
    return raw;
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
import type { ProposalRecordResponse } from '@/hooks/runs/types';

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
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'proposal',
        proposals: [
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
            id: 'p-old',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            source: 'ai',
            source_user_id: null,
            proposed_value: { value: 'old' },
            confidence_score: 0.9,
            rationale: null,
            created_at: '2026-04-28T10:00:00Z',
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
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'proposal',
        proposals: [],
      }),
    );
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values).toEqual({});
  });
});

describe('useExtractedValues — stage=proposal blinding (multi-reviewer)', () => {
  // Bug A (multi-reviewer blind leak): the PROPOSAL stage hydration
  // used to take the newest proposal per coord regardless of source,
  // which meant a `human` proposal written by reviewer A appeared in
  // reviewer B's form as soon as B opened the same article — silently
  // breaking the blind-review contract. Fix: filter `human` proposals
  // by `source_user_id === current_user_id`. AI / system proposals are
  // always visible (they are not reviewer-attributable opinions).
  it("does NOT hydrate another reviewer's human proposal (the leak)", async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'proposal',
        proposals: [
          {
            id: 'p-other-human',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            source: 'human',
            source_user_id: 'user-2', // a different reviewer
            proposed_value: { value: "leaked-from-A" },
            confidence_score: null,
            rationale: null,
            created_at: '2026-04-28T10:00:00Z',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    // user-1 is the auth user (mock). user-2's human proposal must be
    // invisible — blind-review contract.
    expect(result.current.values['inst-1_field-1']).toBeUndefined();
  });

  it("DOES hydrate the current reviewer's own human proposal", async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'proposal',
        proposals: [
          {
            id: 'p-mine',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            source: 'human',
            source_user_id: 'user-1', // matches the mocked auth user
            proposed_value: { value: 'mine' },
            confidence_score: null,
            rationale: null,
            created_at: '2026-04-28T10:00:00Z',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('mine');
  });

  it('always hydrates AI proposals (not reviewer-attributable)', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'proposal',
        proposals: [
          {
            id: 'p-ai',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            source: 'ai',
            source_user_id: null,
            proposed_value: { value: 'ai-extracted' },
            confidence_score: 0.9,
            rationale: null,
            created_at: '2026-04-28T10:00:00Z',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('ai-extracted');
  });

  it('always hydrates system proposals (e.g. reopen seed)', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'proposal',
        proposals: [
          {
            id: 'p-system',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            source: 'system',
            source_user_id: null,
            proposed_value: { value: 'carried-over' },
            confidence_score: null,
            rationale: null,
            created_at: '2026-04-28T10:00:00Z',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('carried-over');
  });

  it('newest-per-coord wins ONLY among visible proposals (other reviewer is skipped, not picked)', async () => {
    // Two proposals for the same coord. Newest is from another reviewer
    // (must be filtered). Older AI proposal should remain visible.
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'proposal',
        proposals: [
          {
            id: 'p-other-newest',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            source: 'human',
            source_user_id: 'user-2',
            proposed_value: { value: 'leaked-from-A' },
            confidence_score: null,
            rationale: null,
            created_at: '2026-04-28T11:00:00Z',
          },
          {
            id: 'p-ai-older',
            run_id: 'run-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            source: 'ai',
            source_user_id: null,
            proposed_value: { value: 'ai-extracted' },
            confidence_score: 0.9,
            rationale: null,
            created_at: '2026-04-28T10:00:00Z',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('ai-extracted');
  });
});

describe('useExtractedValues — stage=review via currentValues', () => {
  it('hydrates from currentValues, skips reject decisions, and does NOT call loadValuesForUser', async () => {
    const i1 = 'inst-1';
    const f1 = 'field-1';
    const f2 = 'field-2';

    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'review',
        currentValues: [
          {
            instance_id: i1,
            field_id: f1,
            value: { value: 'X', unit: null },
            decision: 'edit',
          },
          {
            instance_id: i1,
            field_id: f2,
            value: { value: 'Y' },
            decision: 'reject',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    // (a) edit decision is included with correct value
    expect(result.current.values[`${i1}_${f1}`]).toBe('X');
    // (b) reject decision is excluded
    expect(result.current.values[`${i1}_${f2}`]).toBeUndefined();
    // (c) loadValuesForUser is NOT called
    expect(ExtractionValueService.loadValuesForUser).not.toHaveBeenCalled();
  });
});

describe('useExtractedValues — stage=review and beyond', () => {
  it('hydrates from currentValues, skips reject decisions, does NOT call loadValuesForUser', async () => {
    // The review branch now reads from the pre-computed currentValues
    // embedded in the run view rather than issuing its own PostgREST query.
    // cv.value is the RAW server envelope: { value: <inner> }.
    // For a plain scalar: cv.value = { value: 42 } → unwrapped = 42
    // For a unit-bearing value: cv.value = { value: { value: 'A', unit: 'mg' } }
    //   → unwrapped = { value: 'A', unit: 'mg' }, unit = 'mg'
    //   → extractValueFromDb returns { value: 'A', unit: 'mg' }
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'review',
        currentValues: [
          {
            instance_id: 'inst-1',
            field_id: 'field-1',
            value: { value: 42 },
            decision: 'edit',
          },
          {
            instance_id: 'inst-2',
            field_id: 'field-2',
            value: { value: 'should-not-show' },
            decision: 'reject',
          },
          {
            instance_id: 'inst-3',
            field_id: 'field-3',
            // double-envelope: outer { value: ... } stripped by unwrapValue,
            // inner { value: 'A', unit: 'mg' } is the unwrapped form
            value: { value: { value: 'A', unit: 'mg' } },
            decision: 'edit',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(ExtractionValueService.loadValuesForUser).not.toHaveBeenCalled();
    expect(result.current.values['inst-1_field-1']).toBe(42);
    expect(result.current.values['inst-2_field-2']).toBeUndefined();
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
        currentUserId: 'user-1',
        runId: null,
        stage: null,
      }),
    );
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values).toEqual({});
    expect(ExtractionValueService.loadValuesForUser).not.toHaveBeenCalled();
  });

  it('returns empty when there is no authenticated user (review path)', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: null,
        runId: 'run-1',
        stage: 'review',
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ExtractionValueService.loadValuesForUser).not.toHaveBeenCalled();
    expect(result.current.values).toEqual({});
  });
});

describe('useExtractedValues — disabled state (no run yet)', () => {
  // Regression: ``loading`` is initialised to ``true`` so the first
  // paint shows a spinner. Before the fix the effect early-returned on
  // ``enabled=false`` *without* resetting ``loading``, leaving the
  // extraction page stuck on its render-gate
  // ``if (loading || valuesLoading) → <Loader2 />`` forever whenever
  // ``useExtractionSession`` had not yet returned a ``runId`` (Render
  // cold start, BOLA reject, silent 401, …). This locks the contract
  // that a disabled hook does NOT sit in the loading state.

  it('flips loading=false and initialized=true synchronously when enabled=false', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: null,
        stage: null,
        proposals: [],
        enabled: false,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.initialized).toBe(true);
    expect(result.current.values).toEqual({});
    expect(ExtractionValueService.loadValuesForUser).not.toHaveBeenCalled();
  });

  it('does not get stuck even when runId is set but enabled is explicitly false', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'review',
        proposals: [],
        enabled: false,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ExtractionValueService.loadValuesForUser).not.toHaveBeenCalled();
  });

  it('becomes initialized once enabled flips from false to true', async () => {
    const currentValues = [
      {
        instance_id: 'inst-1',
        field_id: 'field-1',
        value: { value: 'hydrated' },
        decision: 'edit',
      },
    ];
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useExtractedValues({
          currentUserId: 'user-1',
          runId: 'run-1',
          stage: 'review',
          proposals: [],
          currentValues,
          enabled,
        }),
      { initialProps: { enabled: false } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ExtractionValueService.loadValuesForUser).not.toHaveBeenCalled();

    rerender({ enabled: true });
    // After re-enabling the hook must hydrate the form from currentValues
    // (the page wouldn't otherwise show values once the session resolves).
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('hydrated');
    expect(ExtractionValueService.loadValuesForUser).not.toHaveBeenCalled();
  });
});

describe('useExtractedValues — local update', () => {
  it('updateValue patches the local map immediately', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'proposal',
        proposals: [],
      }),
    );
    await waitFor(() => expect(result.current.initialized).toBe(true));
    act(() => {
      result.current.updateValue('inst-1', 'field-1', 'typed');
    });
    await waitFor(() =>
      expect(result.current.values['inst-1_field-1']).toBe('typed'),
    );
  });
});

describe('useExtractedValues — local-edits-win on backend refetch', () => {
  // Regression: a TanStack ``useRun`` refetch (window focus, stale time,
  // mount) produces a fresh ``proposals`` array reference. Without
  // preserving locally-edited keys, ``mergeValuesById`` would overwrite
  // the user's in-flight edit with the previously-saved backend value,
  // and the autosave hook would then see ``no dirty entries`` and skip
  // the POST — silently dropping every keystroke between two refetches.
  // This locks in: once a key exists in local state, the merge MUST NOT
  // clobber it with a backend-shaped value.

  it('preserves a locally-edited value when proposals refetch with the previous backend value', async () => {
    const initialProposals = [
      {
        id: 'p-1',
        run_id: 'run-1',
        instance_id: 'inst-1',
        field_id: 'field-1',
        source: 'human' as const,
        source_user_id: 'user-1',
        proposed_value: { value: 'old' },
        confidence_score: null,
        rationale: null,
        created_at: '2026-04-28T10:00:00Z',
      },
    ];

    const { result, rerender } = renderHook(
      ({ proposals }) =>
        useExtractedValues({
          currentUserId: 'user-1',
          runId: 'run-1',
          stage: 'proposal',
          proposals,
        }),
      { initialProps: { proposals: initialProposals } },
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('old');

    // User types a new value (in-flight, autosave POST not yet flushed).
    act(() => {
      result.current.updateValue('inst-1', 'field-1', 'user-typed');
    });
    await waitFor(() =>
      expect(result.current.values['inst-1_field-1']).toBe('user-typed'),
    );

    // TanStack refetch: a new array reference with the SAME old backend
    // values (the user's POST hasn't landed yet, so the server still
    // returns 'old'). This re-fires ``loadValues``.
    const refetched = initialProposals.map((p) => ({ ...p }));
    rerender({ proposals: refetched });

    // The local edit must survive — the user is still typing.
    await waitFor(() =>
      expect(result.current.values['inst-1_field-1']).toBe('user-typed'),
    );
  });

  it('still picks up newly-introduced keys (e.g. AI-extracted fields) on refetch', async () => {
    const { result, rerender } = renderHook<
      ReturnType<typeof useExtractedValues>,
      { proposals: ProposalRecordResponse[] }
    >(
      ({ proposals }) =>
        useExtractedValues({
          currentUserId: 'user-1',
          runId: 'run-1',
          stage: 'proposal',
          proposals,
        }),
      {
        initialProps: {
          proposals: [
            {
              id: 'p-existing',
              run_id: 'run-1',
              instance_id: 'inst-1',
              field_id: 'field-1',
              source: 'human' as const,
              source_user_id: 'user-1',
              proposed_value: { value: 'mine' },
              confidence_score: null,
              rationale: null,
              created_at: '2026-04-28T10:00:00Z',
            },
          ],
        },
      },
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('mine');
    expect(result.current.values['inst-2_field-2']).toBeUndefined();

    // AI extraction lands a brand-new proposal for a coord the user
    // hasn't touched. Refetch surfaces it; the form should show it.
    rerender({
      proposals: [
        {
          id: 'p-existing',
          run_id: 'run-1',
          instance_id: 'inst-1',
          field_id: 'field-1',
          source: 'human' as const,
          source_user_id: 'user-1',
          proposed_value: { value: 'mine' },
          confidence_score: null,
          rationale: null,
          created_at: '2026-04-28T10:00:00Z',
        },
        {
          id: 'p-new',
          run_id: 'run-1',
          instance_id: 'inst-2',
          field_id: 'field-2',
          source: 'ai' as const,
          source_user_id: null,
          proposed_value: { value: 'ai-suggested' },
          confidence_score: 0.9,
          rationale: null,
          created_at: '2026-04-28T10:30:00Z',
        },
      ],
    });

    await waitFor(() =>
      expect(result.current.values['inst-2_field-2']).toBe('ai-suggested'),
    );
    // Pre-existing key still wins.
    expect(result.current.values['inst-1_field-1']).toBe('mine');
  });
});

describe('useExtractedValues — run boundary reset', () => {
  it('replaces preserved local values when the active run changes', async () => {
    const run1Proposals = [
      {
        id: 'p-run-1',
        run_id: 'run-1',
        instance_id: 'inst-1',
        field_id: 'field-1',
        source: 'human' as const,
        source_user_id: 'user-1',
        proposed_value: { value: 'old-run-value' },
        confidence_score: null,
        rationale: null,
        created_at: '2026-04-28T10:00:00Z',
      },
    ];
    const run2Proposals = [
      {
        id: 'p-run-2',
        run_id: 'run-2',
        instance_id: 'inst-1',
        field_id: 'field-1',
        source: 'human' as const,
        source_user_id: 'user-1',
        proposed_value: { value: 'new-run-value' },
        confidence_score: null,
        rationale: null,
        created_at: '2026-04-28T11:00:00Z',
      },
    ];

    const { result, rerender } = renderHook(
      ({ runId, proposals }) =>
        useExtractedValues({
          currentUserId: 'user-1',
          runId,
          stage: 'proposal',
          proposals,
        }),
      { initialProps: { runId: 'run-1', proposals: run1Proposals } },
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('old-run-value');

    act(() => {
      result.current.updateValue('inst-1', 'field-1', 'unsaved-run-1-edit');
    });
    await waitFor(() =>
      expect(result.current.values['inst-1_field-1']).toBe('unsaved-run-1-edit'),
    );

    rerender({ runId: 'run-2', proposals: run2Proposals });

    await waitFor(() =>
      expect(result.current.values['inst-1_field-1']).toBe('new-run-value'),
    );
  });
});
