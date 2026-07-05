/**
 * Tests for the rewritten ``useExtractedValues``.
 *
 * The hook branches by stage (both run kinds write per-user decisions
 * since D8 — the QA proposals read path is gone; the blind boundary is
 * pinned server-side in the ``resolve_caller_current_values`` integration
 * tests):
 *  - ``extract`` / ``consensus``: hydrate from the ``currentValues``
 *    embedded in the run view (current decision per coord, resolved +
 *    caller-scoped server-side). No DB call.
 *  - ``finalized``: hydrate ONLY from ``publishedStates`` (published truth,
 *    spec 2026-07-02 D3) — the values map is fully REPLACED, never merged.
 *  - missing run / pending / unknown: empty.
 *
 * The legacy ``save()`` method is gone — the autosave is the sole writer.
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { useExtractedValues } from '@/hooks/extraction/useExtractedValues';
import type { RunViewCurrentValue } from '@/hooks/runs/types';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useExtractedValues — extract via currentValues', () => {
  it('hydrates from currentValues and skips reject decisions', async () => {
    const i1 = 'inst-1';
    const f1 = 'field-1';
    const f2 = 'field-2';

    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'extract',
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
  });

  it('hydrates Layer-1 rows (human_proposal / system_proposal) like decisions', async () => {
    // Pre-D8 QA runs (proposals-only) and reopened runs (system seeds) come
    // through the same caller-scoped resolution — the hook treats every
    // non-reject row identically.
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'extract',
        currentValues: [
          {
            instance_id: 'inst-1',
            field_id: 'field-1',
            value: { value: 'typed pre-D8' },
            decision: 'human_proposal',
          },
          {
            instance_id: 'inst-2',
            field_id: 'field-2',
            value: { value: 'reopen seed' },
            decision: 'system_proposal',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('typed pre-D8');
    expect(result.current.values['inst-2_field-2']).toBe('reopen seed');
  });
});

describe('useExtractedValues — stage=review and beyond', () => {
  it('hydrates scalar and unit-bearing currentValues, skipping rejects', async () => {
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
        stage: 'extract',
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
            // double-envelope: outer { value: ... } stripped by the unwrap,
            // inner { value: 'A', unit: 'mg' } is the unwrapped form
            value: { value: { value: 'A', unit: 'mg' } },
            decision: 'edit',
          },
        ],
      }),
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
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
  });

  it('returns empty when there is no authenticated user (review path)', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: null,
        runId: 'run-1',
        stage: 'extract',
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
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
        enabled: false,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.initialized).toBe(true);
    expect(result.current.values).toEqual({});
  });

  it('does not get stuck even when runId is set but enabled is explicitly false', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'extract',
        enabled: false,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
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
          stage: 'extract',
          currentValues,
          enabled,
        }),
      { initialProps: { enabled: false } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ enabled: true });
    // After re-enabling the hook must hydrate the form from currentValues
    // (the page wouldn't otherwise show values once the session resolves).
    // ``initialized`` is already true while disabled (the disabled branch
    // sets it), so gating on it does not await the re-enabled hydration —
    // asserting the value synchronously behind that vacuous gate raced the
    // effect commit and flaked on CI (run 27356139150). Await the hydrated
    // value itself: it is the only observable that flips on re-enable.
    await waitFor(() =>
      expect(result.current.values['inst-1_field-1']).toBe('hydrated'),
    );
    expect(result.current.initialized).toBe(true);
  });
});

describe('useExtractedValues — local update', () => {
  it('updateValue patches the local map immediately', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        currentUserId: 'user-1',
        runId: 'run-1',
        stage: 'extract',
        currentValues: [],
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
  // mount) produces a fresh ``currentValues`` array reference. Without
  // preserving locally-edited keys, ``mergeValuesById`` would overwrite
  // the user's in-flight edit with the previously-saved backend value,
  // and the autosave hook would then see ``no dirty entries`` and skip
  // the POST — silently dropping every keystroke between two refetches.
  // This locks in: once a key exists in local state, the merge MUST NOT
  // clobber it with a backend-shaped value.

  it('preserves a locally-edited value when currentValues refetch with the previous backend value', async () => {
    const initialCurrentValues: RunViewCurrentValue[] = [
      {
        instance_id: 'inst-1',
        field_id: 'field-1',
        value: { value: 'old' },
        decision: 'edit',
      },
    ];

    const { result, rerender } = renderHook(
      ({ currentValues }) =>
        useExtractedValues({
          currentUserId: 'user-1',
          runId: 'run-1',
          stage: 'extract',
          currentValues,
        }),
      { initialProps: { currentValues: initialCurrentValues } },
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
    const refetched = initialCurrentValues.map((cv) => ({ ...cv }));
    rerender({ currentValues: refetched });

    // The local edit must survive — the user is still typing.
    await waitFor(() =>
      expect(result.current.values['inst-1_field-1']).toBe('user-typed'),
    );
  });

  it('still picks up newly-introduced keys (e.g. AI-extracted fields) on refetch', async () => {
    const mine: RunViewCurrentValue = {
      instance_id: 'inst-1',
      field_id: 'field-1',
      value: { value: 'mine' },
      decision: 'edit',
    };
    const { result, rerender } = renderHook<
      ReturnType<typeof useExtractedValues>,
      { currentValues: RunViewCurrentValue[] }
    >(
      ({ currentValues }) =>
        useExtractedValues({
          currentUserId: 'user-1',
          runId: 'run-1',
          stage: 'extract',
          currentValues,
        }),
      { initialProps: { currentValues: [mine] } },
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('mine');
    expect(result.current.values['inst-2_field-2']).toBeUndefined();

    // A decision lands on a coord the user hasn't touched (e.g. the
    // reviewer accepted an AI suggestion elsewhere). Refetch surfaces it;
    // the form should show it.
    rerender({
      currentValues: [
        mine,
        {
          instance_id: 'inst-2',
          field_id: 'field-2',
          value: { value: 'ai-suggested' },
          decision: 'edit',
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
    const run1Values: RunViewCurrentValue[] = [
      {
        instance_id: 'inst-1',
        field_id: 'field-1',
        value: { value: 'old-run-value' },
        decision: 'edit',
      },
    ];
    const run2Values: RunViewCurrentValue[] = [
      {
        instance_id: 'inst-1',
        field_id: 'field-1',
        value: { value: 'new-run-value' },
        decision: 'edit',
      },
    ];

    const { result, rerender } = renderHook(
      ({ runId, currentValues }) =>
        useExtractedValues({
          currentUserId: 'user-1',
          runId,
          stage: 'extract',
          currentValues,
        }),
      { initialProps: { runId: 'run-1', currentValues: run1Values } },
    );

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['inst-1_field-1']).toBe('old-run-value');

    act(() => {
      result.current.updateValue('inst-1', 'field-1', 'unsaved-run-1-edit');
    });
    await waitFor(() =>
      expect(result.current.values['inst-1_field-1']).toBe('unsaved-run-1-edit'),
    );

    rerender({ runId: 'run-2', currentValues: run2Values });

    await waitFor(() =>
      expect(result.current.values['inst-1_field-1']).toBe('new-run-value'),
    );
  });
});

describe('finalized stage — published values', () => {
  const published = [
    {
      id: 'ps1', run_id: 'run-1', instance_id: 'i1', field_id: 'f1',
      value: { value: 'published-A' },
      published_at: '', published_by: 'u9', version: 1,
    },
    {
      id: 'ps2', run_id: 'run-1', instance_id: 'i1', field_id: 'f2',
      value: { value: null, absent_reason: 'no_information' },
      published_at: '', published_by: 'u9', version: 1,
    },
  ];

  it('hydrates from published_states and ignores currentValues', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        runId: 'run-1',
        stage: 'finalized',
        currentUserId: 'user-1',
        currentValues: [
          { instance_id: 'i1', field_id: 'f1', value: { value: 'MY-DRAFT' }, decision: 'edit' },
          { instance_id: 'i1', field_id: 'f9', value: { value: 'DRAFT-ONLY' }, decision: 'edit' },
        ],
        publishedStates: published as never,
      }),
    );
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['i1_f1']).toBe('published-A');
    // Draft-only coord does NOT leak into a published view:
    expect(result.current.values['i1_f9']).toBeUndefined();
  });

  it('preserves the marker envelope for published abstentions', async () => {
    const { result } = renderHook(() =>
      useExtractedValues({
        runId: 'run-1',
        stage: 'finalized',
        currentUserId: 'user-1',
        publishedStates: published as never,
      }),
    );
    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.values['i1_f2']).toEqual({ value: null, absent_reason: 'no_information' });
  });

  it('REPLACES pre-finalize values when the same run flips to finalized in-session', async () => {
    // The manager finalizes from consensus WITHOUT leaving the page
    // (handleApproveFinalize → refetchRun + refreshValues): the runId is
    // unchanged, so the hydration must replace, not merge — otherwise the
    // stale reviewer-state value survives under the Published banner.
    const { result, rerender } = renderHook(
      ({ stage, publishedStates }: { stage: string; publishedStates?: unknown }) =>
        useExtractedValues({
          runId: 'run-1',
          stage,
          currentUserId: 'user-1',
          currentValues: [
            { instance_id: 'i1', field_id: 'f1', value: { value: 'MY-DRAFT' }, decision: 'edit' },
            { instance_id: 'i1', field_id: 'f9', value: { value: 'DRAFT-ONLY' }, decision: 'edit' },
          ],
          publishedStates: publishedStates as never,
        }),
      { initialProps: { stage: 'consensus' } as { stage: string; publishedStates?: unknown } },
    );
    await waitFor(() => expect(result.current.values['i1_f1']).toBe('MY-DRAFT'));

    rerender({ stage: 'finalized', publishedStates: published });
    await waitFor(() => expect(result.current.values['i1_f1']).toBe('published-A'));
    // The draft-only coord from the consensus hydration is gone too:
    expect(result.current.values['i1_f9']).toBeUndefined();
  });
});
