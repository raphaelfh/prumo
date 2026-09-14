// frontend/test/useActiveSection.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { pickActiveSection, useActiveSection } from '@/hooks/extraction/useActiveSection';

describe('pickActiveSection', () => {
  // Tops are pane-relative pixels; the activation line sits at 200.
  const form = [
    { id: 'a', top: -320 },
    { id: 'b', top: 40 },
    { id: 'c', top: 900 },
  ];

  it('picks the last section that starts at or above the activation line', () => {
    expect(pickActiveSection(form, 200, false)).toBe('b');
  });

  it('keeps the first section while the form sits below the line', () => {
    expect(pickActiveSection([{ id: 'a', top: 640 }, { id: 'b', top: 1200 }], 200, false)).toBe('a');
  });

  it('gives the last section the rail once the pane has bottomed out', () => {
    // The trailing section is short: it never reaches the line, so only the
    // at-bottom case can hand it the rail.
    expect(pickActiveSection(form, 200, true)).toBe('c');
  });

  it('a tall section no longer outvotes the one being read', () => {
    // 'b' covers most of the pane, but the reader has scrolled past its start.
    expect(pickActiveSection([{ id: 'b', top: -2000 }, { id: 'c', top: 120 }], 200, false)).toBe('c');
  });

  it('has nothing to say about an unmeasured form', () => {
    expect(pickActiveSection([], 200, false)).toBeNull();
  });
});

describe('useActiveSection', () => {
  it('scrollToSection scrolls and focuses the registered element', () => {
    const { result } = renderHook(() => useActiveSection(['s1', 's2']));
    const el = document.createElement('div');
    el.tabIndex = -1;
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;
    const focus = vi.spyOn(el, 'focus');
    act(() => result.current.registerSection('s1', el));
    act(() => result.current.scrollToSection('s1'));
    // No `behavior: 'smooth'`: a smooth scroll across this pane takes over a
    // second, and the spy re-picks every section it drifts past.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(focus).toHaveBeenCalled();
  });

  it('scrolls the last section the same way as any other', () => {
    const { result } = renderHook(() => useActiveSection(['s1', 's2']));
    const el = document.createElement('div');
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;
    act(() => result.current.registerSection('s2', el));
    act(() => result.current.scrollToSection('s2'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('marks the clicked section active immediately, even before any scroll settles', () => {
    const { result } = renderHook(() => useActiveSection(['s1', 's2']));
    expect(result.current.activeId).toBe('s1');
    const el = document.createElement('div');
    el.scrollIntoView = vi.fn();
    act(() => result.current.registerSection('s2', el));
    act(() => result.current.scrollToSection('s2'));
    expect(result.current.activeId).toBe('s2');
  });

  it('shades a section even when its node is not registered yet', () => {
    const { result } = renderHook(() => useActiveSection(['s1', 's2']));
    act(() => result.current.scrollToSection('s2'));
    expect(result.current.activeId).toBe('s2');
  });
});
