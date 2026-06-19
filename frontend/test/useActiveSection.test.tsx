// frontend/test/useActiveSection.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { pickMostVisible, useActiveSection } from '@/hooks/extraction/useActiveSection';

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
});
