import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useHeaderTier } from './useHeaderTier';

let cb: (entries: { contentRect: { width: number } }[]) => void;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(c: typeof cb) { cb = c; }
      observe() {}
      disconnect() {}
    },
  );
});

describe('useHeaderTier', () => {
  it('maps observed width to a tier', () => {
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useHeaderTier(ref));
    act(() => cb([{ contentRect: { width: 400 } }]));
    expect(result.current).toBe('compact');
    act(() => cb([{ contentRect: { width: 700 } }]));
    expect(result.current).toBe('comfortable');
    act(() => cb([{ contentRect: { width: 1200 } }]));
    expect(result.current).toBe('spacious');
  });
});
