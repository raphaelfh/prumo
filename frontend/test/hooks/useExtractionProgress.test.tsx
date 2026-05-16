/**
 * Regression tests for ``useExtractionProgress`` — the local-state
 * progress hook used on ``ExtractionFullScreen``.
 *
 * Covers bug #55: progress was overstated for multi-instance
 * (cardinality='many') entity types because the previous
 * implementation deduped completion by field_id only, so filling a
 * required field in one instance flipped the entire field to "done"
 * regardless of how many sibling instances remained empty.
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useExtractionProgress } from '@/hooks/extraction/useExtractionProgress';

type Field = {
  id: string;
  is_required: boolean;
};

function et(id: string, fields: Field[]) {
  return { id, fields: fields as any };
}

describe('useExtractionProgress', () => {
  it('does NOT report 100% when only one of many instances is filled (#55)', () => {
    const entityTypes = [
      et('et-models', [
        { id: 'f-type', is_required: true },
        { id: 'f-auc', is_required: true },
      ]),
    ];
    // 3 instances, but only instance-1 has values for both required
    // fields. Instances 2 and 3 are empty.
    const values: Record<string, unknown> = {
      'inst-1_f-type': 'logistic',
      'inst-1_f-auc': 0.82,
    };

    const { result } = renderHook(() =>
      useExtractionProgress(values, entityTypes),
    );

    // Only one instance is observed in `values`, so denominator is 2.
    // After filling more instances the user keeps progressing.
    expect(result.current.totalFields).toBe(2);
    expect(result.current.completedFields).toBe(2);
    expect(result.current.isComplete).toBe(true);

    // Now simulate the bug scenario: 3 distinct instances exist, only
    // the first is filled. Progress must NOT be 100 %.
    const valuesMulti: Record<string, unknown> = {
      'inst-1_f-type': 'logistic',
      'inst-1_f-auc': 0.82,
      'inst-2_f-type': '',
      'inst-2_f-auc': null,
      'inst-3_f-type': undefined,
    };
    const { result: r2 } = renderHook(() =>
      useExtractionProgress(valuesMulti, entityTypes),
    );
    // 3 instances × 2 required fields = 6 denominator, 2 completed.
    expect(r2.current.totalFields).toBe(6);
    expect(r2.current.completedFields).toBe(2);
    expect(r2.current.isComplete).toBe(false);
    expect(r2.current.completionPercentage).toBeLessThan(100);
  });

  it('treats an entity type with no observed instances as 1 (counts toward total)', () => {
    const entityTypes = [
      et('et-empty', [{ id: 'f-x', is_required: true }]),
    ];
    const { result } = renderHook(() => useExtractionProgress({}, entityTypes));
    expect(result.current.totalFields).toBe(1);
    expect(result.current.completedFields).toBe(0);
    expect(result.current.completionPercentage).toBe(0);
  });

  it('ignores optional fields in the denominator', () => {
    const entityTypes = [
      et('et-1', [
        { id: 'f-req', is_required: true },
        { id: 'f-opt', is_required: false },
      ]),
    ];
    const values = {
      'inst-1_f-req': 'value',
      'inst-1_f-opt': 'extra',
    };
    const { result } = renderHook(() =>
      useExtractionProgress(values, entityTypes),
    );
    expect(result.current.totalFields).toBe(1);
    expect(result.current.completedFields).toBe(1);
    expect(result.current.isComplete).toBe(true);
  });
});
