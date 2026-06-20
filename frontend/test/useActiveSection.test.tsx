// frontend/test/useActiveSection.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { pickMostVisible, resolveActiveSection, useActiveSection } from '@/hooks/extraction/useActiveSection';

function entry(id: string, ratio: number, isIntersecting: boolean): IntersectionObserverEntry {
  return {
    target: { dataset: { sectionId: id } } as unknown as HTMLElement,
    intersectionRatio: ratio,
    isIntersecting,
  } as unknown as IntersectionObserverEntry;
}

describe('pickMostVisible', () => {
  it('returns the id of the most-visible intersecting section', () => {
    expect(pickMostVisible([entry('a', 0.2, true), entry('b', 0.7, true)], null)).toBe('b');
  });
  it('keeps the current id when nothing is intersecting', () => {
    expect(pickMostVisible([entry('a', 0, false)], 'a')).toBe('a');
  });
});

describe('resolveActiveSection', () => {
  it('clamps to the last section when the scroll container is at the bottom', () => {
    // Nothing is intersecting in the activation band, but we are at the bottom,
    // so the last (short, never-reaches-the-band) section should win.
    expect(resolveActiveSection([entry('mid', 0, false)], 'mid', true, 'last')).toBe('last');
  });
  it('falls back to the most-visible section when not at the bottom', () => {
    expect(resolveActiveSection([entry('a', 0.3, true), entry('b', 0.6, true)], null, false, 'last')).toBe('b');
  });
  it('ignores the clamp when there is no last id', () => {
    expect(resolveActiveSection([entry('a', 0.4, true)], null, true, null)).toBe('a');
  });
});

describe('useActiveSection', () => {
  it('scrollToSection scrolls and focuses the registered element', () => {
    const { result } = renderHook(() => useActiveSection(['s1']));
    const el = document.createElement('div');
    el.tabIndex = -1;
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;
    const focus = vi.spyOn(el, 'focus');
    act(() => result.current.registerSection('s1', el));
    act(() => result.current.scrollToSection('s1'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(focus).toHaveBeenCalled();
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
});
