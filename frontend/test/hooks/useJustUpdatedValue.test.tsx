import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useJustUpdatedValue } from '@/hooks/extraction/useJustUpdatedValue';
import { dispatchValueUpdates } from '@/lib/extraction/valueUpdates';

// The refresh highlight survives on FieldInput in ExtractionFullScreen's
// default presentation; the editable extraction review table retired it. A
// dispatched key must light only its own field — never every subscriber — and
// only for the highlight window.
describe('useJustUpdatedValue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lights only the field whose key was dispatched, then clears', () => {
    vi.useFakeTimers();
    const matching = renderHook(() => useJustUpdatedValue('instance-1_field-1'));
    const other = renderHook(() => useJustUpdatedValue('instance-1_field-2'));
    expect(matching.result.current).toBe(false);
    expect(other.result.current).toBe(false);

    act(() => dispatchValueUpdates(['instance-1_field-1']));
    expect(matching.result.current).toBe(true);
    expect(other.result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(matching.result.current).toBe(false);
  });
});
