import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, afterEach } from 'vitest';
import { useScrolled } from './useScrolled';

describe('useScrolled', () => {
  function setScrollY(value: number) {
    Object.defineProperty(window, 'scrollY', { value, configurable: true });
  }

  afterEach(() => {
    // Reset to 0 so other tests are not affected.
    setScrollY(0);
  });

  it('returns false when scrollY is at 0 (default threshold)', () => {
    setScrollY(0);
    const { result } = renderHook(() => useScrolled());
    expect(result.current).toBe(false);
  });

  it('returns true when scrollY exceeds the default threshold', () => {
    setScrollY(0);
    const { result } = renderHook(() => useScrolled());
    act(() => {
      setScrollY(1);
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(true);
  });

  it('reads initial scrollY on mount', () => {
    setScrollY(50);
    const { result } = renderHook(() => useScrolled());
    expect(result.current).toBe(true);
  });

  it('respects an explicit threshold', () => {
    setScrollY(99);
    const { result } = renderHook(() => useScrolled(100));
    expect(result.current).toBe(false);
    act(() => {
      setScrollY(101);
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(true);
  });
});
