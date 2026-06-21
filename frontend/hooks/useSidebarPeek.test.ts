import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {act, renderHook} from '@testing-library/react';
import {useSidebarPeek} from './useSidebarPeek';

describe('useSidebarPeek', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens only after the hover-in delay', () => {
    const {result} = renderHook(() => useSidebarPeek({inMs: 120, outMs: 250}));
    expect(result.current.open).toBe(false);
    act(() => result.current.onEnter());
    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(result.current.open).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.open).toBe(true);
  });

  it('closes only after the hover-out grace', () => {
    const {result} = renderHook(() => useSidebarPeek({inMs: 120, outMs: 250}));
    act(() => {
      result.current.onEnter();
      vi.advanceTimersByTime(120);
    });
    expect(result.current.open).toBe(true);
    act(() => result.current.onLeave());
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current.open).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.open).toBe(false);
  });

  it('a leave during the grace can be cancelled by re-entering', () => {
    const {result} = renderHook(() => useSidebarPeek({inMs: 120, outMs: 250}));
    act(() => {
      result.current.onEnter();
      vi.advanceTimersByTime(120);
    });
    act(() => {
      result.current.onLeave();
      vi.advanceTimersByTime(100);
      result.current.onEnter();
      vi.advanceTimersByTime(300);
    });
    expect(result.current.open).toBe(true);
  });

  it('leave cancels a still-pending open', () => {
    const {result} = renderHook(() => useSidebarPeek({inMs: 120, outMs: 250}));
    act(() => {
      result.current.onEnter();
      vi.advanceTimersByTime(60);
      result.current.onLeave();
      vi.advanceTimersByTime(300);
    });
    expect(result.current.open).toBe(false);
  });

  it('openNow / closeNow act immediately (focus / Esc)', () => {
    const {result} = renderHook(() => useSidebarPeek({inMs: 120, outMs: 250}));
    act(() => result.current.openNow());
    expect(result.current.open).toBe(true);
    act(() => result.current.closeNow());
    expect(result.current.open).toBe(false);
  });
});
